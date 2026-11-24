// VRMA(VRM の正規化ボーンの回転)を、MMD(PMX)のモデルの骨のトラックにする。Electron / Three.js 非依存の純粋ロジック。
//
// 座標系は mmdBuiltin.ts と同じ: @moeru/three-mmd は PMX の Z を反転して右手系にし、骨の基準姿勢の回転は単位回転。
// なので、VRM の正規化ボーンの局所回転は、符号を変えずに、そのまま骨の回転として使える。
// 違いは腕の基準姿勢だけ: VRM は T ポーズ(腕が水平)、PMX は A ポーズ(斜め下)が多い。
// T → A の回転を R_a とすると、腕の鎖(上腕 → ひじ → 手首 → 指)の世界回転に、同じ R_a⁻¹ を掛ければ、見た目の向きが合う:
//   上腕 q' = q · R_a⁻¹ / ひじ・手首・指 q' = R_a · q · R_a⁻¹(導出は、docs/adr/0005 の §17)

import { FINGER_MAP } from './mmdSkeleton'
import type { ArmRest } from './mmdBuiltin'
import { qAxisAngle, qDot, qInv, qMul, qNormalize, type Quat } from './quat'

const SIDES = ['left', 'right'] as const

/** VRM の人体ボーン名 → MMD の骨の名前。脚(IK を切って、FK で動かす)・指を含む。目は出さない */
export const VRMA_TO_MMD_BONES: Readonly<Record<string, string>> = {
  hips: 'センター',
  spine: '上半身',
  chest: '上半身2',
  upperChest: '上半身2',
  neck: '首',
  head: '頭',
  ...Object.fromEntries(
    SIDES.flatMap((side) => {
      const s = side === 'left' ? '左' : '右'
      return [
        [`${side}Shoulder`, `${s}肩`],
        [`${side}UpperArm`, `${s}腕`],
        [`${side}LowerArm`, `${s}ひじ`],
        [`${side}Hand`, `${s}手首`],
        ...FINGER_MAP.map(([m, v]) => [`${side}${v}`, `${s}${m}`] as const),
        [`${side}UpperLeg`, `${s}足`],
        [`${side}LowerLeg`, `${s}ひざ`],
        [`${side}Foot`, `${s}足首`],
        [`${side}Toes`, `${s}つま先`]
      ] as const
    })
  )
}

/** 腕の鎖の骨(T → A の補正が要る): 上腕と、その子孫(ひじ・手首・指) */
const ARM_PREFIXES = ['UpperArm', 'LowerArm', 'Hand', 'Thumb', 'Index', 'Middle', 'Ring', 'Little']

/** 骨(VRM 名)が、左右どちらの腕の鎖か。上腕は 'upper'、それより先は 'chain'。腕でなければ null */
export function armRole(vrmBone: string): { side: 'left' | 'right'; role: 'upper' | 'chain' } | null {
  for (const side of SIDES) {
    if (!vrmBone.startsWith(side)) continue
    const rest = vrmBone.slice(side.length)
    if (rest === 'UpperArm') return { side, role: 'upper' }
    if (ARM_PREFIXES.some((p) => rest.startsWith(p))) return { side, role: 'chain' }
  }
  return null
}

export interface QuatTrack {
  times: ArrayLike<number>
  /** x, y, z, w を並べた配列 */
  values: ArrayLike<number>
}

export interface Vec3Track {
  times: ArrayLike<number>
  /** x, y, z を並べた配列 */
  values: ArrayLike<number>
}

export interface VrmaInput {
  durationSec: number
  /** VRM のボーン名 → 正規化された局所回転のトラック */
  rotations: ReadonlyMap<string, QuatTrack>
  /** hips の位置のトラック(無ければ null) */
  hips: Vec3Track | null
  /** hips の基準の位置(メートル) */
  restHips: readonly [number, number, number]
}

export interface VrmaToMmdOptions {
  /** そのモデルにある MMD の骨の名前(無い骨のトラックは出さない) */
  modelBones: ReadonlySet<string>
  armRest: ArmRest
  /** そのモデルの、腰の高さ(モデルの単位)。hips の移動の換算に使う */
  hipsHeight: number
  /** 腰の水平方向(x・z)の移動の上限(モデルの単位)。省略なら、そのまま。大きく動く(歩く・前へ出る)モーションが、窓から出ないように、なめらかに頭打ちにする */
  horizontalLimit?: number
}

export interface MmdTrack {
  /** MMD の骨の名前 */
  bone: string
  times: number[]
  quats: number[]
}

export interface VrmaMmdClip {
  durationSec: number
  rotations: MmdTrack[]
  /** センターの移動(基準からの差。モデルの単位)。無ければ null */
  center: { times: number[]; values: number[] } | null
}

/** 小さい値は、ほぼそのまま。大きい値は、limit に近づくだけ(tanh) */
export const softLimit = (v: number, limit: number): number => limit * Math.tanh(v / limit)

const quatAt = (track: QuatTrack, i: number): Quat => [track.values[i * 4]!, track.values[i * 4 + 1]!, track.values[i * 4 + 2]!, track.values[i * 4 + 3]!]

function slerp(a: Quat, b: Quat, t: number): Quat {
  let cos = qDot(a, b)
  let bb = b
  if (cos < 0) {
    bb = [-b[0], -b[1], -b[2], -b[3]]
    cos = -cos
  }
  if (cos > 0.9995) return qNormalize([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t])
  const theta = Math.acos(cos)
  const s = Math.sin(theta)
  const wa = Math.sin((1 - t) * theta) / s
  const wb = Math.sin(t * theta) / s
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb]
}

/** トラックの、時刻 t の回転(キーの間は球面補間。範囲の外は端の値) */
export function sampleQuat(track: QuatTrack, t: number): Quat {
  const n = track.times.length
  if (n === 0) return [0, 0, 0, 1]
  if (t <= track.times[0]!) return quatAt(track, 0)
  if (t >= track.times[n - 1]!) return quatAt(track, n - 1)
  let hi = 1
  while (track.times[hi]! < t) hi++
  const t0 = track.times[hi - 1]!
  const t1 = track.times[hi]!
  return slerp(quatAt(track, hi - 1), quatAt(track, hi), t1 === t0 ? 0 : (t - t0) / (t1 - t0))
}

/** 腕の T → A の回転(左は Z まわりに −rest、右は +rest) */
export function armTransform(side: 'left' | 'right', rest: ArmRest): Quat {
  return side === 'left' ? qAxisAngle('z', -rest.left) : qAxisAngle('z', rest.right)
}

/** 補正した 1 つの回転 */
export function retargetArm(q: Quat, role: 'upper' | 'chain', ra: Quat): Quat {
  const raInv = qInv(ra)
  return qNormalize(role === 'upper' ? qMul(q, raInv) : qMul(qMul(ra, q), raInv))
}

/** 連続するキーの符号をそろえる(補間が遠回りにならないように) */
function fixSigns(quats: number[]): void {
  for (let i = 4; i < quats.length; i += 4) {
    if (quats[i - 4]! * quats[i]! + quats[i - 3]! * quats[i + 1]! + quats[i - 2]! * quats[i + 2]! + quats[i - 1]! * quats[i + 3]! < 0) {
      for (let k = 0; k < 4; k++) quats[i + k] = -quats[i + k]!
    }
  }
}

/**
 * VRMA を、そのモデルの骨のトラックにする。
 * - MMD の骨が無いものは、出さない。上半身2 が無いモデルでは、chest / upperChest の回転を、上半身へ合成する。
 * - 腕は、モデルの A ポーズに合わせて補正する。hips の移動は、モデルの腰の高さへ換算して、センターの移動にする。
 */
export function vrmaToMmd(input: VrmaInput, opts: VrmaToMmdOptions): VrmaMmdClip {
  const has = (mmd: string): boolean => opts.modelBones.has(mmd)
  // 出力する MMD の骨 → その骨へ合成する VRM の骨(親側から順に。回転は、掛け合わせる)
  const groups = new Map<string, string[]>()
  for (const vrm of input.rotations.keys()) {
    let mmd = VRMA_TO_MMD_BONES[vrm]
    if (!mmd) continue
    if (!has(mmd)) {
      // 上半身2 が無いモデル: chest・upperChest の回転は、上半身へ
      if (mmd === '上半身2' && has('上半身')) mmd = '上半身'
      else continue
    }
    const list = groups.get(mmd) ?? []
    list.push(vrm)
    groups.set(mmd, list)
  }
  const ORDER = ['spine', 'chest', 'upperChest']
  const rotations: MmdTrack[] = []
  for (const [bone, vrms] of groups) {
    vrms.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
    const times = new Set<number>()
    for (const v of vrms) for (const t of Array.from(input.rotations.get(v)!.times)) times.add(t)
    const sorted = [...times].sort((a, b) => a - b)
    const quats: number[] = []
    for (const t of sorted) {
      let q: Quat = [0, 0, 0, 1]
      for (const v of vrms) q = qMul(q, sampleQuat(input.rotations.get(v)!, t))
      const arm = vrms.length === 1 ? armRole(vrms[0]!) : null
      if (arm) q = retargetArm(q, arm.role, armTransform(arm.side, opts.armRest))
      quats.push(...qNormalize(q))
    }
    fixSigns(quats)
    rotations.push({ bone, times: sorted, quats })
  }

  let center: VrmaMmdClip['center'] = null
  if (input.hips && has('センター') && input.hips.times.length > 0 && input.restHips[1] > 1e-6) {
    const k = opts.hipsHeight / input.restHips[1]
    const times = Array.from(input.hips.times)
    const values: number[] = []
    for (let i = 0; i < times.length; i++) {
      values.push(
        (input.hips.values[i * 3]! - input.restHips[0]) * k,
        (input.hips.values[i * 3 + 1]! - input.restHips[1]) * k,
        (input.hips.values[i * 3 + 2]! - input.restHips[2]) * k
      )
    }
    if (opts.horizontalLimit && opts.horizontalLimit > 0) {
      for (let i = 0; i < values.length; i += 3) {
        values[i] = softLimit(values[i]!, opts.horizontalLimit)
        values[i + 2] = softLimit(values[i + 2]!, opts.horizontalLimit)
      }
    }
    center = { times, values }
  }
  return { durationSec: input.durationSec, rotations, center }
}
