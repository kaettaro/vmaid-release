// BVH 関連テスト用の部品(合成 BVH の生成と、骨格の FK)。本体からは使わない
import { Q_IDENTITY, qAxisAngle, qMul, qRotate, vAdd, type Quat, type Vec3 } from './quat'
import type { Bvh } from './bvh'
import type { RetargetedTracks } from './bvhRetarget'

export interface SynthJoint {
  name: string
  parent: string | null
  offset: Vec3
  /** 省略時は回転3軸(Z X Y)。ルートは位置3軸 + 回転3軸 */
  channels?: string[]
}

const ROT = ['Zrotation', 'Xrotation', 'Yrotation']

/** 人型の合成スケルトン。arms='T' は腕を真横、'A' は斜め下へ向ける。unit は長さの単位(1=メートル) */
export function humanoidJoints(arms: 'T' | 'A', unit = 1): SynthJoint[] {
  const u = (v: Vec3): Vec3 => [v[0] * unit, v[1] * unit, v[2] * unit]
  const armDir = (sign: number, len: number): Vec3 => (arms === 'T' ? [sign * len, 0, 0] : [sign * len * 0.8, -len * 0.6, 0])
  const j = (name: string, parent: string | null, offset: Vec3, channels?: string[]): SynthJoint => ({ name, parent, offset: u(offset), channels })
  const out: SynthJoint[] = [
    j('hips', null, [0, 1, 0], ['Xposition', 'Yposition', 'Zposition', ...ROT]),
    j('spine', 'hips', [0, 0.1, 0]),
    j('chest', 'spine', [0, 0.2, 0]),
    j('neck', 'chest', [0, 0.2, 0]),
    j('head', 'neck', [0, 0.1, 0])
  ]
  for (const [side, s] of [['left', 1], ['right', -1]] as const) {
    out.push(
      j(`${side}UpperLeg`, 'hips', [s * 0.1, -0.05, 0]),
      j(`${side}LowerLeg`, `${side}UpperLeg`, [0, -0.4, 0]),
      j(`${side}Foot`, `${side}LowerLeg`, [0, -0.4, 0]),
      j(`${side}Shoulder`, 'chest', [s * 0.05, 0.15, 0]),
      j(`${side}UpperArm`, `${side}Shoulder`, armDir(s, 0.1)),
      j(`${side}LowerArm`, `${side}UpperArm`, armDir(s, 0.25)),
      j(`${side}Hand`, `${side}LowerArm`, armDir(s, 0.25))
    )
  }
  return out
}

/** 関節の並びと値から、BVH のテキストを作る(各関節の下に End Site を付ける) */
export function toBvhText(joints: SynthJoint[], frames: number[][], frameTime: number, eol = '\n'): string {
  const lines: string[] = ['HIERARCHY']
  const children = (name: string | null): SynthJoint[] => joints.filter((j) => j.parent === name)
  const write = (j: SynthJoint, depth: number): void => {
    const pad = '  '.repeat(depth)
    const ch = j.channels ?? ROT
    lines.push(`${pad}${j.parent === null ? 'ROOT' : 'JOINT'} ${j.name}`, `${pad}{`)
    lines.push(`${pad}  OFFSET ${j.offset.join(' ')}`, `${pad}  CHANNELS ${ch.length} ${ch.join(' ')}`)
    for (const c of children(j.name)) write(c, depth + 1)
    if (children(j.name).length === 0) lines.push(`${pad}  End Site`, `${pad}  {`, `${pad}    OFFSET 0 0.05 0`, `${pad}  }`)
    lines.push(`${pad}}`)
  }
  for (const r of children(null)) write(r, 0)
  lines.push('MOTION', `Frames: ${frames.length}`, `Frame Time: ${frameTime}`)
  for (const f of frames) lines.push(f.join(' '))
  return lines.join(eol) + eol
}

/** チャンネルの総数 */
export const channelCount = (joints: SynthJoint[]): number => joints.reduce((n, j) => n + (j.channels ?? ROT).length, 0)

/** 決まった疑似乱数(再現できるテスト用)*/
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** ランダムなポーズのフレームを作る。回転は ±range 度、ルートの位置は基準位置のまわり */
export function randomFrames(joints: SynthJoint[], n: number, seed: number, range = 40): number[][] {
  const r = rng(seed)
  return Array.from({ length: n }, () =>
    joints.flatMap((j) =>
      (j.channels ?? ROT).map((c) => (c.endsWith('position') ? j.offset['XYZ'.indexOf(c[0])] + (r() - 0.5) * 0.1 : (r() - 0.5) * 2 * range))
    )
  )
}

const DEG = Math.PI / 180

/** BVH の FK: 各関節のワールド位置 */
export function bvhForwardKinematics(bvh: Bvh, frame: number): Vec3[] {
  const pos: Vec3[] = []
  const rot: Quat[] = []
  bvh.joints.forEach((j, i) => {
    const row = frame * bvh.stride + j.channelStart
    let q: Quat = Q_IDENTITY
    const p: Vec3 = [...j.offset]
    j.channels.forEach((c, k) => {
      const v = bvh.data[row + k]
      if (c === 'Xrotation') q = qMul(q, qAxisAngle('x', v * DEG))
      else if (c === 'Yrotation') q = qMul(q, qAxisAngle('y', v * DEG))
      else if (c === 'Zrotation') q = qMul(q, qAxisAngle('z', v * DEG))
      else if (c === 'Xposition') p[0] = v
      else if (c === 'Yposition') p[1] = v
      else if (c === 'Zposition') p[2] = v
    })
    if (j.parent < 0) {
      pos[i] = p
      rot[i] = q
    } else {
      pos[i] = vAdd(pos[j.parent], qRotate(rot[j.parent], p))
      rot[i] = qMul(rot[j.parent], q)
    }
  })
  return pos
}

/** 変換後のトラックの FK: ボーン名 → ワールド位置 */
export function tracksForwardKinematics(t: RetargetedTracks, frame: number): Record<string, Vec3> {
  const pos: Record<string, Vec3> = {}
  const rot: Record<string, Quat> = {}
  for (const b of t.bones) {
    const q: Quat = b.rotations ? [b.rotations[frame * 4], b.rotations[frame * 4 + 1], b.rotations[frame * 4 + 2], b.rotations[frame * 4 + 3]] : Q_IDENTITY
    if (b.parent === null) {
      pos[b.name] = [t.hipsTranslation[frame * 3], t.hipsTranslation[frame * 3 + 1], t.hipsTranslation[frame * 3 + 2]]
      rot[b.name] = q
    } else {
      pos[b.name] = vAdd(pos[b.parent], qRotate(rot[b.parent], b.translation))
      rot[b.name] = qMul(rot[b.parent], q)
    }
  }
  return pos
}
