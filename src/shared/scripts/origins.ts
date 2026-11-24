// スクリプト Mod の「設定で足す通信先」(設定の種類 urls)。ADR 0002 の拡張(2026-10-19)。純粋ロジック。
// 利用者が、設定の欄に、URL を 1 行に 1 つ書く。https の外部のサイトだけ(自分の PC・社内ネットワークは、不可)。
// 保存するときに、まだ承認していないオリジン(サイト)があれば、利用者に確認を取る(main)。承認したオリジンだけ、host.http.fetch が通る。

export const MAX_URLS = 10
export const MAX_URL_LENGTH = 500

/** 名前が、自分の PC・内部のものを指していないか(localhost・.local・.internal・IP アドレスの直書きの内部向けなど) */
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h === '' || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return false
  if (h.startsWith('[')) return isPublicAddress(h.slice(1, -1))
  if (/^[0-9.]+$/.test(h)) return isPublicAddress(h) // IPv4 の直書き
  return h.includes('.') // 名前は、ドットを含むもの(単一ラベルの名前は、内部向けのことが多い)
}

/** IP アドレス(名前解決の結果・直書き)が、公開のものか。ループバック・私用(10/172.16/192.168)・リンクローカル・CGNAT・予約・ULA は、不可 */
export function isPublicAddress(address: string): boolean {
  const a = address.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (mapped) return isPublicAddress(mapped[1]!)
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a)
  if (m) {
    const [o1, o2] = [Number(m[1]), Number(m[2])]
    if ([o1, o2, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false
    if (o1 === 0 || o1 === 10 || o1 === 127 || o1 >= 224) return false // 0.x・私用・ループバック・マルチキャスト以上
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return false // CGNAT
    if (o1 === 169 && o2 === 254) return false // リンクローカル
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return false
    if (o1 === 192 && (o2 === 168 || (o2 === 0 && Number(m[3]) === 0))) return false
    if (o1 === 198 && (o2 === 18 || o2 === 19)) return false
    return true
  }
  if (a.includes(':')) {
    if (a === '::' || a === '::1') return false
    if (/^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith('ff')) return false // ULA・リンクローカル・マルチキャスト
    return true
  }
  return false
}

export type UrlListResult = { ok: true; urls: string[]; origins: string[] } | { ok: false; message: string }

/** 設定の欄(1 行に 1 つ)を、検査して、整える。空行・「#」で始まる行は、飛ばす */
export function parseUrlList(raw: string): UrlListResult {
  const urls: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (t === '' || t.startsWith('#')) continue
    if (t.length > MAX_URL_LENGTH) return { ok: false, message: `長すぎる URL があります(${MAX_URL_LENGTH} 文字まで)` }
    let u: URL
    try {
      u = new URL(t)
    } catch {
      return { ok: false, message: `URL の形が正しくありません: ${t.slice(0, 60)}` }
    }
    if (u.protocol !== 'https:') return { ok: false, message: `https:// で始まる URL だけ使えます: ${t.slice(0, 60)}` }
    if (u.username !== '' || u.password !== '') return { ok: false, message: 'ユーザー名・パスワードつきの URL は使えません' }
    if (!isPublicHost(u.hostname)) return { ok: false, message: `自分の PC・内部ネットワークの URL は使えません: ${u.hostname}` }
    if (!urls.includes(u.href)) urls.push(u.href)
  }
  if (urls.length > MAX_URLS) return { ok: false, message: `URL は、${MAX_URLS} 個までです` }
  return { ok: true, urls, origins: [...new Set(urls.map((x) => new URL(x).origin))] }
}

/** まだ承認していないオリジン */
export const newOrigins = (origins: readonly string[], approved: readonly string[]): string[] => origins.filter((o) => !approved.includes(o))

/** 使ってよいオリジン = いま設定に書かれていて、かつ、承認済みのもの(設定から消すと、承認も使えなくなる) */
export function effectiveOrigins(settingValue: string | undefined, approved: readonly string[]): string[] {
  const r = parseUrlList(settingValue ?? '')
  return r.ok ? r.origins.filter((o) => approved.includes(o)) : []
}
