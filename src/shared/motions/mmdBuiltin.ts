// 内蔵モーション(VRM の T ポーズ基準の手続き生成)を、MMD(PMX)のモデル用の骨トラックにする。Electron/Three.js 非依存。
//
// 座標系: MMD 対応 Mod が使う @moeru/three-mmd は、PMX の Z を反転して右手系にする。結果、モデルは +Z を向き、
// キャラの左が +X になり、VRM 1.0 と同じ向きになる。PMX の骨は、基準姿勢の回転が単位回転で、親からの位置だけを持つ。
// そのため、VRM の回転(親の軸系での値)は、符号を変えずに、そのまま骨の回転として使える。
// 違いは腕の基準姿勢: VRM は T ポーズ(腕が水平)だが、PMX は A ポーズ(斜め下)が多い。
// 腕の「下ろす」回転から、そのモデルの腕の傾き(rest)を引いて補正する。

import { eulerToQuat, type MotionDef } from './builder'

/** VRM の人体ボーン名 → MMD のボーン名。足(IK が受け持つ)と、指・目は出さない */
export const MMD_BUILTIN_BONES: Record<string, string> = {
  hips: 'センター',
  spine: '上半身',
  chest: '上半身2',
  neck: '首',
  head: '頭',
  leftShoulder: '左肩',
  rightShoulder: '右肩',
  leftUpperArm: '左腕',
  rightUpperArm: '右腕',
  leftLowerArm: '左ひじ',
  rightLowerArm: '右ひじ',
  leftHand: '左手首',
  rightHand: '右手首'
}

/** 腕の基準姿勢(水平からの下がり角。ラジアン。T ポーズは 0、A ポーズは 0.6〜0.8 くらい) */
export interface ArmRest {
  left: number
  right: number
}

export interface MmdBoneTrack {
  /** MMD のボーン名 */
  bone: string
  /** 回転(x,y,z,w)を、時刻順に並べた配列 */
  quats: number[]
}

export interface MmdBuiltinClip {
  name: string
  durationSec: number
  times: number[]
  rotations: MmdBoneTrack[]
  /** センターの上下(メートル。基準からの差)。hipsY を使わないモーションは null */
  centerLift: number[] | null
}

/** hips の基準の高さ(builder.ts の BONES と同じ) */
const HIPS_REST_Y = 1.0

/** 腕の基準姿勢を、骨の位置から求める(上腕→ひじの向きが、水平からどれだけ下がっているか) */
export function armRestFromBones(upper: { x: number; y: number }, lower: { x: number; y: number }): number {
  const dx = Math.abs(lower.x - upper.x)
  const dy = upper.y - lower.y
  if (dx < 1e-6 && Math.abs(dy) < 1e-6) return 0
  const a = Math.atan2(dy, dx)
  return Math.max(0, Math.min(1.5, a)) // 水平〜ほぼ真下。上向きの腕は 0 とみなす
}

/** 内蔵モーション1つを、MMD の骨トラックにする。modelBones は、そのモデルにある MMD のボーン名(無い骨のトラックは出さない) */
export function buildMmdBuiltinClip(def: MotionDef, rest: ArmRest, modelBones: ReadonlySet<string>): MmdBuiltinClip {
  const times: number[] = []
  for (let t = 0; t <= def.durationSec + 1e-9; t += def.stepSec) times.push(Math.min(t, def.durationSec))
  const frames = times.map((t) => def.pose(t, def.durationSec))
  const used = new Set(frames.flatMap((f) => Object.keys(f.rot)))

  const rotations: MmdBoneTrack[] = []
  for (const vrmBone of used) {
    const bone = MMD_BUILTIN_BONES[vrmBone]
    if (!bone || !modelBones.has(bone)) continue
    const quats: number[] = []
    for (const f of frames) {
      const [x, y, z] = f.rot[vrmBone] ?? [0, 0, 0]
      // 上腕は、腕を下ろす z 回転から、モデルの基準の傾きを引く(左は z が負、右は正で下がる)
      const zFixed = vrmBone === 'leftUpperArm' ? z + rest.left : vrmBone === 'rightUpperArm' ? z - rest.right : z
      quats.push(...eulerToQuat([x, y, zFixed]))
    }
    rotations.push({ bone, quats })
  }
  const lift = frames.some((f) => f.hipsY !== undefined) ? frames.map((f) => (f.hipsY ?? HIPS_REST_Y) - HIPS_REST_Y) : null
  return { name: def.name, durationSec: def.durationSec, times, rotations, centerLift: lift }
}
