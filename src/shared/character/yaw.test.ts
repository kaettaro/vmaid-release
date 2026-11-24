import { describe, expect, it } from 'vitest'
import { clampPitch, dragToPitch, dragToYaw, PITCH_LIMIT, shortestDelta, snapPitch, snapYaw, stepPitch, stepYaw, wrapDeg } from './yaw'

describe('wrapDeg', () => {
  it('-180〜180 に丸める', () => {
    expect(wrapDeg(190)).toBe(-170)
    expect(wrapDeg(-190)).toBe(170)
    expect(wrapDeg(360)).toBe(0)
    expect(wrapDeg(180)).toBe(180)
    expect(wrapDeg(NaN)).toBe(0)
  })
})

describe('shortestDelta', () => {
  it('境界をまたぐときは短いほうへ回る', () => {
    expect(shortestDelta(170, -170)).toBe(20)
    expect(shortestDelta(-170, 170)).toBe(-20)
    expect(shortestDelta(0, 90)).toBe(90)
  })
})

describe('stepYaw', () => {
  it('目標に近づき、行き過ぎない', () => {
    const a = stepYaw(0, 90, 1 / 60)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(90)
    expect(stepYaw(0, 90, 10)).toBeGreaterThan(89)
    expect(stepYaw(0, 90, 10)).toBeLessThanOrEqual(90)
  })
  it('最短経路で回る', () => {
    expect(stepYaw(170, -170, 1 / 30)).toBeGreaterThan(170)
  })
  it('dt が 0 なら動かない', () => {
    expect(stepYaw(10, 90, 0)).toBe(10)
  })
})

describe('dragToYaw', () => {
  it('右へのドラッグで正の向きに増える', () => {
    expect(dragToYaw(0, 100)).toBeCloseTo(60)
    expect(dragToYaw(170, 50)).toBeCloseTo(-160)
  })
})

describe('snapYaw', () => {
  it('45°刻みの近くなら吸着する', () => {
    expect(snapYaw(3)).toBe(0)
    expect(snapYaw(-4)).toBe(0)
    expect(snapYaw(87)).toBe(90)
    expect(snapYaw(178)).toBe(180)
    expect(Math.abs(snapYaw(-176))).toBe(180)
  })
  it('離れていれば、そのまま', () => {
    expect(snapYaw(20)).toBe(20)
    expect(snapYaw(-60)).toBe(-60)
  })
})

describe('pitch(上下の傾き)', () => {
  it('下へのドラッグで正(頭が手前に倒れる)。上限・下限で止まる', () => {
    expect(dragToPitch(0, 50)).toBeCloseTo(30)
    expect(dragToPitch(0, -50)).toBeCloseTo(-30)
    expect(dragToPitch(70, 100)).toBe(PITCH_LIMIT)
    expect(clampPitch(-500)).toBe(-PITCH_LIMIT)
    expect(clampPitch(NaN)).toBe(0)
  })
  it('0° と ±45° の近くで吸着する', () => {
    expect(snapPitch(4)).toBe(0)
    expect(snapPitch(-43)).toBe(-45)
    expect(snapPitch(20)).toBe(20)
  })
  it('目標へ近づき、行き過ぎない', () => {
    const a = stepPitch(0, 40, 1 / 60)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(40)
    expect(stepPitch(0, 40, 10)).toBeLessThanOrEqual(40)
    expect(stepPitch(10, 40, 0)).toBe(10)
  })
})
