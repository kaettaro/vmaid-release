import { describe, expect, it } from 'vitest'
import { clampSeek, formatPlayback, formatSec, parsePlayback, progressRatio } from './playback'

describe('再生の状態', () => {
  it('時間の表示: 分:秒.小数 1 桁', () => {
    expect(formatSec(0)).toBe('0:00.0')
    expect(formatSec(1.26)).toBe('0:01.2')
    expect(formatSec(59.99)).toBe('0:59.9')
    expect(formatSec(61.5)).toBe('1:01.5')
    expect(formatSec(-3)).toBe('0:00.0')
    expect(formatSec(NaN)).toBe('0:00.0')
    expect(formatPlayback({ time: 1.2, duration: 4 })).toBe('0:01.2 / 0:04.0')
  })

  it('進み具合は 0〜1。長さが 0 なら 0', () => {
    expect(progressRatio({ time: 1, duration: 4 })).toBe(0.25)
    expect(progressRatio({ time: 9, duration: 4 })).toBe(1)
    expect(progressRatio({ time: -1, duration: 4 })).toBe(0)
    expect(progressRatio({ time: 1, duration: 0 })).toBe(0)
  })

  it('シークの位置は、範囲に収める', () => {
    expect(clampSeek(2, 4)).toBe(2)
    expect(clampSeek(9, 4)).toBe(4)
    expect(clampSeek(-1, 4)).toBe(0)
    expect(clampSeek(NaN, 4)).toBe(0)
    expect(clampSeek(2, 0)).toBe(0)
  })

  it('IPC の入力の検証: 形が正しければ受け取り、不正なら null', () => {
    expect(parsePlayback({ name: 'wave', time: 1, duration: 2.4, looping: true, paused: false })).toEqual({ name: 'wave', time: 1, duration: 2.4, looping: true, paused: false })
    expect(parsePlayback({ name: 'wave', time: 1, duration: 2 })).toEqual({ name: 'wave', time: 1, duration: 2, looping: false, paused: false })
    expect(parsePlayback(null)).toBeNull()
    expect(parsePlayback({ name: 1, time: 1, duration: 2 })).toBeNull()
    expect(parsePlayback({ name: 'a', time: NaN, duration: 2 })).toBeNull()
    expect(parsePlayback({ name: 'a'.repeat(300), time: 1, duration: 2 })).toBeNull()
  })
})
