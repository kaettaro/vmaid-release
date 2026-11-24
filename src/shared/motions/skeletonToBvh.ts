// FBX など、「骨格 + 時間ごとの各骨のワールド姿勢」を、BVH の形(Bvh)に直す。純粋関数(Three.js に依存しない)。
// これで、FBX のモーションも、BVH と同じ経路(retargetBvh → VRMA)で、VRM 向けに取り込める。
//
// BVH は、基準姿勢の回転が単位で、関節の位置は「親からの OFFSET」(ワールド軸)で表す。
// FBX の骨は、基準姿勢で回転を持つことがあるので、次のように直す:
//  - OFFSET = 基準姿勢のワールド位置の、親との差
//  - 回転 = 「基準姿勢からの、ワールド軸での回転の変化」Wd = W(t)·W(rest)⁻¹ を、親の Wd⁻¹ で割ったもの(ローカル)
//  - ルートの位置 = その時刻のワールド位置
import type { Bvh, BvhChannel, BvhJoint } from './bvh'
import { qInv, qMul, qNormalize, type Quat, type Vec3 } from './quat'

export interface SampledJoint {
  name: string
  /** 親の番号(ルートは -1。親が先に並ぶこと) */
  parent: number
  /** 基準姿勢のワールド位置・向き */
  restPos: Vec3
  restRot: Quat
}

export interface SampledFrame {
  /** 各関節のワールド位置・向き(joints と同じ並び) */
  pos: Vec3[]
  rot: Quat[]
}

export interface SampledSkeleton {
  joints: SampledJoint[]
  /** フレームの間隔(秒) */
  frameTime: number
  frames: SampledFrame[]
}

const DEG = 180 / Math.PI

/** q = Rz(γ)·Ry(β)·Rx(α) と分解する(度)。BVH のチャンネルを [Zrotation, Yrotation, Xrotation] の順に並べて、同じ回転に戻る */
export function quatToZyx(q: Quat): Vec3 {
  const [x, y, z, w] = qNormalize(q)
  const m00 = 1 - 2 * (y * y + z * z)
  const m10 = 2 * (x * y + w * z)
  const m20 = 2 * (x * z - w * y)
  const m21 = 2 * (y * z + w * x)
  const m22 = 1 - 2 * (x * x + y * y)
  const m11 = 1 - 2 * (x * x + z * z)
  const m12 = 2 * (y * z - w * x)
  const beta = Math.asin(Math.max(-1, Math.min(1, -m20)))
  if (Math.abs(m20) < 0.999999) return [Math.atan2(m21, m22) * DEG, beta * DEG, Math.atan2(m10, m00) * DEG]
  // ジンバルロック(真上・真下を向く): γ を 0 にして、α にまとめる
  return [Math.atan2(-m12, m11) * DEG, beta * DEG, 0]
}

export const MAX_SAMPLED_JOINTS = 400
export const MAX_SAMPLED_FRAMES = 20000

export type SkeletonToBvhResult = { ok: true; bvh: Bvh } | { ok: false; reason: string }

export function skeletonToBvh(s: SampledSkeleton): SkeletonToBvhResult {
  const n = s.joints.length
  if (n === 0) return { ok: false, reason: '骨が見つかりません' }
  if (n > MAX_SAMPLED_JOINTS) return { ok: false, reason: `骨が多すぎます(上限 ${MAX_SAMPLED_JOINTS})` }
  if (s.frames.length === 0) return { ok: false, reason: 'アニメーションが見つかりません' }
  if (s.frames.length > MAX_SAMPLED_FRAMES) return { ok: false, reason: `フレームが多すぎます(上限 ${MAX_SAMPLED_FRAMES})` }
  for (let i = 0; i < n; i++) if (s.joints[i].parent >= i) return { ok: false, reason: '骨の並びが不正です(親が先に並んでいません)' }

  const joints: BvhJoint[] = []
  let stride = 0
  s.joints.forEach((j) => {
    const root = j.parent < 0
    const channels: BvhChannel[] = root
      ? ['Xposition', 'Yposition', 'Zposition', 'Zrotation', 'Yrotation', 'Xrotation']
      : ['Zrotation', 'Yrotation', 'Xrotation']
    const rp = root ? ([0, 0, 0] as Vec3) : s.joints[j.parent].restPos
    joints.push({
      name: j.name,
      parent: j.parent,
      offset: [j.restPos[0] - rp[0], j.restPos[1] - rp[1], j.restPos[2] - rp[2]],
      channels,
      channelStart: stride
    })
    stride += channels.length
  })

  const data = new Float32Array(s.frames.length * stride)
  const restInv = s.joints.map((j) => qInv(qNormalize(j.restRot)))
  s.frames.forEach((f, fi) => {
    const row = fi * stride
    // 基準姿勢からの、ワールド軸での回転の変化
    const delta: Quat[] = s.joints.map((_, i) => qMul(qNormalize(f.rot[i]), restInv[i]))
    s.joints.forEach((j, i) => {
      const local = j.parent < 0 ? delta[i] : qMul(qInv(delta[j.parent]), delta[i])
      const e = quatToZyx(local)
      const c = joints[i].channelStart
      if (j.parent < 0) {
        data[row + c] = f.pos[i][0]
        data[row + c + 1] = f.pos[i][1]
        data[row + c + 2] = f.pos[i][2]
        data[row + c + 3] = e[2]
        data[row + c + 4] = e[1]
        data[row + c + 5] = e[0]
      } else {
        data[row + c] = e[2]
        data[row + c + 1] = e[1]
        data[row + c + 2] = e[0]
      }
    })
  })
  return { ok: true, bvh: { joints, frames: s.frames.length, frameTime: s.frameTime, stride, data } }
}
