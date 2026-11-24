import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BLEND_MAX_SEC, BLEND_MIN_SEC, PoseBlender, blendDuration, smoothstep } from './poseBlender'

const bone = (yDeg = 0): THREE.Object3D => {
  const o = new THREE.Object3D()
  o.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yDeg))
  return o
}
const yDeg = (o: THREE.Object3D): number => THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').y)

describe('補間の時間', () => {
  it('ほとんど違わなければ 0(補間しない)。違いが大きいほど長く、上限・下限がある', () => {
    expect(blendDuration(0.01)).toBe(0)
    expect(blendDuration(0.1)).toBeGreaterThanOrEqual(BLEND_MIN_SEC)
    expect(blendDuration(0.5)).toBeGreaterThan(blendDuration(0.1))
    expect(blendDuration(10)).toBe(BLEND_MAX_SEC)
    expect(blendDuration(NaN)).toBe(0)
  })
  it('smoothstep は、0 と 1 を保ち、なめらか', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(1)).toBe(1)
    expect(smoothstep(0.5)).toBeCloseTo(0.5)
    expect(smoothstep(-1)).toBe(0)
    expect(smoothstep(2)).toBe(1)
  })
})

describe('PoseBlender', () => {
  it('始めは、覚えておいた姿勢から。時間がたつと、新しい姿勢に届く', () => {
    const b = bone(0)
    const blender = new PoseBlender()
    blender.begin([b]) // いまは 0 度
    b.quaternion.copy(bone(90).quaternion) // モーションが決めた新しい姿勢: 90 度
    blender.apply(1 / 60)
    expect(yDeg(b)).toBeGreaterThanOrEqual(0)
    expect(yDeg(b)).toBeLessThan(10) // 始めは、ほぼ元の姿勢
    let last = yDeg(b)
    for (let i = 0; i < 200; i++) {
      b.quaternion.copy(bone(90).quaternion) // mixer が毎フレーム書く
      blender.apply(1 / 60)
      expect(yDeg(b)).toBeGreaterThanOrEqual(last - 1e-6) // 戻らない
      last = yDeg(b)
    }
    expect(yDeg(b)).toBeCloseTo(90, 1)
    expect(blender.active).toBe(false)
  })

  it('ほとんど同じ姿勢なら、何もしない', () => {
    const b = bone(10)
    const blender = new PoseBlender()
    blender.begin([b])
    b.quaternion.copy(bone(10.5).quaternion)
    blender.apply(1 / 60)
    expect(yDeg(b)).toBeCloseTo(10.5, 3)
    expect(blender.active).toBe(false)
  })

  it('位置も補間する(hips の高さなど)', () => {
    const b = bone(0)
    b.position.set(0, 1, 0)
    const blender = new PoseBlender()
    b.quaternion.copy(bone(0).quaternion)
    blender.begin([b])
    b.position.set(0, 2, 0)
    b.quaternion.copy(bone(60).quaternion) // 回転に違いがあるので、補間が始まる
    blender.apply(1 / 60)
    expect(b.position.y).toBeGreaterThanOrEqual(1)
    expect(b.position.y).toBeLessThan(1.2)
  })

  it('途中で begin し直すと、そのときの見た目の姿勢から、やり直す', () => {
    const b = bone(0)
    const blender = new PoseBlender()
    blender.begin([b])
    b.quaternion.copy(bone(90).quaternion)
    for (let i = 0; i < 10; i++) {
      b.quaternion.copy(bone(90).quaternion)
      blender.apply(1 / 60)
    }
    const mid = yDeg(b)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(90)
    blender.begin([b]) // 途中の姿勢を覚え直す
    b.quaternion.copy(bone(-40).quaternion)
    blender.apply(1 / 60)
    expect(Math.abs(yDeg(b) - mid)).toBeLessThan(10) // 見た目が飛ばない
  })

  it('cancel すると、補間をやめる', () => {
    const b = bone(0)
    const blender = new PoseBlender()
    blender.begin([b])
    blender.cancel()
    b.quaternion.copy(bone(90).quaternion)
    blender.apply(1 / 60)
    expect(yDeg(b)).toBeCloseTo(90, 3)
  })
})
