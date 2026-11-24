import { describe, expect, it } from 'vitest'
import {
  BASE_WINDOW_SIZE,
  MAX_SCALE,
  MIN_SCALE,
  boundsAfterScale,
  clampScale,
  defaultPosition,
  isRectVisible,
  windowSizeForScale
} from './geometry'

describe('clampScale', () => {
  it('範囲内はそのまま、範囲外は丸める', () => {
    expect(clampScale(1.5)).toBe(1.5)
    expect(clampScale(0)).toBe(MIN_SCALE)
    expect(clampScale(99)).toBe(MAX_SCALE)
  })
  it('NaN/Infinity は 1 に戻す', () => {
    expect(clampScale(NaN)).toBe(1)
    expect(clampScale(Infinity)).toBe(1)
  })
})

describe('windowSizeForScale', () => {
  it('倍率1で基準サイズ', () => {
    expect(windowSizeForScale(1)).toEqual(BASE_WINDOW_SIZE)
  })
})

describe('boundsAfterScale', () => {
  it('拡大しても足元中央が動かない', () => {
    const before = { x: 100, y: 200, ...BASE_WINDOW_SIZE } // 足元中央 (300, 800)
    const after = boundsAfterScale(before, 2)
    expect(after.x + after.width / 2).toBe(300)
    expect(after.y + after.height).toBe(800)
    expect(after.width).toBe(800)
  })
})

describe('isRectVisible', () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1080 }
  it('画面内なら true', () => {
    expect(isRectVisible({ x: 100, y: 100, width: 400, height: 600 }, [screen])).toBe(true)
  })
  it('外した画面に保存された位置は false', () => {
    expect(isRectVisible({ x: 3000, y: 100, width: 400, height: 600 }, [screen])).toBe(false)
  })
  it('ほんの少ししかかかっていない場合は false', () => {
    expect(isRectVisible({ x: 1900, y: 100, width: 400, height: 600 }, [screen])).toBe(false)
  })
  it('サブディスプレイ上なら true', () => {
    const sub = { x: 1920, y: 0, width: 1280, height: 720 }
    expect(isRectVisible({ x: 2000, y: 50, width: 400, height: 600 }, [screen, sub])).toBe(true)
  })
})

describe('defaultPosition', () => {
  it('作業領域の右下に余白つきで置く', () => {
    const pos = defaultPosition({ x: 0, y: 25, width: 1440, height: 800 }, { width: 400, height: 600 })
    expect(pos).toEqual({ x: 1016, y: 201 })
  })
})
