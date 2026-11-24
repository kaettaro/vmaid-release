import { describe, expect, it } from 'vitest'
import { BlinkController } from './blink'
import { initialState, pickRandom, transition, type CharEvent, type CharState } from './stateMachine'

const run = (state: CharState, ...events: CharEvent[]) =>
  events.reduce((s, e) => transition(s, e).state, state)

describe('状態機械', () => {
  it('idle で oneShot 要求 → 再生して oneShot 状態へ', () => {
    const t = transition(initialState, { type: 'oneShot', clip: 'wave' })
    expect(t.state).toEqual({ kind: 'oneShot', clip: 'wave' })
    expect(t.effects).toEqual([{ type: 'playOneShot', clip: 'wave' }])
  })
  it('oneShot が終わると idle に戻って待機再生', () => {
    const t = transition({ kind: 'oneShot', clip: 'wave' }, { type: 'oneShotEnded' })
    expect(t.state).toEqual({ kind: 'idle' })
    expect(t.effects).toEqual([{ type: 'playIdle' }])
  })
  it('oneShot 再生中の oneShot 要求は破棄', () => {
    const t = transition({ kind: 'oneShot', clip: 'a' }, { type: 'oneShot', clip: 'b' })
    expect(t.state).toEqual({ kind: 'oneShot', clip: 'a' })
    expect(t.effects).toEqual([])
  })
  it('speaking 中の oneShot 要求は破棄', () => {
    const t = transition({ kind: 'speaking' }, { type: 'oneShot', clip: 'dance1' })
    expect(t.state).toEqual({ kind: 'speaking' })
    expect(t.effects).toEqual([])
  })
  it('oneShot 中に喋り始めたら中断して speaking へ', () => {
    const t = transition({ kind: 'oneShot', clip: 'a' }, { type: 'speakStart' })
    expect(t.state).toEqual({ kind: 'speaking' })
    expect(t.effects).toEqual([{ type: 'stopOneShot' }, { type: 'playSpeaking' }])
  })
  it('idle で喋り始めたら喋り中モーションを再生する', () => {
    const t = transition(initialState, { type: 'speakStart' })
    expect(t.state).toEqual({ kind: 'speaking' })
    expect(t.effects).toEqual([{ type: 'playSpeaking' }])
    expect(transition(t.state, { type: 'speakStart' }).effects).toEqual([]) // 二重開始は無視
  })
  it('speakEnd で idle に戻る。speaking 以外での speakEnd / oneShotEnded は無視', () => {
    expect(run(initialState, { type: 'speakStart' }, { type: 'speakEnd' })).toEqual({ kind: 'idle' })
    expect(transition(initialState, { type: 'speakEnd' }).effects).toEqual([])
    expect(transition({ kind: 'speaking' }, { type: 'oneShotEnded' }).state).toEqual({ kind: 'speaking' })
  })
})

describe('pickRandom', () => {
  it('空配列は undefined、乱数1.0でも範囲外にならない', () => {
    expect(pickRandom([], () => 0.5)).toBeUndefined()
    expect(pickRandom(['a', 'b', 'c'], () => 0)).toBe('a')
    expect(pickRandom(['a', 'b', 'c'], () => 0.999999)).toBe('c')
    expect(pickRandom(['a', 'b', 'c'], () => 1)).toBe('c')
  })
})

describe('BlinkController', () => {
  // rng=0.5 → 間隔は 2 + 0.5*4 = 4秒
  const make = () => new BlinkController(() => 0.5)
  it('間隔が来るまでは開いたまま', () => {
    const b = make()
    for (let i = 0; i < 39; i++) expect(b.update(0.1)).toBe(0)
  })
  it('閉じて、保持して、開く。終われば0に戻り次の間隔へ', () => {
    const b = make()
    b.update(4) // ちょうど開始
    expect(b.update(0.03)).toBeCloseTo(0.5) // 閉じ途中(closeSec=0.06)
    expect(b.update(0.03)).toBeCloseTo(1) // 閉じきり
    expect(b.update(0.03)).toBe(1) // 保持中
    expect(b.update(0.07)).toBeCloseTo(0.5) // 開き途中(経過0.16s。開き始め0.10s、openSec=0.12)
    expect(b.update(0.1)).toBe(0) // 終了
    expect(b.update(3.9)).toBe(0) // 次の間隔の途中
  })
  it('値は常に 0〜1', () => {
    const b = new BlinkController(Math.random)
    for (let i = 0; i < 5000; i++) {
      const v = b.update(1 / 60)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
