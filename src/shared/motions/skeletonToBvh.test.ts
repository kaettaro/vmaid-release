import { describe, expect, it } from 'vitest'
import { jointPositions } from './bvhRetarget'
import { qAxisAngle, qInv, qMul, qNormalize, qRotate, type Quat, type Vec3 } from './quat'
import { quatToZyx, skeletonToBvh, type SampledSkeleton } from './skeletonToBvh'

const DEG = Math.PI / 180
const near = (a: Vec3, b: Vec3, eps = 1e-3): void => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps))
const randQ = (seed: number): Quat => qNormalize([Math.sin(seed * 1.3), Math.cos(seed * 2.1), Math.sin(seed * 0.7 + 1), Math.cos(seed * 1.9 + 2)])

describe('quatToZyx', () => {
  it('Rz·Ry·Rx に分解でき、同じ回転に戻る(ジンバルロックの近くも)', () => {
    for (let i = 1; i <= 40; i++) {
      const q = randQ(i)
      const [a, b, c] = quatToZyx(q) // x, y, z の角度(度)
      const back = qMul(qMul(qAxisAngle('z', c * DEG), qAxisAngle('y', b * DEG)), qAxisAngle('x', a * DEG))
      const v: Vec3 = [0.3, 0.5, 0.8]
      near(qRotate(back, v), qRotate(q, v))
    }
    const lock = qMul(qAxisAngle('y', 90 * DEG), qAxisAngle('x', 30 * DEG))
    const [a, b, c] = quatToZyx(lock)
    const back = qMul(qMul(qAxisAngle('z', c * DEG), qAxisAngle('y', b * DEG)), qAxisAngle('x', a * DEG))
    near(qRotate(back, [1, 2, 3]), qRotate(lock, [1, 2, 3]))
  })
})

/** 基準姿勢で回転を持つ骨の鎖(hips → spine → head)を作り、時刻ごとのワールド姿勢から、位置を計算する */
function chain(): SampledSkeleton {
  const restRot: Quat[] = [randQ(1), randQ(2), randQ(3)]
  const restPos: Vec3[] = [
    [0, 100, 0],
    [0, 120, 5],
    [0, 150, 8]
  ]
  const frames = [0, 1, 2, 3].map((t) => {
    const rot: Quat[] = [randQ(10 + t), randQ(20 + t), randQ(30 + t)]
    const pos: Vec3[] = [[10 * t, 100 + t, -5 * t], [0, 0, 0], [0, 0, 0]]
    for (const i of [1, 2]) {
      // 子の位置 = 親の位置 + 親の(その時刻の)姿勢 × 「親の基準姿勢の座標での、基準姿勢の差」
      const local = qRotate(qInv(restRot[i - 1]), [restPos[i][0] - restPos[i - 1][0], restPos[i][1] - restPos[i - 1][1], restPos[i][2] - restPos[i - 1][2]])
      const r = qRotate(rot[i - 1], local)
      pos[i] = [pos[i - 1][0] + r[0], pos[i - 1][1] + r[1], pos[i - 1][2] + r[2]]
    }
    return { pos, rot }
  })
  return {
    joints: [
      { name: 'Hips', parent: -1, restPos: restPos[0], restRot: restRot[0] },
      { name: 'Spine', parent: 0, restPos: restPos[1], restRot: restRot[1] },
      { name: 'Head', parent: 1, restPos: restPos[2], restRot: restRot[2] }
    ],
    frameTime: 1 / 30,
    frames
  }
}

describe('skeletonToBvh', () => {
  it('BVH として読むと、各時刻の関節のワールド位置が、もとと一致する(基準姿勢が回転していても)', () => {
    const s = chain()
    const r = skeletonToBvh(s)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.bvh.frames).toBe(4)
    expect(r.bvh.joints[0].channels).toHaveLength(6)
    expect(r.bvh.joints[1].channels).toEqual(['Zrotation', 'Yrotation', 'Xrotation'])
    s.frames.forEach((f, fi) => {
      const p = jointPositions(r.bvh, fi)
      p.forEach((pos, i) => near(pos, f.pos[i], 0.05))
    })
  })

  it('空・多すぎる・親が後ろに並んだ骨格は、断る', () => {
    expect(skeletonToBvh({ joints: [], frameTime: 0.03, frames: [] }).ok).toBe(false)
    const s = chain()
    expect(skeletonToBvh({ ...s, frames: [] }).ok).toBe(false)
    expect(skeletonToBvh({ ...s, joints: [{ ...s.joints[0], parent: 1 }, s.joints[1], s.joints[2]] }).ok).toBe(false)
  })
})
