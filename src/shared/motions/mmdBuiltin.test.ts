import { describe, expect, it } from 'vitest'
import { eulerToQuat } from './builder'
import { BUILTIN_MOTION_DEFS } from './builtin'
import { armRestFromBones, buildMmdBuiltinClip, MMD_BUILTIN_BONES } from './mmdBuiltin'

const ALL = new Set(Object.values(MMD_BUILTIN_BONES))
const def = (name: string) => BUILTIN_MOTION_DEFS.find((d) => d.name === name)!

describe('内蔵モーション → MMD の骨トラック', () => {
  it('全モーションが変換でき、時刻と回転の本数が合う', () => {
    for (const d of BUILTIN_MOTION_DEFS) {
      const clip = buildMmdBuiltinClip(d, { left: 0, right: 0 }, ALL)
      expect(clip.times.length).toBeGreaterThan(1)
      expect(clip.times[clip.times.length - 1]).toBeCloseTo(d.durationSec)
      expect(clip.rotations.length).toBeGreaterThan(0)
      for (const r of clip.rotations) expect(r.quats.length).toBe(clip.times.length * 4)
    }
  })

  it('足の骨は出さない(IK が受け持つ)', () => {
    const clip = buildMmdBuiltinClip(def('dance1'), { left: 0, right: 0 }, ALL)
    expect(clip.rotations.some((r) => /足|ひざ/.test(r.bone))).toBe(false)
  })

  it('モデルに無い骨のトラックは出さない', () => {
    const clip = buildMmdBuiltinClip(def('wave'), { left: 0, right: 0 }, new Set(['頭', '首']))
    expect(clip.rotations.every((r) => r.bone === '頭' || r.bone === '首')).toBe(true)
  })

  it('A ポーズの腕は、下ろす回転から基準の傾きを引く', () => {
    const t0 = def('idle').pose(0, def('idle').durationSec)
    const [lx, ly, lz] = t0.rot.leftUpperArm
    const [rx, ry, rz] = t0.rot.rightUpperArm
    const clip = buildMmdBuiltinClip(def('idle'), { left: 0.7, right: 0.6 }, ALL)
    const left = clip.rotations.find((r) => r.bone === '左腕')!
    const right = clip.rotations.find((r) => r.bone === '右腕')!
    expect(left.quats.slice(0, 4)).toEqual(eulerToQuat([lx, ly, lz + 0.7]))
    expect(right.quats.slice(0, 4)).toEqual(eulerToQuat([rx, ry, rz - 0.6]))
  })

  it('hipsY を使うモーションだけ、センターの上下を出す(基準からの差)', () => {
    const hop = buildMmdBuiltinClip(def('happyHop'), { left: 0, right: 0 }, ALL)
    expect(hop.centerLift).not.toBeNull()
    expect(hop.centerLift!.length).toBe(hop.times.length)
    expect(buildMmdBuiltinClip(def('nod'), { left: 0, right: 0 }, ALL).centerLift).toBeNull()
  })

  it('armRestFromBones: 水平は 0、斜め下は角度、上向きは 0', () => {
    expect(armRestFromBones({ x: 0, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(0)
    expect(armRestFromBones({ x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(Math.PI / 4)
    expect(armRestFromBones({ x: 0, y: 1 }, { x: 1, y: 2 })).toBe(0)
  })
})
