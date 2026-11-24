import { describe, expect, it } from 'vitest'
import { DOUBLE_CLICK_MAX_MS, isDoubleClick } from './clicks'

describe('isDoubleClick', () => {
  const first = { x: 100, y: 100, time: 1000 }
  it('直前のクリックが無ければダブルではない', () => {
    expect(isDoubleClick(null, first)).toBe(false)
  })
  it('時間内・近い位置ならダブル', () => {
    expect(isDoubleClick(first, { x: 104, y: 98, time: 1200 })).toBe(true)
    expect(isDoubleClick(first, { x: 100, y: 100, time: 1000 + DOUBLE_CLICK_MAX_MS })).toBe(true)
  })
  it('時間が空きすぎ・位置が離れすぎならダブルではない', () => {
    expect(isDoubleClick(first, { x: 100, y: 100, time: 1000 + DOUBLE_CLICK_MAX_MS + 1 })).toBe(false)
    expect(isDoubleClick(first, { x: 140, y: 100, time: 1100 })).toBe(false)
  })
  it('時刻が逆転していたら(不正)ダブルではない', () => {
    expect(isDoubleClick(first, { x: 100, y: 100, time: 900 })).toBe(false)
  })
})
