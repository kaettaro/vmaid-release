import { describe, expect, it } from 'vitest'
import { AudioMouth, defaultAudioMouthOptions, rmsOf, targetOpen } from './audioMouth'

describe('targetOpen(音量 → 口の開き)', () => {
  it('無音・ノイズ程度は 0。大きくなるほど開き、上限で頭打ち。壊れた値は 0', () => {
    expect(targetOpen(0)).toBe(0)
    expect(targetOpen(defaultAudioMouthOptions.floor)).toBe(0)
    expect(targetOpen(NaN)).toBe(0)
    const small = targetOpen(0.03)
    const mid = targetOpen(0.08)
    expect(small).toBeGreaterThan(0)
    expect(mid).toBeGreaterThan(small)
    expect(targetOpen(5)).toBe(defaultAudioMouthOptions.maxOpen)
  })
})

describe('AudioMouth(なめらかな追従)', () => {
  it('音が来ると速く開き、止むとゆっくり閉じる。dt が大きくても行き過ぎない', () => {
    const m = new AudioMouth()
    const opened = m.update(0.15, 1 / 60)
    expect(opened).toBeGreaterThan(0.2)
    const afterBig = m.update(0.15, 10)
    expect(afterBig).toBeLessThanOrEqual(defaultAudioMouthOptions.maxOpen)
    const closing = m.update(0, 1 / 60)
    expect(closing).toBeLessThan(afterBig)
    expect(closing).toBeGreaterThan(0) // 1フレームでは閉じきらない
    for (let i = 0; i < 120; i++) m.update(0, 1 / 60)
    expect(m.update(0, 1 / 60)).toBeLessThan(0.001)
  })
  it('reset で閉じる', () => {
    const m = new AudioMouth()
    m.update(0.2, 1)
    m.reset()
    expect(m.update(0, 0)).toBe(0)
  })
})

describe('rmsOf', () => {
  it('RMS を求める。空は 0', () => {
    expect(rmsOf([])).toBe(0)
    expect(rmsOf([0, 0, 0])).toBe(0)
    expect(rmsOf([1, -1, 1, -1])).toBeCloseTo(1)
    expect(rmsOf([0.5, -0.5])).toBeCloseTo(0.5)
  })
})
