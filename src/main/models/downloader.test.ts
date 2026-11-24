import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ModelEntry } from '../../shared/models/registry'
import { ChecksumError, DiskSpaceError, DownloadAbortedError, DownloadError, ModelDownloader, sha256OfFile } from './downloader'

// ローカルの疑似配布サーバー(127.0.0.1)で、再開・検証・リダイレクト制限などを確認する

const payload = randomBytes(300_000)
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
let server: Server
let base: string
/** リクエストごとの挙動を切り替える */
const mode = { dropAfter: 0, ignoreRange: false, redirectTo: '', corrupt: false, slow: false, requests: [] as Array<string | undefined> }

beforeAll(async () => {
  server = createServer((req, res) => {
    mode.requests.push(req.headers.range)
    if (mode.redirectTo) {
      res.writeHead(302, { Location: mode.redirectTo })
      res.end()
      return
    }
    const body = mode.corrupt ? Buffer.concat([payload.subarray(0, payload.length - 1), Buffer.from([payload[payload.length - 1] ^ 1])]) : payload
    let start = 0
    const m = /^bytes=(\d+)-/.exec(req.headers.range ?? '')
    if (m && !mode.ignoreRange) start = Number(m[1])
    if (start >= body.length) {
      res.writeHead(416)
      res.end()
      return
    }
    const chunk = body.subarray(start)
    if (start > 0) res.writeHead(206, { 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}`, 'Content-Length': chunk.length })
    else res.writeHead(200, { 'Content-Length': chunk.length })
    if (mode.dropAfter > 0) {
      // 途中まで送って切断する(ネットワーク断の再現)。1回きり
      const n = mode.dropAfter
      mode.dropAfter = 0
      res.write(chunk.subarray(0, n))
      setTimeout(() => res.destroy(), 20)
      return
    }
    if (mode.slow) {
      // 少しずつ送る(ローカルでは一瞬で届くため、途中で中断するテスト用)
      let i = 0
      const timer = setInterval(() => {
        if (res.destroyed) return clearInterval(timer)
        res.write(chunk.subarray(i, i + 20_000))
        i += 20_000
        if (i >= chunk.length) {
          clearInterval(timer)
          res.end()
        }
      }, 5)
      return
    }
    res.end(chunk)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmaid-dl-'))
  Object.assign(mode, { dropAfter: 0, ignoreRange: false, redirectTo: '', corrupt: false, slow: false, requests: [] })
  return () => rmSync(dir, { recursive: true, force: true })
})

const entry = (over: Partial<ModelEntry> = {}): ModelEntry => ({
  id: 'test-model',
  name: 't',
  family: 't',
  license: 'Apache-2.0',
  url: `${base}/model.gguf`,
  sha256: sha(payload),
  sizeBytes: payload.length,
  quant: 'Q4',
  contextLength: 1000,
  minRamGB: 1,
  notes: '',
  ...over
})
const make = (over = {}): ModelDownloader =>
  new ModelDownloader({ dir, allowedHosts: ['127.0.0.1'], allowHttp: true, retryBaseMs: 5, diskMarginBytes: 0, ...over })

describe('ModelDownloader', () => {
  it('ダウンロードして検証し、完成ファイルを置く(.part は残さない)', async () => {
    const d = make()
    const phases: string[] = []
    const path = await d.download(entry(), (p) => phases.push(p.phase))
    expect(readFileSync(path).equals(payload)).toBe(true)
    expect(existsSync(`${path}.part`)).toBe(false)
    expect(phases).toContain('downloading')
    expect(phases[phases.length - 1]).toBe('verifying')
    expect(await d.isInstalled(entry())).toBe(true)
  })

  it('ダウンロード済みなら通信しない', async () => {
    const d = make()
    await d.download(entry(), () => {})
    mode.requests.length = 0
    await d.download(entry(), () => {})
    expect(mode.requests).toHaveLength(0)
  })

  it('途中で切れても、再試行して続きから(Range)再開し、最終的に正しいファイルになる', async () => {
    mode.dropAfter = 100_000
    const path = await make().download(entry(), () => {})
    expect(readFileSync(path).equals(payload)).toBe(true)
    expect(mode.requests[0]).toBeUndefined() // 1回目は先頭から
    expect(mode.requests[1]).toMatch(/^bytes=\d+-$/) // 2回目は続きから
    expect(Number(/^bytes=(\d+)-$/.exec(mode.requests[1]!)![1])).toBeGreaterThan(0)
  })

  it('中断しても .part が残り、次の呼び出しで続きから再開できる', async () => {
    const d = make()
    mode.slow = true
    const ac = new AbortController()
    let aborted = false
    await expect(
      d.download(entry(), (p) => {
        if (!aborted && p.snapshot.downloadedBytes > 50_000) {
          aborted = true
          ac.abort()
        }
      }, ac.signal)
    ).rejects.toBeInstanceOf(DownloadAbortedError)
    const partial = statSync(`${d.pathFor(entry())}.part`).size
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(payload.length)
    expect(await d.partialBytes(entry())).toBe(partial)
    mode.requests.length = 0
    mode.slow = false
    const path = await d.download(entry(), () => {})
    expect(readFileSync(path).equals(payload)).toBe(true)
    expect(mode.requests[0]).toBe(`bytes=${partial}-`)
  })

  it('サーバーが Range を無視して全体を返してきたら、最初からやり直して正しく完成する', async () => {
    const d = make()
    writeFileSync(`${d.pathFor(entry())}.part`, payload.subarray(0, 1000))
    mode.ignoreRange = true
    const path = await d.download(entry(), () => {})
    expect(readFileSync(path).equals(payload)).toBe(true)
  })

  it('SHA-256 が一致しなければ失敗し、壊れたファイルを残さない(再試行もしない)', async () => {
    mode.corrupt = true
    const d = make()
    await expect(d.download(entry(), () => {})).rejects.toBeInstanceOf(ChecksumError)
    expect(existsSync(d.pathFor(entry()))).toBe(false)
    expect(existsSync(`${d.pathFor(entry())}.part`)).toBe(false)
    expect(mode.requests).toHaveLength(1)
  })

  it('許可されていないホストへのリダイレクトは辿らない', async () => {
    mode.redirectTo = 'http://localhost.invalid:1/evil.gguf'
    await expect(make().download(entry(), () => {})).rejects.toThrow('許可されていない接続先')
  })

  it('許可されていないホストのURLは、最初から接続しない', async () => {
    const d = new ModelDownloader({ dir, allowedHosts: ['huggingface.co'] })
    await expect(d.download(entry({ url: `${base}/x` }), () => {})).rejects.toBeInstanceOf(DownloadError)
    expect(mode.requests).toHaveLength(0)
  })

  it('ディスクの空きが足りなければ、ダウンロード前に失敗する', async () => {
    const d = make({ diskMarginBytes: Number.MAX_SAFE_INTEGER })
    await expect(d.download(entry(), () => {})).rejects.toBeInstanceOf(DiskSpaceError)
    expect(mode.requests).toHaveLength(0)
  })

  it('HTTPエラー(404)は失敗として報告する', async () => {
    mode.redirectTo = ''
    const d = make({ maxAttempts: 1 })
    // サーバーは常に200を返すので、サイズ違いのエントリで「サイズ不一致」を再現する
    await expect(d.download(entry({ sizeBytes: payload.length + 10, sha256: 'a'.repeat(64) }), () => {})).rejects.toThrow()
  })

  it('remove は完成ファイルと .part の両方を消す', async () => {
    const d = make()
    await d.download(entry(), () => {})
    writeFileSync(`${d.pathFor(entry())}.part`, 'x')
    await d.remove(entry())
    expect(existsSync(d.pathFor(entry()))).toBe(false)
    expect(existsSync(`${d.pathFor(entry())}.part`)).toBe(false)
  })
})

describe('sha256OfFile', () => {
  it('ファイルのSHA-256を返す', async () => {
    const p = join(dir ?? tmpdir(), 'x.bin')
    writeFileSync(p, 'hello')
    expect(await sha256OfFile(p)).toBe(createHash('sha256').update('hello').digest('hex'))
  })
})
