import { describe, expect, it } from 'vitest'
import { buildMotionList, mergeMotionNames, pickMotionSource, tagMapOf } from './motionIndex'

describe('mergeMotionNames', () => {
  it('内蔵 → パック → 登録の順に並べ、重複は最初の位置に1つだけ残す', () => {
    expect(mergeMotionNames(['idle', 'wave'], ['p/a', 'wave'], ['mine', 'p/a', 'idle'])).toEqual(['idle', 'wave', 'p/a', 'mine'])
  })
  it('空でも動く', () => {
    expect(mergeMotionNames([], [], [])).toEqual([])
  })
  it('数千件でも、順序と重複排除が保たれる', () => {
    const lib = Array.from({ length: 5000 }, (_, i) => `m${i}`)
    const out = mergeMotionNames(['idle'], [], [...lib, ...lib])
    expect(out).toHaveLength(5001)
    expect(out[1]).toBe('m0')
    expect(out[5000]).toBe('m4999')
  })
})

describe('pickMotionSource', () => {
  const s = { builtin: new Set(['idle', 'wave']), pack: new Set(['wave', 'p/a']), library: new Set(['wave', 'mine']) }
  it('同名なら 登録 > パック > 内蔵', () => {
    expect(pickMotionSource('wave', s)).toBe('library')
    expect(pickMotionSource('p/a', s)).toBe('pack')
    expect(pickMotionSource('idle', s)).toBe('builtin')
  })
  it('どこにも無ければ null', () => {
    expect(pickMotionSource('nope', s)).toBeNull()
  })
})

describe('buildMotionList(設定画面の一覧)', () => {
  const input = {
    builtin: ['idle', 'wave', 'dance1'],
    builtinTags: { idle: ['待機'], wave: ['あいさつ'], dance1: ['ダンス'] },
    pack: [
      { name: 'p/a', path: '/p/a.vrma', tags: ['p', '照れ'] },
      { name: 'wave', path: '/p/wave.vrma', tags: ['p'] }
    ],
    library: [
      { name: 'mine', path: '/m/mine.vrma' },
      { name: 'dance1', path: '/m/dance1.vrma' }
    ],
    userTags: { wave: ['好き'], mine: ['自作', '好き'], 'p/a': ['好き'] }
  }
  const items = buildMotionList(input)
  const by = (n: string) => items.find((i) => i.name === n)!

  it('内蔵 → パック → 登録の順で、同名は1行', () => {
    expect(items.map((i) => i.name)).toEqual(['idle', 'wave', 'dance1', 'p/a', 'mine'])
  })
  it('出どころは 登録 > パック > 内蔵', () => {
    expect(by('idle').origin).toBe('builtin')
    expect(by('wave').origin).toBe('pack') // パックが内蔵を隠す
    expect(by('dance1').origin).toBe('user') // 登録が内蔵を隠す
    expect(by('p/a').origin).toBe('pack')
    expect(by('mine').origin).toBe('user')
    expect(by('mine').path).toBe('/m/mine.vrma')
    expect(by('idle').path).toBeUndefined()
  })
  it('タグは「最初から持つタグ(外せない)+ 利用者のもの」。登録モーションに最初から持つタグは無い', () => {
    expect(by('idle')).toMatchObject({ tags: ['待機'], lockedTags: ['待機'] })
    expect(by('p/a')).toMatchObject({ tags: ['p', '照れ', '好き'], lockedTags: ['p', '照れ'] })
    expect(by('mine')).toMatchObject({ tags: ['自作', '好き'], lockedTags: [] })
    expect(by('dance1')).toMatchObject({ tags: [], lockedTags: [] }) // 登録が隠したので、内蔵のタグは引き継がない
    expect(by('wave').tags).toEqual(['p', '好き'])
  })
  it('tagMapOf は、タグがあるものだけ', () => {
    const m = tagMapOf(items)
    expect(Object.keys(m).sort()).toEqual(['idle', 'mine', 'p/a', 'wave'])
  })
  it('数千件でも速い', () => {
    const lib = Array.from({ length: 5000 }, (_, i) => ({ name: `m${i}`, path: `/x/m${i}.vrma` }))
    const t0 = performance.now()
    buildMotionList({ ...input, library: lib, userTags: {} })
    expect(performance.now() - t0).toBeLessThan(300)
  })
})
