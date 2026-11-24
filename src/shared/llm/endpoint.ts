// OpenAI互換エンドポイントのURL処理。Electron非依存。

/**
 * 入力を正規化する。スキームが無ければ http:// を補い、パスが空なら /v1 を補う
 * (Ollama / LM Studio は /v1。OpenRouter のように /api/v1 など明示済みのパスはそのまま)。
 * 不正な入力・http/https 以外は null。
 */
export function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null // URLに認証情報を埋め込ませない(APIキーは別項目)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path === '' ? '/v1' : path
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

/** 会話がこのPCの外に出ないエンドポイントか(localhost / 127.0.0.0/8 / ::1 / 0.0.0.0)。それ以外は外部サーバー扱いで警告する */
export function isLocalEndpoint(baseUrl: string): boolean {
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  host = host.replace(/^\[|\]$/g, '') // IPv6 は [::1] 形式で届く
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || /^127(\.\d{1,3}){3}$/.test(host)
}

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1'

/**
 * モデル名が空のとき、サーバーが返したモデル一覧から使うものを選ぶ。
 * 埋め込み・音声などチャットできないものは除き、非思考型(instruct)を優先、思考型(thinking)は後回しにする。
 * 該当がなければ null。
 */
export function pickDefaultModel(ids: string[]): string | null {
  const chatCapable = ids.filter((id) => !/embed|rerank|whisper|tts|bge-|nomic/i.test(id))
  const score = (id: string): number => (/instruct/i.test(id) ? 0 : /think|reason|r1\b/i.test(id) ? 2 : 1)
  // sort は安定なので、同点なら一覧の順(サーバー側の並び)を保つ
  return [...chatCapable].sort((a, b) => score(a) - score(b))[0] ?? null
}
