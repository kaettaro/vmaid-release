import { describe, expect, it } from 'vitest'
import { qAxisAngle, qInv, qMul, qRotate, type Quat } from './quat'
import { armRole, armTransform, retargetArm, sampleQuat, softLimit, vrmaToMmd, VRMA_TO_MMD_BONES, type QuatTrack, type VrmaInput } from './vrmaToMmd'

const ID: Quat = [0, 0, 0, 1]
const track = (times: number[], qs: Quat[]): QuatTrack => ({ times, values: qs.flat() })
const near = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-6): void => {
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i]!, -Math.log10(eps))
}
const bones = (...names: string[]): ReadonlySet<string> => new Set(names)
const input = (rot: Record<string, QuatTrack>, extra: Partial<VrmaInput> = {}): VrmaInput => ({ durationSec: 1, rotations: new Map(Object.entries(rot)), hips: null, restHips: [0, 1, 0], ...extra })
const rest0 = { left: 0, right: 0 }

describe('対応表', () => {
  it('体・脚・指が、MMD の骨の名前に対応する。目は出さない', () => {
    expect(VRMA_TO_MMD_BONES.hips).toBe('センター')
    expect(VRMA_TO_MMD_BONES.leftLowerLeg).toBe('左ひざ')
    expect(VRMA_TO_MMD_BONES.rightIndexIntermediate).toBe('右人指２')
    expect(VRMA_TO_MMD_BONES.leftThumbMetacarpal).toBe('左親指０')
    expect(VRMA_TO_MMD_BONES.leftEye).toBeUndefined()
  })

  it('腕の鎖の判定: 上腕は upper、ひじ・手首・指は chain、肩・脚・体は対象外', () => {
    expect(armRole('leftUpperArm')).toEqual({ side: 'left', role: 'upper' })
    expect(armRole('rightHand')).toEqual({ side: 'right', role: 'chain' })
    expect(armRole('leftLittleDistal')).toEqual({ side: 'left', role: 'chain' })
    expect(armRole('leftShoulder')).toBeNull()
    expect(armRole('leftUpperLeg')).toBeNull()
    expect(armRole('spine')).toBeNull()
  })
})

describe('腕の A ポーズ補正', () => {
  it('rest = 0(T ポーズのモデル)なら、恒等', () => {
    const q = qAxisAngle('x', 0.7)
    near(retargetArm(q, 'upper', armTransform('left', rest0)), q)
    near(retargetArm(q, 'chain', armTransform('right', rest0)), q)
  })

  it('VRM の腕を下ろす回転(左 z = −a)は、上腕では、a − rest だけ下ろす回転になる(builtin の z 補正と一致)', () => {
    const a = 1.2
    const rest = { left: 0.7, right: 0.7 }
    const left = retargetArm(qAxisAngle('z', -a), 'upper', armTransform('left', rest))
    near(left, qAxisAngle('z', -(a - rest.left)))
    const right = retargetArm(qAxisAngle('z', a), 'upper', armTransform('right', rest))
    near(right, qAxisAngle('z', a - rest.right))
  })

  it('世界の向きが合う: 左腕を VRM で 90° 下ろした(真下を向く)とき、A ポーズの腕は、真下を向く', () => {
    const rest = { left: 0.7, right: 0.7 }
    // A ポーズの腕の基準の向き(左: 水平から rest だけ下がる)
    const dirA: [number, number, number] = [Math.cos(0.7), -Math.sin(0.7), 0]
    const qm = retargetArm(qAxisAngle('z', -Math.PI / 2), 'upper', armTransform('left', rest)) // 肩の世界回転 = 単位
    const d = qRotate(qm, dirA)
    near(d, [0, -1, 0], 1e-5)
  })

  it('ひじ・手首は、共役: 上腕が回って腕の鎖全体の向きが、T ポーズの見た目に合う', () => {
    const rest = { left: 0.5, right: 0.5 }
    const ra = armTransform('left', rest)
    const qUpperV = qAxisAngle('y', 0.4)
    const qLowerV = qAxisAngle('z', -0.3)
    const upperM = retargetArm(qUpperV, 'upper', ra)
    const lowerM = retargetArm(qLowerV, 'chain', ra)
    // VRM の世界回転 W_v(lower) = qUpperV · qLowerV。PMX 側は、W_m(lower) = W_v(lower) · R_a⁻¹ になる
    near(qMul(upperM, lowerM), qMul(qMul(qUpperV, qLowerV), qInv(ra)), 1e-6)
  })
})

describe('VRMA → PMX のトラック', () => {
  it('回転は、そのまま(符号を変えない)。MMD の骨が無いものは出さない', () => {
    const q = qAxisAngle('x', 0.5)
    const clip = vrmaToMmd(input({ head: track([0, 1], [ID, q]), leftEye: track([0], [q]), neck: track([0], [q]) }), { modelBones: bones('頭'), armRest: rest0, hipsHeight: 1 })
    expect(clip.rotations.map((r) => r.bone)).toEqual(['頭'])
    near(clip.rotations[0]!.quats, [0, 0, 0, 1, ...q])
    expect(clip.rotations[0]!.times).toEqual([0, 1])
  })

  it('上半身2 が無いモデルでは、chest の回転を、上半身へ合成する(spine × chest。時刻は、両方の和)', () => {
    const a = qAxisAngle('x', 0.2)
    const b = qAxisAngle('x', 0.3)
    const clip = vrmaToMmd(input({ spine: track([0, 1], [a, a]), chest: track([0.5], [b]) }), { modelBones: bones('上半身'), armRest: rest0, hipsHeight: 1 })
    expect(clip.rotations).toHaveLength(1)
    expect(clip.rotations[0]!.times).toEqual([0, 0.5, 1])
    near(clip.rotations[0]!.quats.slice(4, 8), qMul(a, b))
    near(clip.rotations[0]!.quats.slice(0, 4), qMul(a, b)) // chest は端の値(0.5 の 1 キーだけ)
    // 上半身2 があるモデルでは、別々
    const two = vrmaToMmd(input({ spine: track([0], [a]), chest: track([0], [b]) }), { modelBones: bones('上半身', '上半身2'), armRest: rest0, hipsHeight: 1 })
    expect(two.rotations.map((r) => r.bone).sort()).toEqual(['上半身', '上半身2'])
  })

  it('腕には、A ポーズの補正がかかる。腕以外には、かからない', () => {
    const rest = { left: 0.6, right: 0.6 }
    const q = qAxisAngle('z', -1.2)
    const clip = vrmaToMmd(input({ leftUpperArm: track([0], [q]), leftShoulder: track([0], [q]) }), { modelBones: bones('左腕', '左肩'), armRest: rest, hipsHeight: 1 })
    const by = Object.fromEntries(clip.rotations.map((r) => [r.bone, r.quats]))
    near(by['左腕']!, qAxisAngle('z', -0.6))
    near(by['左肩']!, q)
  })

  it('符号をそろえる(補間が遠回りにならない)', () => {
    const q = qAxisAngle('x', 0.3)
    const neg: Quat = [-q[0], -q[1], -q[2], -q[3]]
    const clip = vrmaToMmd(input({ head: track([0, 1], [q, neg]) }), { modelBones: bones('頭'), armRest: rest0, hipsHeight: 1 })
    const k = clip.rotations[0]!.quats
    expect(k[0]! * k[4]! + k[1]! * k[5]! + k[2]! * k[6]! + k[3]! * k[7]!).toBeGreaterThan(0)
  })

  it('hips の移動: 基準との差を、モデルの腰の高さ ÷ VRMA の基準の高さ 倍して、センターの移動にする', () => {
    const clip = vrmaToMmd(input({}, { hips: { times: [0, 1], values: [0, 1, 0, 0.1, 0.9, 0.2] }, restHips: [0, 1, 0] }), { modelBones: bones('センター'), armRest: rest0, hipsHeight: 10 })
    near(clip.center!.values, [0, 0, 0, 1, -1, 2])
    const half = vrmaToMmd(input({}, { hips: { times: [0], values: [0, 0.5, 0] }, restHips: [0, 0.5, 0] }), { modelBones: bones('センター'), armRest: rest0, hipsHeight: 10 })
    near(half.center!.values, [0, 0, 0])
    // センターが無いモデル・移動トラックが無いときは、null
    expect(vrmaToMmd(input({}, { hips: { times: [0], values: [0, 1, 0] } }), { modelBones: bones('頭'), armRest: rest0, hipsHeight: 1 }).center).toBeNull()
    expect(vrmaToMmd(input({}), { modelBones: bones('センター'), armRest: rest0, hipsHeight: 1 }).center).toBeNull()
  })

  it('腰の水平方向の移動は、上限へなめらかに頭打ちになる(y は、そのまま)。小さい動きは、ほぼ変わらない', () => {
    const clip = vrmaToMmd(input({}, { hips: { times: [0, 1, 2], values: [0, 1, 0.1, 5, 0.5, -5, 0, 1, 0] }, restHips: [0, 1, 0] }), { modelBones: bones('センター'), armRest: rest0, hipsHeight: 1, horizontalLimit: 0.3 })
    const v = clip.center!.values
    expect(v[2]).toBeCloseTo(softLimit(0.1, 0.3))
    expect(softLimit(0.1, 0.3)).toBeGreaterThan(0.09)
    expect(Math.abs(v[3]!)).toBeLessThan(0.3)
    expect(v[4]).toBeCloseTo(-0.5) // y はそのまま
    expect(Math.abs(v[5]!)).toBeLessThan(0.3)
    expect(v[5]).toBeLessThan(0)
    expect(softLimit(0, 0.3)).toBe(0)
  })

  it('補間: キーの間は球面補間、範囲の外は端の値', () => {
    const t = track([0, 1], [ID, qAxisAngle('x', 1)])
    near(sampleQuat(t, 0.5), qAxisAngle('x', 0.5))
    near(sampleQuat(t, -1), ID)
    near(sampleQuat(t, 9), qAxisAngle('x', 1))
  })
})
