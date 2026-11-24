// スクリプト Mod が、一覧の窓(host.ui.list)に渡すデータの検査と整形。信用しない入力として、すべて作り直す。Electron / DOM に依存しない純粋ロジック。
// 渡せるのは「データだけ」(HTML・スクリプトは渡せない)。文字はテキストとして描かれ、アイコンは data: の画像だけ、link は https だけ。

export const UI_LIMITS = {
  maxItems: 100,
  /** アイコンの種類の数(サイトごとに 1 つ。項目は、名前で参照する) */
  maxIcons: 12,
  maxTitle: 160,
  maxSubtitle: 80,
  maxHeading: 60,
  maxEmpty: 120,
  maxId: 80,
  maxLink: 2000,
  /** アイコン(data: URL 全体)の長さの上限。画像そのものは、約 24KB */
  maxIconChars: 33_000
} as const

export interface UiListItem {
  id: string
  title: string
  subtitle: string
  /** アイコンの名前(UiList.icons のキー)か、空 */
  icon: string
  /** https の URL か、空 */
  link: string
  unread: boolean
}

export interface UiList {
  title: string
  empty: string
  /** アイコンの名前 → data:image/...;base64,... */
  icons: Record<string, string>
  items: UiListItem[]
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g

const text = (raw: unknown, max: number): string => (typeof raw === 'string' ? [...raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '')

const ICON_RE = /^data:image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/

/** 画像の先頭のバイト列が、名乗った形式と合っているか(base64 の先頭だけ見る) */
const ICON_MAGIC: Record<string, RegExp> = {
  png: /^iVBORw0KGgo/,
  'x-icon': /^AAAB/,
  'vnd.microsoft.icon': /^AAAB/,
  jpeg: /^\/9j\//,
  gif: /^R0lGOD[dl]/,
  webp: /^UklGR/
}

/** data: 画像の URL を確かめる。合わなければ空 */
export function sanitizeIcon(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > UI_LIMITS.maxIconChars) return ''
  const m = ICON_RE.exec(raw)
  if (!m) return ''
  return ICON_MAGIC[m[1]!]!.test(m[2]!) ? raw : ''
}

/** https の URL だけ(認証情報つき・長すぎるものは、捨てる) */
export function sanitizeLink(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > UI_LIMITS.maxLink) return ''
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && u.username === '' && u.password === '' ? u.href : ''
  } catch {
    return ''
  }
}

const ICON_KEY_RE = /^[A-Za-z0-9_-]{1,40}$/

/** host.ui.list.set に渡された値を、窓に出せる形にする。壊れた項目は捨てる(id が重複したら、先のもの) */
export function sanitizeUiList(raw: unknown): UiList {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const icons: Record<string, string> = {}
  if (typeof r.icons === 'object' && r.icons !== null && !Array.isArray(r.icons)) {
    for (const [k, v] of Object.entries(r.icons as Record<string, unknown>)) {
      if (Object.keys(icons).length >= UI_LIMITS.maxIcons) break
      const url = ICON_KEY_RE.test(k) ? sanitizeIcon(v) : ''
      if (url !== '') icons[k] = url
    }
  }
  const seen = new Set<string>()
  const items: UiListItem[] = []
  if (Array.isArray(r.items)) {
    for (const it of r.items) {
      if (items.length >= UI_LIMITS.maxItems) break
      if (typeof it !== 'object' || it === null) continue
      const o = it as Record<string, unknown>
      const id = text(o.id, UI_LIMITS.maxId)
      const title = text(o.title, UI_LIMITS.maxTitle)
      if (id === '' || title === '' || seen.has(id)) continue
      seen.add(id)
      items.push({ id, title, subtitle: text(o.subtitle, UI_LIMITS.maxSubtitle), icon: typeof o.icon === 'string' && Object.prototype.hasOwnProperty.call(icons, o.icon) ? o.icon : '', link: sanitizeLink(o.link), unread: o.unread === true })
    }
  }
  return { title: text(r.title, UI_LIMITS.maxHeading), empty: text(r.empty, UI_LIMITS.maxEmpty), icons, items }
}
