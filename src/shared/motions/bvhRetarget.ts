// BVH を VRM のヒューマノイド(正規化ボーン。基準姿勢=Tポーズ・全ボーンが単位回転)の回転トラックへ変換する。純粋関数。
//
// 考え方(three-vrm-animation が VRMA を読むときと同じ):
//   VRM 側の基準姿勢は「全ボーンの回転が単位」の T ポーズ。BVH の基準姿勢(OFFSET の並び)が T ポーズと違う
//   (A ポーズなど)ときは、ボーンごとに「BVH の基準方向 d → VRM の基準方向 c」へ重ねる最小の回転 C を求め、
//   変換後の局所回転を  n_j = C_親 · q_j · C_j⁻¹  とする。T ポーズの BVH では C が単位になり、n_j = q_j のまま。
//   (世界回転で言うと N_j = G_j · C_j⁻¹。基準方向が合っていれば、ポーズ中の骨の向きが BVH と一致する)
// 向きは VRM 1.0 の軸系(前が +Z、キャラの左が +X)を仮定する。左右が逆の BVH は、理由つきで断る。

import type { Bvh, BvhChannel } from './bvh'
import { Q_IDENTITY, qAxisAngle, qDot, qFromTo, qInv, qMul, qNormalize, vAdd, vDot, vNormalize, vSub, qRotate, type Quat, type Vec3 } from './quat'
import type { TrackBone } from './builder'

// --- ボーン名 ---
const SIDES = ['left', 'right'] as const
const FINGERS = {
  Thumb: ['Metacarpal', 'Proximal', 'Distal'],
  Index: ['Proximal', 'Intermediate', 'Distal'],
  Middle: ['Proximal', 'Intermediate', 'Distal'],
  Ring: ['Proximal', 'Intermediate', 'Distal'],
  Little: ['Proximal', 'Intermediate', 'Distal']
} as const

/** VRM 1.0 のヒューマノイドのボーン名 */
export const VRM_BONE_NAMES: ReadonlySet<string> = new Set([
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye', 'jaw',
  ...SIDES.flatMap((s) => [
    `${s}UpperLeg`, `${s}LowerLeg`, `${s}Foot`, `${s}Toes`, `${s}Shoulder`, `${s}UpperArm`, `${s}LowerArm`, `${s}Hand`,
    ...Object.entries(FINGERS).flatMap(([f, parts]) => parts.map((p) => `${s}${f}${p}`))
  ])
])
const LOWER_TO_VRM = new Map([...VRM_BONE_NAMES].map((n) => [n.toLowerCase(), n]))

const MIXAMO_BASE: Record<string, string> = {
  hips: 'hips', pelvis: 'hips', hip: 'hips', spine: 'spine', spine1: 'chest', spine2: 'upperChest', neck: 'neck', head: 'head'
}
const MIXAMO_SIDED: Record<string, string> = {
  shoulder: 'Shoulder', arm: 'UpperArm', forearm: 'LowerArm', hand: 'Hand', upleg: 'UpperLeg', leg: 'LowerLeg', foot: 'Foot', toebase: 'Toes'
}
const MIXAMO_FINGER: Record<string, keyof typeof FINGERS> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Little' }

/** VRM 0.x の親指の名前(Proximal / Intermediate / Distal)→ VRM 1.0(Metacarpal / Proximal / Distal) */
const VRM0_THUMB: Record<string, string> = { proximal: 'Metacarpal', intermediate: 'Proximal', distal: 'Distal' }

/**
 * BVH の関節名 → VRM のボーン名。対応できなければ null。VRM 名(大文字小文字は問わない)を最優先し、Mixamo 系も吸収する。
 * allNames(全関節の小文字名)を渡すと、VRM 0.x 流の親指(ThumbIntermediate がある)を VRM 1.0 の並びに直す
 */
export function resolveBoneName(raw: string, allNames?: ReadonlySet<string>): string | null {
  const lower = raw.toLowerCase()
  const thumb = /^(left|right)thumb(proximal|intermediate|distal)$/.exec(lower)
  if (thumb && allNames?.has(`${thumb[1]}thumbintermediate`) && !allNames.has(`${thumb[1]}thumbmetacarpal`)) {
    return `${thumb[1]}Thumb${VRM0_THUMB[thumb[2]]}`
  }
  const direct = LOWER_TO_VRM.get(lower)
  if (direct) return direct
  const name = raw.replace(/^.*:/, '').replace(/^mixamorig/i, '').toLowerCase()
  const viaVrm = LOWER_TO_VRM.get(name)
  if (viaVrm) return viaVrm
  if (MIXAMO_BASE[name]) return MIXAMO_BASE[name]
  const m = /^(left|right)(.+)$/.exec(name)
  if (!m) return null
  const side = m[1]
  const rest = m[2]
  if (MIXAMO_SIDED[rest]) return `${side}${MIXAMO_SIDED[rest]}`
  const f = /^hand(thumb|index|middle|ring|pinky)([1-4])$/.exec(rest)
  if (f) {
    const finger = MIXAMO_FINGER[f[1]]
    const part = FINGERS[finger][Number(f[2]) - 1]
    return part ? `${side}${finger}${part}` : null // 4 番目(先端)は VRM に無い
  }
  return null
}

// --- 基準方向の表(VRM の T ポーズ)---
/** ボーン → [基準方向, その方向を測る先のボーン(候補を優先順に)] */
export const CANONICAL: Record<string, { dir: Vec3; next: string[] }> = {
  spine: { dir: [0, 1, 0], next: ['chest', 'upperChest', 'neck'] },
  chest: { dir: [0, 1, 0], next: ['upperChest', 'neck'] },
  upperChest: { dir: [0, 1, 0], next: ['neck'] },
  neck: { dir: [0, 1, 0], next: ['head'] },
  leftUpperLeg: { dir: [0, -1, 0], next: ['leftLowerLeg'] },
  leftLowerLeg: { dir: [0, -1, 0], next: ['leftFoot'] },
  rightUpperLeg: { dir: [0, -1, 0], next: ['rightLowerLeg'] },
  rightLowerLeg: { dir: [0, -1, 0], next: ['rightFoot'] },
  leftUpperArm: { dir: [1, 0, 0], next: ['leftLowerArm'] },
  leftLowerArm: { dir: [1, 0, 0], next: ['leftHand'] },
  rightUpperArm: { dir: [-1, 0, 0], next: ['rightLowerArm'] },
  rightLowerArm: { dir: [-1, 0, 0], next: ['rightHand'] }
}
/** これ未満のずれは、補正しない(数値の誤差) */
export const MIN_CORRECT_DEG = 0.5

// --- オプション・結果 ---
export interface RetargetOptions {
  /** 出力のフレームレート上限(既定 30) */
  fps?: number
  /** ファイルの長さの単位 → メートル。省略(auto)なら、腰の高さから推定 */
  unitScale?: number
  /** 腰の水平位置(x, z)を、最初のフレームの位置が原点になるようにそろえる(既定 true。BVH は撮影場所の座標が入っていることが多い) */
  recenter?: boolean
}

export interface RetargetReport {
  /** 使ったボーン(VRM 名) */
  mapped: string[]
  /** 対応できずに無視した関節(BVH の名前) */
  ignored: string[]
  unitScale: number
  frames: number
  durationSec: number
  /** 先頭の数フレームが他と大きく違うため取り除いた(取り除いた数は droppedLeadingFrames) */
  droppedFirstFrame: boolean
  droppedLeadingFrames: number
  /** 足元が床から大きく外れていたため、高さをそろえた量(メートル。補正なしは 0) */
  groundShiftMeters: number
  /** 腰の水平位置を原点にそろえるためにずらした距離(メートル) */
  recenteredMeters: number
  warnings: string[]
}

export interface RetargetedTracks {
  times: number[]
  bones: TrackBone[]
  hipsTranslation: number[]
}

export type RetargetResult = { ok: true; tracks: RetargetedTracks; report: RetargetReport } | { ok: false; reason: string }

const fail = (reason: string): RetargetResult => ({ ok: false, reason })

/** 長さの単位の推定: 腰の高さが 0.9m に最も近くなる候補(m / dm / cm / inch)を選ぶ */
export function guessUnitScale(hipsHeight: number): number {
  if (!(hipsHeight > 0)) return 1
  const candidates = [1, 0.1, 0.01, 0.0254]
  let best = candidates[0]
  let bestErr = Infinity
  for (const c of candidates) {
    const err = Math.abs(Math.log((hipsHeight * c) / 0.9))
    if (err < bestErr) {
      bestErr = err
      best = c
    }
  }
  return best
}

const DEG = Math.PI / 180

/** チャンネルの値から、回転を作る。ファイルに並んだ順に左から掛ける(最初のチャンネルが一番外側) */
function eulerFromChannels(channels: BvhChannel[], values: ArrayLike<number>, start: number): Quat {
  let q: Quat = Q_IDENTITY
  for (let i = 0; i < channels.length; i++) {
    const c = channels[i]
    if (c === 'Xrotation') q = qMul(q, qAxisAngle('x', values[start + i] * DEG))
    else if (c === 'Yrotation') q = qMul(q, qAxisAngle('y', values[start + i] * DEG))
    else if (c === 'Zrotation') q = qMul(q, qAxisAngle('z', values[start + i] * DEG))
  }
  return q
}

/** 先頭フレームが「別物」とみなす、腰の高さに対する関節の1フレームの移動量の割合 / 後続のフレーム間がこれ以下なら静止に近いとみなす割合 */
const OUTLIER_JUMP_RATIO = 0.5
const OUTLIER_STILL_RATIO = 0.05
/** 先頭の何フレームまでを、過渡フレームとして調べるか */
const MAX_LEADING_FRAMES = 6
/** 足元の高さがこれ以上(腰の高さに対する割合)ずれていたら、床に合わせる */
const GROUND_SHIFT_RATIO = 0.2
/** 床合わせの最低点を調べるフレーム数の上限 */
const GROUND_SAMPLES = 300

/** あるフレームの、全関節のワールド位置(ファイルの単位のまま) */
export function jointPositions(bvh: Bvh, frame: number): Vec3[] {
  const { joints } = bvh
  const pos: Vec3[] = []
  const rot: Quat[] = []
  const row = frame * bvh.stride
  joints.forEach((j, i) => {
    const p: Vec3 = [...j.offset]
    j.channels.forEach((c, k) => {
      const v = bvh.data[row + j.channelStart + k]
      if (c === 'Xposition') p[0] = v
      else if (c === 'Yposition') p[1] = v
      else if (c === 'Zposition') p[2] = v
    })
    const q = eulerFromChannels(j.channels, bvh.data, row + j.channelStart)
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

const maxMove = (a: Vec3[], b: Vec3[]): number => a.reduce((m, p, i) => Math.max(m, Math.hypot(p[0] - b[i][0], p[1] - b[i][1], p[2] - b[i][2])), 0)

export function retargetBvh(bvh: Bvh, opts: RetargetOptions = {}): RetargetResult {
  const { joints } = bvh
  const warnings: string[] = []

  // 1. 関節 → VRM ボーン(同じボーンに複数の関節が当たったら、最初のものだけ使う)
  const boneOf: Array<string | null> = joints.map(() => null)
  const used = new Set<string>()
  const ignored: string[] = []
  const lowerNames = new Set(joints.map((j) => j.name.toLowerCase()))
  joints.forEach((j, i) => {
    const b = resolveBoneName(j.name, lowerNames)
    if (b && !used.has(b)) {
      boneOf[i] = b
      used.add(b)
    } else {
      ignored.push(j.name)
    }
  })
  const hipsJoint = boneOf.indexOf('hips')
  if (hipsJoint < 0) return fail('hips にあたる関節が見つかりません(ROOT の名前を確認してください)')
  if (joints[hipsJoint].parent !== -1) return fail('hips が ROOT ではない BVH には未対応です')

  // 2. 基準姿勢のワールド位置(基準姿勢の回転は単位)
  const rest: Vec3[] = joints.map(() => [0, 0, 0])
  joints.forEach((j, i) => {
    rest[i] = j.parent < 0 ? [...j.offset] : vAdd(rest[j.parent], j.offset)
  })
  const mappedParent: number[] = joints.map((j) => {
    let p = j.parent
    while (p >= 0 && boneOf[p] === null) p = joints[p].parent
    return p
  })
  const jointOfBone = new Map<string, number>()
  boneOf.forEach((b, i) => b && jointOfBone.set(b, i))

  // 3. 向きの確認(左が +X であること)
  const lu = jointOfBone.get('leftUpperLeg')
  const ru = jointOfBone.get('rightUpperLeg')
  if (lu !== undefined && ru !== undefined && rest[lu][0] <= rest[ru][0]) {
    return fail('左右が逆(または -Z 向き)の BVH には未対応です。左脚が +X 側にある BVH にしてください')
  }

  // 4. 単位
  const unitScale = opts.unitScale ?? guessUnitScale(rest[hipsJoint][1])

  // 5. 基準方向の補正 C(T ポーズなら単位)
  const correction: Quat[] = joints.map(() => Q_IDENTITY)
  const order = joints.map((_, i) => i) // BVH は親が先
  for (const i of order) {
    const bone = boneOf[i]
    if (!bone) continue
    const inherited = mappedParent[i] >= 0 ? correction[mappedParent[i]] : Q_IDENTITY
    const spec = CANONICAL[bone]
    const nextJoint = spec ? spec.next.map((n) => jointOfBone.get(n)).find((x) => x !== undefined) : undefined
    if (spec && nextJoint !== undefined) {
      const d = vNormalize(vSub(rest[nextJoint], rest[i]))
      const c = spec.dir
      const angle = Math.acos(Math.max(-1, Math.min(1, vDot(d, c)))) / DEG
      correction[i] = angle < MIN_CORRECT_DEG ? Q_IDENTITY : qFromTo(d, c)
      if (angle > 60) warnings.push(`${bone} の基準方向が T ポーズから大きくずれています(${Math.round(angle)}°)。結果が不自然になることがあります`)
    } else {
      correction[i] = inherited
    }
  }

  // 5b. 先頭の数フレームだけが別物(基準姿勢から本来のポーズへ、1〜数フレームで飛んでいる)なら取り除く。
  //     そのままだと、ループのたびに立ち姿と本来のポーズの間を一瞬で行き来する。
  //     判定: 先頭から数フレームの間に、1フレームの移動が腰の高さの半分を超えるところがあり、その直後から静止に近い
  const hipsHeight = Math.max(1e-6, rest[hipsJoint][1])
  let firstFrame = 0
  const lead = Math.min(bvh.frames, MAX_LEADING_FRAMES + 3)
  if (lead >= 4) {
    const pos = Array.from({ length: lead }, (_, f) => jointPositions(bvh, f))
    const move = pos.slice(1).map((p, i) => maxMove(pos[i], p)) // move[i] = フレーム i → i+1
    let last = -1
    for (let i = 0; i < Math.min(MAX_LEADING_FRAMES, move.length - 2); i++) {
      if (move[i] > OUTLIER_JUMP_RATIO * hipsHeight) last = i
    }
    if (last >= 0 && move[last + 1] < OUTLIER_STILL_RATIO * hipsHeight && move[last + 2] < OUTLIER_STILL_RATIO * hipsHeight) {
      firstFrame = last + 1
      warnings.push(`先頭の${firstFrame}フレームだけが他と大きく違っていたため、取り除きました`)
    }
  }

  // 5c. 足元の高さ: クリップ全体の最低点が、基準姿勢の最低点から大きくずれていたら(床の下に埋まる・宙に浮く)、床に合わせる
  const restMinY = Math.min(...rest.map((p) => p[1]))
  let clipMinY = Infinity
  const sampleStep = Math.max(1, Math.floor((bvh.frames - firstFrame) / GROUND_SAMPLES))
  for (let f = firstFrame; f < bvh.frames; f += sampleStep) {
    for (const p of jointPositions(bvh, f)) clipMinY = Math.min(clipMinY, p[1])
  }
  let groundShift = 0 // ファイルの単位
  if (Number.isFinite(clipMinY) && Math.abs(restMinY - clipMinY) > GROUND_SHIFT_RATIO * hipsHeight) {
    groundShift = restMinY - clipMinY
    warnings.push(`足元が床から大きくずれていたため、高さを約 ${(groundShift * unitScale).toFixed(2)}m 補正しました`)
  }

  // 6. フレームの間引き
  const fps = opts.fps ?? 30
  const step = bvh.frameTime < 1 / fps - 1e-9 ? Math.max(1, Math.round(1 / (fps * bvh.frameTime))) : 1
  const frameIdx: number[] = []
  for (let f = firstFrame; f < bvh.frames; f += step) frameIdx.push(f)
  const times = frameIdx.map((f) => (f - firstFrame) * bvh.frameTime)

  // 7. 各ボーンの回転(間に挟まった未対応の関節の回転は、対応する子に合成する)
  const mappedList = order.filter((i) => boneOf[i] !== null)
  const pathTo = (i: number): number[] => {
    const path: number[] = []
    for (let p = i; p >= 0 && p !== mappedParent[i]; p = joints[p].parent) path.unshift(p)
    return path
  }
  const bones: TrackBone[] = []
  for (const i of mappedList) {
    const bone = boneOf[i] as string
    const pj = mappedParent[i]
    const cParent = pj >= 0 ? correction[pj] : Q_IDENTITY
    const cInv = qInv(correction[i])
    const path = pathTo(i)
    const hasRot = path.some((p) => joints[p].channels.some((c) => c.endsWith('rotation')))
    const t: Vec3 = pj >= 0 ? (qRotate(cParent, vSub(rest[i], rest[pj])).map((x) => x * unitScale) as Vec3) : (rest[i].map((x) => x * unitScale) as Vec3)
    const tb: TrackBone = { name: bone, parent: pj >= 0 ? (boneOf[pj] as string) : null, translation: t }
    if (hasRot) {
      const rotations: number[] = []
      let prev: Quat | null = null
      for (const f of frameIdx) {
        const row = f * bvh.stride
        let q: Quat = Q_IDENTITY
        for (const p of path) q = qMul(q, eulerFromChannels(joints[p].channels, bvh.data, row + joints[p].channelStart))
        let n = qNormalize(qMul(qMul(cParent, q), cInv))
        if (prev && qDot(prev, n) < 0) n = [-n[0], -n[1], -n[2], -n[3]] // 補間が遠回りにならないよう、符号をそろえる
        prev = n
        rotations.push(n[0], n[1], n[2], n[3])
      }
      tb.rotations = rotations
    }
    bones.push(tb)
  }

  // 8. hips の位置(ルートの位置チャンネル。無ければ基準位置のまま)
  const root = joints[hipsJoint]
  const hipsTranslation: number[] = []
  const hasPos = root.channels.some((c) => c.endsWith('position'))
  const rootAt = (f: number): Vec3 => {
    const p: Vec3 = [...root.offset]
    if (hasPos) {
      const row = f * bvh.stride + root.channelStart
      root.channels.forEach((c, k) => {
        if (c === 'Xposition') p[0] = bvh.data[row + k]
        else if (c === 'Yposition') p[1] = bvh.data[row + k]
        else if (c === 'Zposition') p[2] = bvh.data[row + k]
      })
    }
    return p
  }
  // 水平位置は、最初のフレームを原点にする(腰が原点から遠い位置に置かれた BVH でも、キャラが飛んでいかないように)
  const origin = opts.recenter === false ? ([0, 0, 0] as Vec3) : rootAt(frameIdx[0])
  const recenteredMeters = Math.hypot(origin[0], origin[2]) * unitScale
  if (recenteredMeters > 0.05) warnings.push(`腰の水平位置が原点から約 ${recenteredMeters.toFixed(2)}m ずれていたため、最初のフレームの位置を原点にそろえました`)
  for (const f of frameIdx) {
    const p = rootAt(f)
    hipsTranslation.push((p[0] - origin[0]) * unitScale, (p[1] + groundShift) * unitScale, (p[2] - origin[2]) * unitScale)
  }

  const durationSec = times[times.length - 1] ?? 0
  return {
    ok: true,
    tracks: { times, bones, hipsTranslation },
    report: {
      mapped: mappedList.map((i) => boneOf[i] as string),
      ignored,
      unitScale,
      frames: frameIdx.length,
      durationSec,
      droppedFirstFrame: firstFrame > 0,
      droppedLeadingFrames: firstFrame,
      groundShiftMeters: groundShift * unitScale,
      recenteredMeters,
      warnings
    }
  }
}
