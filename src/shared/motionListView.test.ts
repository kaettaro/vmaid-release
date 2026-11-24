import { describe, expect, it } from 'vitest'
import {
  deselectVisible,
  filterMotions,
  NO_FILTER,
  pruneSelection,
  selectAllVisible,
  selectRange,
  sortMotions,
  toggleOne,
  visibleSelectionState,
  windowRange,
  type ListedMotion
} from './motionListView'

const items: ListedMotion[] = [
  { name: 'wave', origin: 'builtin', tags: ['あいさつ', 'リアクション'] },
  { name: 'dance1', origin: 'builtin', tags: ['ダンス'] },
  { name: 'Spicy_Chill', origin: 'user', tags: ['寝る', 'Spicy'] },
  { name: 'spicy_dance', origin: 'user', tags: ['ダンス', 'Spicy'] },
  { name: 'plain', origin: 'user', tags: [] },
  { name: 'p/shy', origin: 'pack', tags: ['p', 'ふれあい'] }
]
const names = (l: ListedMotion[]): string[] => l.map((i) => i.name)

describe('filterMotions', () => {
  it('条件なしなら、全件(順序もそのまま。元の配列とは別のもの)', () => {
    const r = filterMotions(items, NO_FILTER)
    expect(names(r)).toEqual(names(items))
    expect(r).not.toBe(items)
  })
  it('検索語は、名前とタグが対象で、大文字小文字・全角半角を問わない。複数の語はすべてを含むもの', () => {
    expect(names(filterMotions(items, { ...NO_FILTER, query: 'SPICY' }))).toEqual(['Spicy_Chill', 'spicy_dance'])
    expect(names(filterMotions(items, { ...NO_FILTER, query: 'ｓｐｉｃｙ ダンス' }))).toEqual(['spicy_dance'])
    expect(names(filterMotions(items, { ...NO_FILTER, query: 'あいさつ' }))).toEqual(['wave'])
    expect(names(filterMotions(items, { ...NO_FILTER, query: 'zzz' }))).toEqual([])
    expect(names(filterMotions(items, { ...NO_FILTER, query: '   ' }))).toHaveLength(6)
  })
  it('タグで絞る: 選んだタグを、すべて持つもの', () => {
    expect(names(filterMotions(items, { ...NO_FILTER, tags: ['ダンス'] }))).toEqual(['dance1', 'spicy_dance'])
    expect(names(filterMotions(items, { ...NO_FILTER, tags: ['ダンス', 'Spicy'] }))).toEqual(['spicy_dance'])
  })
  it('タグなしだけ / 出どころで絞る', () => {
    expect(names(filterMotions(items, { ...NO_FILTER, untaggedOnly: true }))).toEqual(['plain'])
    expect(names(filterMotions(items, { ...NO_FILTER, origin: 'user' }))).toEqual(['Spicy_Chill', 'spicy_dance', 'plain'])
    expect(names(filterMotions(items, { ...NO_FILTER, origin: 'pack' }))).toEqual(['p/shy'])
  })
  it('条件は組み合わせられる', () => {
    expect(names(filterMotions(items, { query: 'dance', tags: ['Spicy'], untaggedOnly: false, origin: 'user' }))).toEqual(['spicy_dance'])
  })
  it('1万件でも速い', () => {
    const big: ListedMotion[] = Array.from({ length: 10000 }, (_, i) => ({ name: `motion_${i}`, origin: 'user', tags: [`t${i % 30}`, 'all'] }))
    const t0 = performance.now()
    const r = filterMotions(big, { query: 'motion_9', tags: ['t7'], untaggedOnly: false, origin: 'user' })
    expect(performance.now() - t0).toBeLessThan(300)
    expect(r.length).toBeGreaterThan(0)
  })
})

describe('sortMotions', () => {
  it('registered は、そのままの順(別の配列)。name は、数字を数として、日本語の順で並べる', () => {
    const list: ListedMotion[] = ['m10', 'm2', 'M1', 'あ', 'い'].map((name) => ({ name, origin: 'user', tags: [] }))
    expect(names(sortMotions(list, 'registered'))).toEqual(['m10', 'm2', 'M1', 'あ', 'い'])
    expect(names(sortMotions(list, 'name'))).toEqual(['M1', 'm2', 'm10', 'あ', 'い'])
    expect(sortMotions(list, 'registered')).not.toBe(list)
  })
})

describe('複数選択', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  it('toggleOne: 元の集合は変えない', () => {
    const s = new Set(['a'])
    expect([...toggleOne(s, 'b')]).toEqual(['a', 'b'])
    expect([...toggleOne(s, 'a')]).toEqual([])
    expect([...s]).toEqual(['a'])
  })
  it('selectRange: anchor から target まで(逆向きでも)。anchor が無ければ target だけ', () => {
    expect([...selectRange(new Set(), order, 'b', 'd')]).toEqual(['b', 'c', 'd'])
    expect([...selectRange(new Set(), order, 'd', 'b')].sort()).toEqual(['b', 'c', 'd'])
    expect([...selectRange(new Set(), order, null, 'c')]).toEqual(['c'])
    expect([...selectRange(new Set(['a']), order, 'c', 'd')].sort()).toEqual(['a', 'c', 'd'])
  })
  it('selectRange: 見えていない行が anchor なら、target だけを切り替える。target が見えなければ、変えない', () => {
    expect([...selectRange(new Set(), order, 'zzz', 'c')]).toEqual(['c'])
    expect([...selectRange(new Set(['a']), order, 'a', 'zzz')]).toEqual(['a'])
  })
  it('見えているものだけを、まとめて選ぶ・外す(見えていないものの選択は残す)', () => {
    const s = new Set(['x'])
    expect([...selectAllVisible(s, ['a', 'b'])].sort()).toEqual(['a', 'b', 'x'])
    expect([...deselectVisible(new Set(['a', 'b', 'x']), ['a', 'b'])]).toEqual(['x'])
  })
  it('一覧に無くなった名前は、選択から外す。変わらなければ同じ集合', () => {
    const s = new Set(['a', 'b'])
    expect(pruneSelection(s, new Set(['a', 'b', 'c']))).toBe(s)
    expect([...pruneSelection(s, new Set(['a']))]).toEqual(['a'])
  })
  it('ヘッダーのチェックの状態', () => {
    expect(visibleSelectionState(new Set(), ['a', 'b'])).toBe('none')
    expect(visibleSelectionState(new Set(['a']), ['a', 'b'])).toBe('some')
    expect(visibleSelectionState(new Set(['a', 'b', 'x']), ['a', 'b'])).toBe('all')
    expect(visibleSelectionState(new Set(['a']), [])).toBe('none')
  })
})

describe('windowRange(仮想化)', () => {
  it('先頭: 見える行 + 下の余分だけを描く。上の余白は 0', () => {
    const r = windowRange(0, 400, 40, 1000, 5)
    expect(r.start).toBe(0)
    expect(r.end).toBe(15) // 見える 10 行 + 5
    expect(r.padTop).toBe(0)
    expect(r.padBottom).toBe((1000 - 15) * 40)
  })
  it('途中: 上下に余分を持ち、余白と合わせて、全体の高さになる', () => {
    const r = windowRange(4000, 400, 40, 1000, 5)
    expect(r.start).toBe(95)
    expect(r.end).toBe(115)
    expect(r.padTop + (r.end - r.start) * 40 + r.padBottom).toBe(1000 * 40)
  })
  it('末尾を越えてスクロールしても、範囲が壊れない', () => {
    const r = windowRange(999999, 400, 40, 100, 5)
    expect(r.end).toBe(100)
    expect(r.start).toBeLessThanOrEqual(r.end)
    expect(r.padBottom).toBe(0)
  })
  it('0 件・不正な高さでも、空の範囲', () => {
    expect(windowRange(0, 400, 40, 0)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
    expect(windowRange(0, 400, 0, 10)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
  })
  it('描く行数は、件数が増えても一定(数万件でも軽い)', () => {
    const r = windowRange(123456, 600, 44, 50000)
    expect(r.end - r.start).toBeLessThan(40)
  })
})
