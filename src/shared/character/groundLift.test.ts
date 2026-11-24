import { describe, expect, it } from 'vitest'
import { DEFAULT_GROUND_LIFT, stepGroundLift } from './groundLift'

const DT = 1 / 60
const run = (minJointY: number, frames: number, start = 0): number => {
  let lift = start
  for (let i = 0; i < frames; i++) lift = stepGroundLift(lift, minJointY, DT)
  return lift
}

describe('stepGroundLift', () => {
  it('関節が床の上にあるときは、何もしない(立ち姿の足首は約 7cm)', () => {
    expect(run(0.075, 120)).toBe(0)
    expect(run(DEFAULT_GROUND_LIFT.floorJointY, 120)).toBe(0)
  })

  it('床より下に入ったぶんだけ、持ち上げる(収束先は 床の高さ − 最低の関節の高さ)', () => {
    expect(run(-0.2, 120)).toBeCloseTo(DEFAULT_GROUND_LIFT.floorJointY + 0.2, 4)
  })

  it('持ち上げは速く(0.1 秒でほぼ届く)、下ろすのはゆっくり(0.1 秒ではまだ残る)', () => {
    const up = run(-0.2, 6) // 0.1 秒
    expect(up).toBeGreaterThan(0.2) // 目標 0.24 の 8 割以上
    const down = run(0.5, 6, 0.24) // 床の上に戻った 0.1 秒後
    expect(down).toBeGreaterThan(0.1)
    expect(run(0.5, 300, 0.24)).toBe(0) // 十分経てば 0 に戻る
  })

  it('持ち上げる量には上限がある(異常なポーズで、モデルが飛んでいかない)', () => {
    expect(run(-50, 600)).toBeLessThanOrEqual(DEFAULT_GROUND_LIFT.maxLift + 1e-9)
  })

  it('NaN や無限大の入力でも壊れない', () => {
    expect(stepGroundLift(0.3, NaN, DT)).toBeLessThanOrEqual(0.3)
    expect(Number.isFinite(stepGroundLift(0, -Infinity, DT))).toBe(true)
    expect(stepGroundLift(0, -0.2, -1)).toBe(0) // dt が負でも、後ろへ進まない
  })

  it('最低の関節が揺れても(床すれすれで上下)、持ち上げが急に増減しない', () => {
    let lift = 0
    let maxStep = 0
    for (let i = 0; i < 300; i++) {
      const y = 0.02 + 0.03 * Math.sin(i / 3) // 床の高さ 4cm をまたいで上下する
      const next = stepGroundLift(lift, y, DT)
      maxStep = Math.max(maxStep, Math.abs(next - lift))
      lift = next
    }
    expect(maxStep).toBeLessThan(0.02) // 1フレームに 2cm 以上は動かない
  })
})
