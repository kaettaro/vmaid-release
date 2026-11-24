import { describe, expect, it } from 'vitest'
import { danceBgmPaths, findDance, parseDanceDrafts, parseDances, serializeDanceDrafts, serializeDances } from './dance'

const table = (): ReturnType<typeof parseDances> =>
  parseDances(
    JSON.stringify([
      { name: 'ワルツ', motion: 'waltz', bgm: 'C:/m/waltz.mp3', offsetSec: 1.5, volume: 0.8 },
      { name: 'ワルツ・アレンジ', motion: 'waltz2', bgm: '' },
      { name: 'ロック', motion: 'rock', bgm: '/m/rock.wav' }
    ])
  )

describe('parseDances / serializeDances', () => {
  it('壊れた JSON・配列でないものは空', () => {
    expect(parseDances('{')).toEqual([])
    expect(parseDances('{}')).toEqual([])
    expect(parseDances(undefined)).toEqual([])
  })
  it('壊れた行だけ捨て、範囲を丸める', () => {
    const t = parseDances(JSON.stringify([{ name: 'a', motion: 'm', offsetSec: -3, volume: 5 }, { name: '', motion: 'x' }, 7]))
    expect(t).toEqual([{ name: 'a', motion: 'm', bgm: '', offsetSec: 0, volume: 1 }])
  })
  it('書き出して読み直すと同じ。空の表は、空の文字列', () => {
    expect(parseDances(serializeDances(table()))).toEqual(table())
    expect(serializeDances([])).toBe('')
  })
})

describe('findDance', () => {
  it('名前の完全一致(全角・半角・記号・空白は区別しない)', () => {
    expect(findDance(table(), 'ワルツ')?.motion).toBe('waltz')
    expect(findDance(table(), ' ロック! ')?.motion).toBe('rock')
  })
  it('助詞つきでも合う。長い名前を優先する', () => {
    expect(findDance(table(), 'ロックを')?.motion).toBe('rock')
    expect(findDance(table(), 'ワルツアレンジを')?.motion).toBe('waltz2')
  })
  it('入力が行の名前の一部でも合う(2 文字以上)。1 文字は合わない', () => {
    expect(findDance(table(), 'アレンジ')?.motion).toBe('waltz2')
    expect(findDance(table(), 'ア')).toBeUndefined()
  })
  it('合わなければ undefined、空の入力も undefined', () => {
    expect(findDance(table(), 'タンゴ')).toBeUndefined()
    expect(findDance(table(), '')).toBeUndefined()
  })
  it('BGM のパス(空は除く)', () => {
    expect(danceBgmPaths(table())).toEqual(['C:/m/waltz.mp3', '/m/rock.wav'])
  })
})

describe('編集中の行(下書き)', () => {
  const draft = { name: '', motion: 'wave', bgm: 'C:/m/a.wav', offsetSec: 2, volume: 0.5 }
  it('名前が空の行も、選んだモーション・曲ごと、保存して読み直せる(画面が作り直されても消えない)', () => {
    const text = serializeDanceDrafts([draft])
    expect(text).not.toBe('')
    expect(parseDanceDrafts(text)).toEqual([draft])
  })
  it('名前が空の行は、実際に使う表には入らない(曲の許可リストにも入らない)', () => {
    const text = serializeDanceDrafts([draft, { ...draft, name: 'ワルツ', bgm: 'C:/m/w.wav' }])
    expect(parseDances(text).map((e) => e.name)).toEqual(['ワルツ'])
    expect(danceBgmPaths(parseDances(text))).toEqual(['C:/m/w.wav'])
  })
  it('同じ名前の行も、編集中は残す。空なら、空の文字列', () => {
    const two = [{ ...draft, name: 'a' }, { ...draft, name: 'a', motion: 'nod' }]
    expect(parseDanceDrafts(serializeDanceDrafts(two))).toHaveLength(2)
    expect(serializeDanceDrafts([])).toBe('')
    expect(parseDanceDrafts('壊れた')).toEqual([])
  })
})
