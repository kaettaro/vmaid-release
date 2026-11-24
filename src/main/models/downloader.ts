import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  DEFAULT_DOWNLOAD_HOSTS,
  isAllowedDownloadUrl,
  ProgressTracker,
  resumeDecision,
  resumeHeaders,
  retryDelayMs,
  type ProgressSnapshot
} from '../../shared/models/download'
import { modelFileName, type ModelEntry } from '../../shared/models/registry'

// モデルのダウンロード。CLAUDE.md の「許可する通信はモデルのダウンロードとユーザー設定のLLMのみ」に従い、
// 通信先は許可ホストだけ(リダイレクト先も毎回検証)。Electron 非依存にして、ローカルのテストサーバーで検証できる。

export type DownloadPhase = 'downloading' | 'verifying'

export interface DownloadProgress {
  phase: DownloadPhase
  snapshot: ProgressSnapshot
}

export class DownloadError extends Error {}
/** 検証に失敗した(再試行しても直らないため、リトライしない) */
export class ChecksumError extends DownloadError {}
export class DiskSpaceError extends DownloadError {}
export class DownloadAbortedError extends Error {}

export interface DownloaderOptions {
  dir: string
  allowedHosts?: readonly string[]
  /** テスト用: http と別ホストを許可する */
  allowHttp?: boolean
  maxAttempts?: number
  retryBaseMs?: number
  /** ダウンロード前に確保しておく空き容量の余裕(バイト) */
  diskMarginBytes?: number
  maxRedirects?: number
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DownloadAbortedError())
    })
  })

export class ModelDownloader {
  private readonly allowedHosts: readonly string[]
  private readonly allowHttp: boolean
  private readonly maxAttempts: number
  private readonly retryBaseMs: number
  private readonly diskMargin: number
  private readonly maxRedirects: number

  constructor(private readonly opt: DownloaderOptions) {
    this.allowedHosts = opt.allowedHosts ?? DEFAULT_DOWNLOAD_HOSTS
    this.allowHttp = opt.allowHttp ?? false
    this.maxAttempts = opt.maxAttempts ?? 5
    this.retryBaseMs = opt.retryBaseMs ?? 1000
    this.diskMargin = opt.diskMarginBytes ?? 512 * 1024 * 1024
    this.maxRedirects = opt.maxRedirects ?? 5
  }

  pathFor(entry: ModelEntry): string {
    return join(this.opt.dir, modelFileName(entry))
  }

  /** ダウンロード済みか(サイズが一致するファイルがあるか) */
  async isInstalled(entry: ModelEntry): Promise<boolean> {
    return (await sizeOf(this.pathFor(entry))) === entry.sizeBytes
  }

  /** 途中まで落としたバイト数(再開位置)。進捗表示の初期値に使う */
  async partialBytes(entry: ModelEntry): Promise<number> {
    return sizeOf(`${this.pathFor(entry)}.part`)
  }

  async remove(entry: ModelEntry): Promise<void> {
    const p = this.pathFor(entry)
    await rm(p, { force: true })
    await rm(`${p}.part`, { force: true })
  }

  /**
   * ダウンロードして検証し、完成したファイルのパスを返す。中断(signal)しても .part は残り、次回は続きから再開する。
   * ネットワークの失敗は指数バックオフで再試行する。検証失敗・容量不足・許可外ホストは再試行しない。
   */
  async download(entry: ModelEntry, onProgress: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<string> {
    const finalPath = this.pathFor(entry)
    const partPath = `${finalPath}.part`
    if (await this.isInstalled(entry)) return finalPath
    await mkdir(this.opt.dir, { recursive: true })

    // 空き容量(残りの分+余裕)を事前に確認する
    const have = Math.min(await sizeOf(partPath), entry.sizeBytes)
    const need = entry.sizeBytes - have + this.diskMargin
    const free = await freeBytes(this.opt.dir)
    if (free !== null && free < need) {
      throw new DiskSpaceError(`ディスクの空きが足りません(必要: 約${Math.ceil(need / 1e9)}GB、空き: 約${(free / 1e9).toFixed(1)}GB)`)
    }

    for (let attempt = 0; ; attempt++) {
      try {
        await this.fetchInto(entry, partPath, onProgress, signal)
        break
      } catch (e) {
        if (signal?.aborted || e instanceof DownloadAbortedError) throw new DownloadAbortedError()
        if (e instanceof DownloadError || attempt + 1 >= this.maxAttempts) throw e // 再試行しても直らない / 回数切れ
        await sleep(retryDelayMs(attempt, this.retryBaseMs), signal)
      }
    }

    onProgress({ phase: 'verifying', snapshot: finishedSnapshot(entry.sizeBytes) })
    const actual = await sha256OfFile(partPath, signal)
    if (actual !== entry.sha256) {
      await rm(partPath, { force: true }) // 壊れたファイルは残さない(次回は最初から)
      throw new ChecksumError('ダウンロードしたファイルの検証(SHA-256)に失敗しました。もう一度ダウンロードしてください。')
    }
    await rename(partPath, finalPath)
    return finalPath
  }

  /** 1回分の取得。.part の続きから Range で取得する */
  private async fetchInto(
    entry: ModelEntry,
    partPath: string,
    onProgress: (p: DownloadProgress) => void,
    signal?: AbortSignal
  ): Promise<void> {
    let from = await sizeOf(partPath)
    if (from > entry.sizeBytes) {
      await rm(partPath, { force: true }) // 想定より大きい=壊れている
      from = 0
    }
    if (from === entry.sizeBytes) return // 既に全部ある(検証へ進む)

    const res = await this.fetchFollowingRedirects(entry.url, resumeHeaders(from), signal)
    const decision = resumeDecision(from, res.status, res.headers.get('content-range'))
    if (decision === 'fail') throw new DownloadError(`ダウンロードに失敗しました(HTTP ${res.status})`)
    if (decision === 'restart') from = 0
    if (!res.body) throw new Error('応答が空でした')

    const tracker = new ProgressTracker(entry.sizeBytes)
    let received = from
    const out = createWriteStream(partPath, { flags: from > 0 ? 'a' : 'w' })
    const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
    body.on('data', (chunk: Buffer) => {
      received += chunk.length
      onProgress({ phase: 'downloading', snapshot: tracker.update(received, Date.now()) })
    })
    try {
      await pipeline(body, out, signal ? { signal } : {})
    } catch (e) {
      if (signal?.aborted) throw new DownloadAbortedError()
      throw e
    }
    if (received !== entry.sizeBytes) {
      throw new Error(`サイズが一致しません(受信 ${received} / 期待 ${entry.sizeBytes})`) // 途中で切れた → 再試行(続きから)
    }
  }

  /** リダイレクトを手動で辿り、毎回、許可ホストか検証する */
  private async fetchFollowingRedirects(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Response> {
    let current = url
    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      if (!isAllowedDownloadUrl(current, this.allowedHosts, this.allowHttp)) {
        throw new DownloadError(`許可されていない接続先のため中止しました: ${new URL(current).hostname}`)
      }
      const res = await fetch(current, { headers, redirect: 'manual', signal })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) throw new DownloadError('リダイレクト先が不明です')
        current = new URL(loc, current).toString()
        await res.body?.cancel().catch(() => {})
        continue
      }
      return res
    }
    throw new DownloadError('リダイレクトが多すぎます')
  }
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null // 取得できない環境では事前チェックを飛ばす
  }
}

function finishedSnapshot(total: number): ProgressSnapshot {
  return { downloadedBytes: total, totalBytes: total, fraction: 1, bytesPerSec: 0, etaSec: 0 }
}

export async function sha256OfFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk as Buffer)
      yield chunk
    }
  }, async function (sink) {
    for await (const _ of sink) void _ // 読み捨て(ハッシュ計算だけが目的)
  }, signal ? { signal } : {})
  return hash.digest('hex')
}
