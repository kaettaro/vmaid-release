import { describe, expect, it } from 'vitest'
import { bubbleDisplayMs, INPUT_IDLE_CLOSE_MS, shouldAutoCloseInput, uiScaleForWidth } from './bubble'

describe('bubbleDisplayMs', () => {
  it('短文でも最低6秒、長文でも最大30秒', () => {
    expect(bubbleDisplayMs('')).toBe(6000)
    expect(bubbleDisplayMs('はい')).toBe(6000)
    expect(bubbleDisplayMs('あ'.repeat(100))).toBe(18000)
    expect(bubbleDisplayMs('あ'.repeat(5000))).toBe(30000)
  })
})

describe('uiScaleForWidth', () => {
  it('基準幅以上は等倍、小さいウィンドウは縮小、下限あり', () => {
    expect(uiScaleForWidth(400)).toBe(1)
    expect(uiScaleForWidth(800)).toBe(1)
    expect(uiScaleForWidth(300)).toBe(0.75)
    expect(uiScaleForWidth(100)).toBe(0.6)
    expect(uiScaleForWidth(NaN)).toBe(1)
  })
})

describe('shouldAutoCloseInput', () => {
  it('空で、返答待ち・返答中でないときだけ、放置で閉じてよい', () => {
    expect(shouldAutoCloseInput('', 'idle')).toBe(true)
    expect(shouldAutoCloseInput('   ', 'error')).toBe(true)
    expect(shouldAutoCloseInput('こんに', 'idle')).toBe(false) // 書きかけは閉じない
    expect(shouldAutoCloseInput('', 'waiting')).toBe(false)
    expect(shouldAutoCloseInput('', 'streaming')).toBe(false)
    expect(INPUT_IDLE_CLOSE_MS).toBeGreaterThan(10000)
  })
})
