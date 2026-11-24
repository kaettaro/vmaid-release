// VMD(体と表情が別ファイルでもよい)→ VRMA(glTF Binary)。取り込み時に 1 回だけ変換して使う(再生側は VRMA のまま)。純粋関数。
// 流れ: 複数の VMD をまとめる → 30fps にサンプリングして、標準 MMD 骨格で FK + 足 IK を解く(vmdSolve)
//   → 世界回転から、VRM のボーンの局所回転へ(A ポーズ → T ポーズの基準補正は、BVH の変換と同じ n_j = C_親 · q_j · C_j⁻¹)
//   → 表情(モーフ → VRM の表情)を重みのトラックに → VRMA に書き出す。

import { MORPH_TO_VRM } from '../mmd/morphToVrm'
import { buildVrmaFromTracks, type TrackBone } from './builder'
import { CANONICAL, MIN_CORRECT_DEG } from './bvhRetarget'
import { MMD_TO_VRM, VRM_PARENT } from './mmdSkeleton'
import { Q_IDENTITY, qDot, qFromTo, qInv, qMul, qNormalize, qRotate, vDot, vNormalize, vSub, type Quat, type Vec3 } from './quat'
import type { Vmd, VmdBoneKey, VmdMorphKey } from './vmdParse'
import { solveVmd, VMD_FPS } from './vmdSolve'

/** 変換の仕様を変えたら上げる(変換済みキャッシュの名前に入れて、古い結果を使い回さない) */
/** 変換の版。上げると、変換のキャッシュが作り直される(2: 60fps で解く) */
export const VMD_CONVERTER_VERSION = 2

/** 1 フレームを何分割して解くか。2 = 60fps(補間曲線と足 IK を、細かく残す) */
export const VMD_SUBDIV = 2
/** MMD の長さの単位 → メートル(MMD の 1 ≒ 8cm と言われる。VRM の腰の高さとの比は、再生側がそろえるので、おおよそでよい) */
export const MMD_UNIT_M = 0.08

export interface VmdConvertReport {
  frames: number
  durationSec: number
  /** 変換した VRM のボーン */
  mapped: string[]
  /** 標準骨格に無く、使わなかった VMD のボーン(髪・小物の骨など) */
  unknownBones: string[]
  /** 対応する VRM の表情が無く、使わなかったモーフ */
  unmappedMorphs: string[]
  /** 使った表情(VRM の表情名) */
  expressions: string[]
  /** IK が目標に届かなかったのべフレーム数 */
  ikMisses: number
  warnings: string[]
}

export type VmdConvertResult = { ok: true; vrma: Uint8Array; report: VmdConvertReport } | { ok: false; reason: string }

const DEG = Math.PI / 180

/** 複数の VMD を 1 つにまとめる(同じボーン・モーフのキーは、重ねて時間順に並べる。IK の ON/OFF は、最初に持っていたもの) */
export function mergeVmds(list: readonly Vmd[]): Vmd {
  const bones = new Map<string, VmdBoneKey[]>()
  const morphs = new Map<string, VmdMorphKey[]>()
  let lastFrame = 0
  let ikStates: Vmd['ikStates'] = []
  for (const v of list) {
    for (const [name, keys] of v.bones) bones.set(name, [...(bones.get(name) ?? []), ...keys].sort((a, b) => a.frame - b.frame))
    for (const [name, keys] of v.morphs) morphs.set(name, [...(morphs.get(name) ?? []), ...keys].sort((a, b) => a.frame - b.frame))
    lastFrame = Math.max(lastFrame, v.lastFrame)
    if (ikStates.length === 0) ikStates = v.ikStates
  }
  return { modelName: list[0]?.modelName ?? '', bones, morphs, ikStates, lastFrame }
}

/** モーフのキーを、各フレームの重みへ(キーの間は直線で補間。最初のキーより前は最初の値、最後のキーより後は最後の値) */
function sampleMorph(keys: VmdMorphKey[], frames: number, subdiv = 1): Float32Array {
  const out = new Float32Array(frames)
  let k = 0
  for (let s = 0; s < frames; s++) {
    const f = s / subdiv // VMD のフレーム(小数)
    while (k + 1 < keys.length && keys[k + 1].frame <= f) k++
    const a = keys[k]
    const b = keys[k + 1]
    if (!b || f <= a.frame) out[s] = a.weight
    else out[s] = a.weight + ((b.weight - a.weight) * (f - a.frame)) / (b.frame - a.frame)
  }
  return out
}

export interface VmdConvertOptions {
  /** 腕の基準の角度(度。MMD のモデルの A ポーズで、腕が水平から下がっている角度)。省略(null)なら、標準の MMD モデルの実測値 */
  armAngleDeg?: number | null
}

const ARM_BONES = new Set(['leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm'])

export function convertVmdToVrma(vmds: readonly Vmd[], name: string, opts: VmdConvertOptions = {}): VmdConvertResult {
  if (vmds.length === 0) return { ok: false, reason: 'VMD がありません' }
  const merged = mergeVmds(vmds)
  const hasBones = merged.bones.size > 0
  const hasMorphs = [...merged.morphs.values()].some((l) => l.length > 0)
  if (!hasBones && !hasMorphs) return { ok: false, reason: 'VMD に、ボーンもモーフも、動きのキーがありません' }
  const warnings: string[] = []
  const solved = solveVmd(merged, undefined, VMD_SUBDIV)
  const frames = solved.frames
  const times = Array.from({ length: frames }, (_, f) => f / (VMD_FPS * VMD_SUBDIV))

  // --- 基準方向の補正 C(A ポーズ → T ポーズ。VRM のボーンの順に、親から) ---
  const mmdOf = new Map<string, string>(MMD_TO_VRM.map(([v, m]) => [v, m]))
  const restOf = (vrm: string): Vec3 => solved.rest.get(mmdOf.get(vrm) as string) as Vec3
  const correction = new Map<string, Quat>()
  for (const [vrm] of MMD_TO_VRM) {
    const parent = VRM_PARENT[vrm]
    const inherited = parent ? (correction.get(parent) ?? Q_IDENTITY) : Q_IDENTITY
    const spec = CANONICAL[vrm]
    const next = spec?.next.find((n) => mmdOf.has(n))
    if (spec && next) {
      let d = vNormalize(vSub(restOf(next), restOf(vrm)))
      if (opts.armAngleDeg != null && ARM_BONES.has(vrm)) {
        // 腕の基準の角度を指定されたとき: 水平から下がる角度だけを置き換える(前後の向きは、そのまま)
        const a = opts.armAngleDeg * DEG
        d = vNormalize([Math.sign(spec.dir[0]) * Math.cos(a), -Math.sin(a), d[2]])
      }
      const angle = Math.acos(Math.max(-1, Math.min(1, vDot(d, spec.dir)))) / DEG
      correction.set(vrm, angle < MIN_CORRECT_DEG ? Q_IDENTITY : qFromTo(d, spec.dir))
    } else {
      correction.set(vrm, inherited)
    }
  }

  // --- 各 VRM ボーンの局所回転 ---
  const world = (vrm: string, f: number): Quat => {
    const w = (solved.bones.get(mmdOf.get(vrm) as string) as { worldRot: Float32Array }).worldRot
    return [w[f * 4], w[f * 4 + 1], w[f * 4 + 2], w[f * 4 + 3]]
  }
  const bones: TrackBone[] = []
  for (const [vrm] of MMD_TO_VRM) {
    const parent = VRM_PARENT[vrm] ?? null
    const cParent = parent ? (correction.get(parent) as Quat) : Q_IDENTITY
    const cInv = qInv(correction.get(vrm) as Quat)
    const rest = restOf(vrm)
    const translation: Vec3 = parent
      ? (qRotate(cParent, vSub(rest, restOf(parent))).map((x) => x * MMD_UNIT_M) as Vec3)
      : (rest.map((x) => x * MMD_UNIT_M) as Vec3)
    const rotations: number[] = []
    let prev: Quat | null = null
    for (let f = 0; f < frames; f++) {
      const wj = world(vrm, f)
      const q = parent ? qMul(qInv(world(parent, f)), wj) : wj
      let n = qNormalize(qMul(qMul(cParent, q), cInv))
      if (prev && qDot(prev, n) < 0) n = [-n[0], -n[1], -n[2], -n[3]] // 補間が遠回りにならないよう、符号をそろえる
      prev = n
      rotations.push(n[0], n[1], n[2], n[3])
    }
    bones.push({ name: vrm, parent, translation, rotations })
  }

  // --- hips の位置(最初のフレームの水平位置を原点にそろえる) ---
  const hp = solved.hipsPos
  const hipsTranslation: number[] = []
  for (let f = 0; f < frames; f++) hipsTranslation.push((hp[f * 3] - hp[0]) * MMD_UNIT_M, hp[f * 3 + 1] * MMD_UNIT_M, (hp[f * 3 + 2] - hp[2]) * MMD_UNIT_M)

  // --- 表情 ---
  const unmappedMorphs: string[] = []
  const exprWeights = new Map<string, Float32Array>()
  for (const [morph, keys] of merged.morphs) {
    const target = MORPH_TO_VRM[morph]
    if (!target) {
      if (keys.some((k) => k.weight > 0.001)) unmappedMorphs.push(morph)
      continue
    }
    const w = sampleMorph(keys, frames, VMD_SUBDIV)
    const cur = exprWeights.get(target)
    if (!cur) exprWeights.set(target, w)
    else for (let f = 0; f < frames; f++) cur[f] = Math.max(cur[f], w[f])
  }
  const expressions = [...exprWeights].map(([n, w]) => ({ name: n, weights: Array.from(w, (x) => Math.max(0, Math.min(1, x))) }))

  if (solved.report.ikMisses > 0) warnings.push(`足 IK が目標に届かなかったフレームが ${solved.report.ikMisses} 件ありました(足が少し滑って見えることがあります)`)
  if (solved.report.unknownBones.length > 0) warnings.push(`標準の MMD 骨格に無い ${solved.report.unknownBones.length} 個のボーン(髪・小物など)は、使いませんでした`)
  if (unmappedMorphs.length > 0) warnings.push(`対応する VRM の表情が無いモーフは、使いませんでした: ${unmappedMorphs.join('、')}`)
  if (!hasBones) warnings.push('ボーンの動きがありません(表情だけの VMD です)')

  const vrma = buildVrmaFromTracks({ name, generator: 'VMaid VMD import', times, bones, hipsTranslation, expressions })
  return {
    ok: true,
    vrma,
    report: {
      frames,
      durationSec: times[times.length - 1] ?? 0,
      mapped: MMD_TO_VRM.map(([v]) => v),
      unknownBones: solved.report.unknownBones,
      unmappedMorphs,
      expressions: expressions.map((e) => e.name),
      ikMisses: solved.report.ikMisses,
      warnings
    }
  }
}
