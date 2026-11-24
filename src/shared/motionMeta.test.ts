import { describe, expect, it } from 'vitest'
import {
  addTags,
  addTagsEach,
  deleteTag,
  effectiveTags,
  emptyMeta,
  folderTags,
  namesWithTag,
  normalizeTag,
  parentFolderTag,
  parseMeta,
  parseTagInput,
  removeMotionTags,
  removeTags,
  renameMotionTags,
  renameTag,
  setTags,
  tagCounts
} from './motionMeta'

describe('normalizeTag / parseTagInput', () => {
  it('前後の空白を除き、全角を半角にそろえる。1〜30文字、制御文字・区切り文字は不可', () => {
    expect(normalizeTag('  ダンス ')).toBe('ダンス')
    expect(normalizeTag('ＡＢＣ')).toBe('ABC')
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag('a'.repeat(31))).toBeNull()
    expect(normalizeTag('a'.repeat(30))).toBe('a'.repeat(30))
    expect(normalizeTag('a,b')).toBeNull()
    expect(normalizeTag('a\nb')).toBeNull()
    expect(normalizeTag('あ、い')).toBeNull()
  })
  it('入力欄の文字列を、カンマ・読点・空白・改行で分けて、重複を除く', () => {
    expect(parseTagInput('ダンス, 立ち  座り、ダンス\nA;B')).toEqual(['ダンス', '立ち', '座り', 'A', 'B'])
    expect(parseTagInput('')).toEqual([])
    expect(parseTagInput(' , 、 ')).toEqual([])
    expect(parseTagInput(`${'x'.repeat(31)} ok`)).toEqual(['ok'])
  })
})

describe('parseMeta', () => {
  it('壊れた項目だけを捨てる(全体は残す)', () => {
    const m = parseMeta({ version: 1, tags: { a: ['x', 'x', 5, ' y '], b: 'no', c: [], d: ['ok'] } })
    expect(m.tags).toEqual({ a: ['x', 'y'], d: ['ok'] })
  })
  it('不正な入力は空', () => {
    for (const bad of [null, undefined, 3, 'x', [], { tags: [] }, { tags: 'x' }]) expect(parseMeta(bad)).toEqual(emptyMeta())
  })
})

describe('addTags / removeTags / setTags', () => {
  const base = parseMeta({ tags: { a: ['x'], b: ['x', 'y'] } })
  it('複数のモーションに、タグをまとめて足す。重複は足さない', () => {
    const m = addTags(base, ['a', 'b', 'c'], ['y', 'z'])
    expect(m.tags).toEqual({ a: ['x', 'y', 'z'], b: ['x', 'y', 'z'], c: ['y', 'z'] })
  })
  it('変更が無ければ、同じオブジェクトを返す', () => {
    expect(addTags(base, ['b'], ['x'])).toBe(base)
    expect(addTags(base, [], ['x'])).toBe(base)
    expect(addTags(base, ['a'], ['', ','])).toBe(base)
    expect(removeTags(base, ['a'], ['nothing'])).toBe(base)
  })
  it('元のオブジェクトは変えない', () => {
    const copy = JSON.stringify(base)
    addTags(base, ['a'], ['q'])
    removeTags(base, ['a'], ['x'])
    expect(JSON.stringify(base)).toBe(copy)
  })
  it('タグを外して、空になった項目は消す', () => {
    const m = removeTags(base, ['a', 'b'], ['x'])
    expect(m.tags).toEqual({ b: ['y'] })
  })
  it('setTags で入れ替え、空にもできる', () => {
    expect(setTags(base, ['a', 'c'], ['n']).tags).toEqual({ a: ['n'], b: ['x', 'y'], c: ['n'] })
    expect(setTags(base, ['b'], []).tags).toEqual({ a: ['x'] })
  })
  it('1つのモーションのタグ数には上限がある', () => {
    const many = Array.from({ length: 80 }, (_, i) => `t${i}`)
    expect(addTags(emptyMeta(), ['a'], many).tags.a).toHaveLength(50)
  })
})

describe('addTagsEach(モーションごとに別のタグ)', () => {
  it('それぞれに、別のタグを足す。重複は足さない。元は変えない', () => {
    const base = parseMeta({ tags: { a: ['x'] } })
    const m = addTagsEach(base, [['a', ['x', 'y']], ['b', ['z']], ['c', []]])
    expect(m.tags).toEqual({ a: ['x', 'y'], b: ['z'] })
    expect(base.tags).toEqual({ a: ['x'] })
  })
  it('変更が無ければ、同じオブジェクト', () => {
    const base = parseMeta({ tags: { a: ['x'] } })
    expect(addTagsEach(base, [['a', ['x']], ['b', []]])).toBe(base)
    expect(addTagsEach(base, [])).toBe(base)
  })
  it('同じ名前が複数回出ても、足し合わせる', () => {
    expect(addTagsEach(emptyMeta(), [['a', ['x']], ['a', ['y']]]).tags.a).toEqual(['x', 'y'])
  })
  it('1万件でも速い(件数の2乗にならない)', () => {
    const pairs = Array.from({ length: 10000 }, (_, i) => [`m${i}`, ['t', `g${i % 10}`]] as const)
    const t0 = performance.now()
    const m = addTagsEach(emptyMeta(), pairs)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(Object.keys(m.tags)).toHaveLength(10000)
  })
})

describe('タグそのものの変更と、モーションの変更への追従', () => {
  const base = parseMeta({ tags: { a: ['x', 'y'], b: ['y'], c: ['z'] } })
  it('タグの名前を全モーションで変える。変更後が既にあればまとまる', () => {
    expect(renameTag(base, 'y', 'w').tags).toEqual({ a: ['x', 'w'], b: ['w'], c: ['z'] })
    expect(renameTag(base, 'y', 'x').tags.a).toEqual(['x'])
    expect(renameTag(base, 'none', 'w')).toBe(base)
    expect(renameTag(base, 'y', 'a,b')).toBe(base)
  })
  it('タグを全モーションから消す', () => {
    expect(deleteTag(base, 'y').tags).toEqual({ a: ['x'], c: ['z'] })
    expect(deleteTag(base, 'none')).toBe(base)
  })
  it('モーション名の変更に、タグが追従する', () => {
    expect(renameMotionTags(base, 'a', 'a2').tags).toEqual({ a2: ['x', 'y'], b: ['y'], c: ['z'] })
    expect(renameMotionTags(base, 'a', 'c').tags.c).toEqual(['z', 'x', 'y'])
    expect(renameMotionTags(base, 'none', 'x')).toBe(base)
  })
  it('モーションを外すと、その名前のタグも消える', () => {
    expect(removeMotionTags(base, ['a', 'c', 'zzz']).tags).toEqual({ b: ['y'] })
    expect(removeMotionTags(base, ['zzz'])).toBe(base)
  })
})

describe('集計と検索', () => {
  const tags = { a: ['x', 'y'], b: ['y'], c: ['z'] }
  it('実効のタグは 既定 + 利用者のもの(重複なし)', () => {
    expect(effectiveTags(['ダンス'], ['ダンス', '好き'])).toEqual(['ダンス', '好き'])
    expect(effectiveTags(undefined, undefined)).toEqual([])
  })
  it('タグごとの件数(多い順)', () => {
    expect(tagCounts(tags, ['a', 'b', 'c'])).toEqual([
      { tag: 'y', count: 2 },
      { tag: 'x', count: 1 },
      { tag: 'z', count: 1 }
    ])
    expect(tagCounts(tags, ['c'])).toEqual([{ tag: 'z', count: 1 }])
  })
  it('タグが付いたモーション名(渡した順)', () => {
    expect(namesWithTag(tags, 'y', ['c', 'b', 'a'])).toEqual(['b', 'a'])
    expect(namesWithTag(tags, 'none', ['a'])).toEqual([])
  })
  it('数千件でも速い', () => {
    const big: Record<string, string[]> = {}
    const names = Array.from({ length: 5000 }, (_, i) => `m${i}`)
    names.forEach((n, i) => (big[n] = [`t${i % 20}`, 'all']))
    const t0 = performance.now()
    tagCounts(big, names)
    namesWithTag(big, 't3', names)
    expect(performance.now() - t0).toBeLessThan(500)
  })
})

describe('取り込み時の自動タグ(フォルダ名)', () => {
  it('root からの相対のサブフォルダ名がタグになる。root 直下は、なし', () => {
    expect(folderTags('C:\\m', 'C:\\m\\a.bvh')).toEqual([])
    expect(folderTags('C:\\m', 'C:\\m\\dance\\sub\\a.bvh')).toEqual(['dance', 'sub'])
    expect(folderTags('/m', '/m/pose/a.bvh')).toEqual(['pose'])
  })
  it('不正な名前のフォルダは捨てる', () => {
    expect(folderTags('/m', `/m/${'x'.repeat(40)}/ok/a.bvh`)).toEqual(['ok'])
  })
  it('複数ファイルの取り込みは、ファイルのあるフォルダの名前を使う', () => {
    expect(parentFolderTag('C:\\Users\\a\\Spicy\\a.bvh')).toEqual(['Spicy'])
    expect(parentFolderTag('/x/y/z.vrma')).toEqual(['y'])
    expect(parentFolderTag('a.bvh')).toEqual([])
  })
})
