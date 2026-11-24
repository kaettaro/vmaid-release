// スクリプト Mod の `host.http.fetch` のゲート(ADR 0002 §3.3)。純粋ロジック。
// 実際の通信は main が代行する(scriptHttp.ts)。ここは、「通してよい要求か」「接続先のアドレスは、許されるか」の判定だけ。

export const HTTP_LIMITS = {
  /** 1回の要求の制限時間の既定(ミリ秒)。スクリプトは、要求ごとに、timeoutMs で延ばせる(上限は maxTimeoutMs) */
  timeoutMs: 15_000,
  /** 要求ごとに指定できる制限時間の上限(ミリ秒。モーション生成のように、時間がかかる処理のため) */
  maxTimeoutMs: 10 * 60 * 1000,
  /** 応答の大きさの上限(バイト。VRMA の上限 30MB に、少し余裕を足す) */
  maxResponseBytes: 32 * 1024 * 1024,
  /** 送る本文の大きさの上限(バイト) */
  maxBodyBytes: 1024 * 1024
} as const

export type GateReason = 'bad-url' | 'scheme' | 'method' | 'origin-not-allowed' | 'body-too-big' | 'bad-header'

export type GateResult = { ok: true; url: URL } | { ok: false; reason: GateReason }

const METHODS = new Set(['GET', 'POST'])
/** スクリプトが付けてよいヘッダー(認証・種類の指定だけ。接続先・長さなど、通信の安全に関わるものは付けさせない) */
const ALLOWED_HEADERS = new Set(['content-type', 'accept', 'authorization', 'x-api-key'])

/**
 * 要求が、宣言して承認された通信先だけに向いているか確かめる。
 * オリジンは**完全一致**(前方一致・サブドメイン一致は不可。`http://127.0.0.1:50021.evil.example` や `http://localhost.evil.example` は断る)
 */
export function checkRequest(allowedOrigins: readonly string[], method: string, rawUrl: string, bodyBytes: number): GateResult {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'bad-url' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'scheme' }
  if (!METHODS.has(method)) return { ok: false, reason: 'method' }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'bad-url' }
  if (!allowedOrigins.includes(url.origin)) return { ok: false, reason: 'origin-not-allowed' }
  if (bodyBytes > HTTP_LIMITS.maxBodyBytes) return { ok: false, reason: 'body-too-big' }
  return { ok: true, url }
}

/** 許可するヘッダーだけを残す。許されないヘッダー名があれば null */
export function filterHeaders(headers: unknown): Record<string, string> | null {
  const out: Record<string, string> = {}
  if (headers === undefined || headers === null) return out
  if (typeof headers !== 'object' || Array.isArray(headers)) return null
  for (const [k, v] of Object.entries(headers)) {
    if (!ALLOWED_HEADERS.has(k.toLowerCase()) || typeof v !== 'string' || v.length > 2000 || /[\r\n]/.test(v)) return null
    out[k] = v
  }
  return out
}

/** 要求ごとの制限時間を、整える(省略は既定、範囲外は、上限・下限に丸める) */
export function clampTimeout(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return HTTP_LIMITS.timeoutMs
  return Math.min(HTTP_LIMITS.maxTimeoutMs, Math.max(1000, Math.round(v)))
}

export function isLoopbackAddress(address: string): boolean {
  return address === '::1' || address.startsWith('127.') || address === '::ffff:127.0.0.1'
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * 接続先のアドレス(名前解決の結果)が許されるか。宣言した通信先が localhost / 127.0.0.1 のとき、結果がループバックでなければ断る
 * (DNS リバインディング対策: 名前が、接続のときに、別のアドレスに変わっても、外へは出ない)。外部の宣言は、そのまま許す(赤い警告で承認済み)
 */
export function isAddressAllowed(declaredHost: string, address: string): boolean {
  return LOOPBACK_NAMES.has(declaredHost) ? isLoopbackAddress(address) : true
}

/** 通信ログ1件(本文は残さない) */
export interface HttpLogEntry {
  at: number
  method: string
  url: string
  /** 通った / 断った理由 */
  result: string
}
