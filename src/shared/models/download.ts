// ダウンロードの純粋ロジック: 通信先の許可判定、再開用ヘッダ、進捗・残り時間の計算。

/** ダウンロードを許可するホスト(モデル配布元とそのCDN)。CLAUDE.md の「通信はモデルDLのみ」を守るため、リダイレクト先も検証する */
export const DEFAULT_DOWNLOAD_HOSTS = ['huggingface.co', 'hf.co']

/** ホスト名が許可リストのドメイン、またはそのサブドメインか(例: cdn-lfs.hf.co は hf.co の配下) */
export function isAllowedDownloadUrl(url: string, allowedHosts: readonly string[] = DEFAULT_DOWNLOAD_HOSTS, allowHttp = false): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) return false
  const host = u.hostname.toLowerCase()
  return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))
}

/** 途中まで落としたファイルから再開するための Range ヘッダ。何も落としていなければ付けない */
export function resumeHeaders(downloadedBytes: number): Record<string, string> {
  return downloadedBytes > 0 ? { Range: `bytes=${downloadedBytes}-` } : {}
}

export interface ProgressSnapshot {
  downloadedBytes: number
  totalBytes: number
  /** 0〜1 */
  fraction: number
  bytesPerSec: number
  /** 残り秒数。速度が分からないうちは null */
  etaSec: number | null
}

/** 直近の数秒の移動平均で速度を出す(開始直後や一時停止で値が暴れないように) */
export class ProgressTracker {
  private samples: Array<{ t: number; bytes: number }> = []

  constructor(
    private readonly totalBytes: number,
    private readonly windowMs = 5000
  ) {}

  update(downloadedBytes: number, nowMs: number): ProgressSnapshot {
    this.samples.push({ t: nowMs, bytes: downloadedBytes })
    while (this.samples.length > 2 && nowMs - this.samples[0].t > this.windowMs) this.samples.shift()
    const first = this.samples[0]
    const dt = (nowMs - first.t) / 1000
    const bytesPerSec = dt > 0.2 ? Math.max(0, (downloadedBytes - first.bytes) / dt) : 0
    const remaining = Math.max(0, this.totalBytes - downloadedBytes)
    return {
      downloadedBytes,
      totalBytes: this.totalBytes,
      fraction: this.totalBytes > 0 ? Math.min(1, downloadedBytes / this.totalBytes) : 0,
      bytesPerSec,
      etaSec: bytesPerSec > 1 ? remaining / bytesPerSec : null
    }
  }
}

/**
 * サーバーの応答が、要求した再開位置と整合するか。
 * - 206 かつ Content-Range が要求位置から始まる → 追記してよい
 * - 200(Rangeを無視して先頭から送ってきた) → 最初からやり直す
 */
export function resumeDecision(requestedFrom: number, status: number, contentRange: string | null): 'append' | 'restart' | 'fail' {
  if (requestedFrom === 0) return status === 200 ? 'restart' : status === 206 ? 'restart' : 'fail'
  if (status === 200) return 'restart'
  if (status === 206) {
    const m = /^bytes (\d+)-/.exec(contentRange ?? '')
    return m && Number(m[1]) === requestedFrom ? 'append' : 'restart'
  }
  return 'fail'
}

/** 失敗時の再試行までの待ち時間(指数バックオフ、上限あり) */
export function retryDelayMs(attempt: number, baseMs = 1000, maxMs = 30000): number {
  return Math.min(maxMs, baseMs * 2 ** attempt)
}
