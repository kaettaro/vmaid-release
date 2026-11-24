import { describe, expect, it } from 'vitest'
import { createFootLockState, resetFootLock, stepFootLock, type Vec3 } from './footLock'

const v = (x: number, y: number, z = 0): Vec3 => ({ x, y, z })
const REST = 0.07
const DT = 1 / 60

describe('stepFootLock', () => {
  it('軸足が右へ動いたら、モデルを左へずらして足を世界に留める', () => {
    const s = createFootLockState()
    stepFootLock(s, v(-0.1, REST), v(0.1, REST), REST, DT)
    // 左足(低さが同じなら左を軸にする)が +0.01 滑った
    stepFootLock(s, v(-0.09, REST), v(0.1, REST), REST, DT)
    expect(s.offsetX).toBeCloseTo(-0.01, 3)
  })

  it('空中の足は軸にしない(ジャンプ中は補正しない)', () => {
    const s = createFootLockState()
    stepFootLock(s, v(-0.1, 0.5), v(0.1, 0.5), REST, DT)
    stepFootLock(s, v(0.0, 0.5), v(0.2, 0.5), REST, DT)
    expect(s.offsetX).toBe(0)
  })

  it('軸足が入れ替わっても、新しい軸足自身の前フレームとの差で補正する', () => {
    const s = createFootLockState()
    stepFootLock(s, v(0, REST), v(0.3, 0.3), REST, DT)
    // 右足が着地(左は上がる)。右の前フレームは空中の位置なので、その差が出る
    stepFootLock(s, v(0, 0.3), v(0.3, REST), REST, DT)
    expect(s.offsetX).toBeCloseTo(0, 3)
    stepFootLock(s, v(0, 0.3), v(0.32, REST), REST, DT)
    expect(s.offsetX).toBeCloseTo(-0.02, 3)
  })

  it('1フレームで大きく飛んだ(ループの巻き戻りなど)ときは補正しない', () => {
    const s = createFootLockState()
    stepFootLock(s, v(0, REST), v(0.3, 0.3), REST, DT)
    stepFootLock(s, v(1.5, REST), v(0.3, 0.3), REST, DT)
    expect(s.offsetX).toBe(0)
  })

  it('動きが止まれば、ずらし量は0へ戻る', () => {
    const s = createFootLockState()
    stepFootLock(s, v(0, REST), v(0.3, 0.3), REST, DT)
    stepFootLock(s, v(0.1, REST), v(0.3, 0.3), REST, DT)
    const start = Math.abs(s.offsetX)
    for (let i = 0; i < 600; i++) stepFootLock(s, v(0.1, REST), v(0.3, 0.3), REST, DT)
    expect(Math.abs(s.offsetX)).toBeLessThan(start * 0.01)
  })

  it('ずらし量は上限を超えない', () => {
    const s = createFootLockState()
    let x = 0
    stepFootLock(s, v(x, REST), v(0.3, 0.3), REST, DT)
    for (let i = 0; i < 200; i++) {
      x += 0.1
      stepFootLock(s, v(x, REST), v(0.3, 0.3), REST, DT, { plantTolerance: 0.04, recoverSec: 1000, maxOffset: 0.6, maxStep: 0.25 })
    }
    expect(Math.hypot(s.offsetX, s.offsetZ)).toBeLessThanOrEqual(0.6 + 1e-9)
  })

  it('resetFootLock で状態を捨てる', () => {
    const s = createFootLockState()
    stepFootLock(s, v(0, REST), v(0.3, 0.3), REST, DT)
    stepFootLock(s, v(0.1, REST), v(0.3, 0.3), REST, DT)
    resetFootLock(s)
    expect(s).toEqual(createFootLockState())
  })
})
