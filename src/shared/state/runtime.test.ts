import { describe, expect, it } from 'vitest'
import { activeModes, changeEmotion, emotionValue, endMode, normalizeStateName, pruneEmotions, releaseModes, setEmotion, startMode, type Emotions, type Modes } from './runtime'

describe('状態(モード)', () => {
  it('開始・終了・自動終了', () => {
    const m: Modes = new Map()
    startMode(m, 'ねむい', 0, null, 1000)
    startMode(m, 'ちょっと', 5, null, 1000)
    expect([...activeModes(m, 2000)].sort()).toEqual(['ちょっと', 'ねむい'])
    expect([...activeModes(m, 7000)]).toEqual(['ねむい']) // 5秒たったので、終わる
    endMode(m, 'ねむい')
    expect(activeModes(m, 7000).size).toBe(0)
  })

  it('名前の検査と数の上限', () => {
    expect(normalizeStateName(' a ')).toBe('a')
    expect(normalizeStateName('')).toBeNull()
    expect(normalizeStateName('a,b')).toBeNull()
    expect(normalizeStateName('あ'.repeat(25))).toBeNull()
    expect(normalizeStateName(3)).toBeNull()
    const m: Modes = new Map()
    for (let i = 0; i < 80; i++) startMode(m, `s${i}`, 0, null, 0)
    expect(m.size).toBe(50)
  })

  it('Mod が始めた状態だけを、まとめて終わらせる(自分のルールのものと、残す Mod のものは残る)', () => {
    const m: Modes = new Map()
    startMode(m, 'mine', 0, null, 0)
    startMode(m, 'a1', 0, 'mod-a', 0)
    startMode(m, 'b1', 0, 'mod-b', 0)
    expect(releaseModes(m, new Set(['mod-b'])).sort()).toEqual(['a1'])
    expect([...m.keys()].sort()).toEqual(['b1', 'mine'])
    expect(releaseModes(m, new Set())).toEqual(['b1'])
    expect([...m.keys()]).toEqual(['mine'])
  })
})

describe('感情値', () => {
  it('決める・増減する(0〜100)。0 になったら持たない', () => {
    let e: Emotions = {}
    e = setEmotion(e, 'joy', 50, 0)
    e = changeEmotion(e, 'joy', 70, 0)
    expect(emotionValue(e, 'joy', 0)).toBe(100)
    e = changeEmotion(e, 'joy', -200, 0)
    expect(e).toEqual({})
    expect(emotionValue(e, 'joy', 0)).toBe(0)
  })

  it('時間で、1分に1ずつ、0 に向かって減る', () => {
    const e = setEmotion({}, 'joy', 10, 0)
    expect(emotionValue(e, 'joy', 3 * 60_000)).toBe(7)
    expect(emotionValue(e, 'joy', 60 * 60_000)).toBe(0)
    expect(pruneEmotions(e, 60 * 60_000)).toEqual({})
    expect(Object.keys(pruneEmotions(e, 60_000))).toEqual(['joy'])
  })

  it('不正な名前・数の上限', () => {
    expect(setEmotion({}, '', 5, 0)).toEqual({})
    let e: Emotions = {}
    for (let i = 0; i < 50; i++) e = setEmotion(e, `e${i}`, 5, 0)
    expect(Object.keys(e)).toHaveLength(30)
    expect(emotionValue(setEmotion(e, 'e0', 9, 0), 'e0', 0)).toBe(9) // 既にあるものは、更新できる
  })
})
