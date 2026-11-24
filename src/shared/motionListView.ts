// モーション一覧の、絞り込み・並べ替え・複数選択・表示範囲の計算。Electron/React 非依存の純粋関数(テストできる)。
// 数千件でも、操作のたびに全件を作り直さないよう、計算は軽く保つ。

export interface ListedMotion {
  name: string
  origin: 'builtin' | 'pack' | 'user'
  tags: readonly string[]
}

export type OriginFilter = 'all' | 'user' | 'builtin' | 'pack'
export type SortKey = 'registered' | 'name'

export interface MotionFilter {
  /** 検索語。空白で区切った語の、すべてを含むもの(名前とタグが対象。大文字小文字・全角半角は問わない) */
  query: string
  /** 選んだタグ(すべてのタグを持つもの。空なら絞らない) */
  tags: readonly string[]
  /** タグが1つも付いていないものだけ */
  untaggedOnly: boolean
  origin: OriginFilter
}

export const NO_FILTER: MotionFilter = { query: '', tags: [], untaggedOnly: false, origin: 'all' }

const fold = (s: string): string => s.normalize('NFKC').toLowerCase()

export function filterMotions<T extends ListedMotion>(items: readonly T[], f: MotionFilter): T[] {
  const terms = fold(f.query).split(/\s+/).filter((t) => t !== '')
  const need = f.tags
  const plain = terms.length === 0 && need.length === 0 && !f.untaggedOnly && f.origin === 'all'
  if (plain) return [...items]
  return items.filter((it) => {
    if (f.origin !== 'all' && it.origin !== f.origin) return false
    if (f.untaggedOnly && it.tags.length > 0) return false
    for (const t of need) if (!it.tags.includes(t)) return false
    if (terms.length > 0) {
      const hay = fold(`${it.name} ${it.tags.join(' ')}`)
      for (const t of terms) if (!hay.includes(t)) return false
    }
    return true
  })
}

export function sortMotions<T extends ListedMotion>(items: readonly T[], key: SortKey): T[] {
  if (key === 'registered') return [...items]
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }))
}

// --- 複数選択 ---

/** 選択を、名前の集合で持つ(一覧が絞り込み・並べ替えで変わっても、選択は保つ) */
export type Selection = ReadonlySet<string>

export function toggleOne(sel: Selection, name: string): Set<string> {
  const next = new Set(sel)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}

/** Shift+クリック: 最後にクリックした行(anchor)から、いま押した行までを、まとめて選ぶ(順序は、いま見えている一覧) */
export function selectRange(sel: Selection, ordered: readonly string[], anchor: string | null, target: string): Set<string> {
  const to = ordered.indexOf(target)
  if (to < 0) return new Set(sel)
  const from = anchor === null ? to : ordered.indexOf(anchor)
  if (from < 0) return toggleOne(sel, target)
  const [a, b] = from <= to ? [from, to] : [to, from]
  const next = new Set(sel)
  for (let i = a; i <= b; i++) next.add(ordered[i])
  return next
}

/** いま見えているものを、すべて選ぶ(すでに選んであるものも残す) */
export function selectAllVisible(sel: Selection, visible: readonly string[]): Set<string> {
  const next = new Set(sel)
  for (const n of visible) next.add(n)
  return next
}

/** いま見えているものの選択を外す(見えていないものの選択は残す) */
export function deselectVisible(sel: Selection, visible: readonly string[]): Set<string> {
  const next = new Set(sel)
  for (const n of visible) next.delete(n)
  return next
}

/** 一覧に無くなった名前(削除・名前の変更)を、選択から外す */
export function pruneSelection(sel: Selection, existing: ReadonlySet<string>): Set<string> {
  const next = new Set<string>()
  for (const n of sel) if (existing.has(n)) next.add(n)
  return next.size === sel.size ? (sel as Set<string>) : next
}

/** 見えている行の選択の状態(ヘッダーの「すべて選択」の表示用) */
export function visibleSelectionState(sel: Selection, visible: readonly string[]): 'none' | 'some' | 'all' {
  if (visible.length === 0) return 'none'
  let n = 0
  for (const name of visible) if (sel.has(name)) n++
  return n === 0 ? 'none' : n === visible.length ? 'all' : 'some'
}

// --- 表示範囲(仮想化)---

export interface WindowRange {
  start: number
  end: number
  /** 先頭の、描かない行の高さ合計(px) */
  padTop: number
  /** 末尾の、描かない行の高さ合計(px) */
  padBottom: number
}

/** スクロール位置から、描く行の範囲を求める(上下に overscan 行ぶん余分に描く)。start 以上 end 未満 */
export function windowRange(scrollTop: number, viewportHeight: number, rowHeight: number, total: number, overscan = 6): WindowRange {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight)
  const start = Math.max(0, Math.min(total - 1, first) - overscan)
  const end = Math.min(total, first + visible + overscan)
  return { start, end: Math.max(start, end), padTop: start * rowHeight, padBottom: Math.max(0, (total - Math.max(start, end)) * rowHeight) }
}
