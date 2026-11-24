// VRMA(glTF Binary + VRMC_vrm_animation 拡張)をコードで組み立てる。外部素材を使わないのでライセンス問題がない。
// Electron/Node 非依存(Buffer を使わない)。回転は VRM 1.0 の軸系(正面 +Z、キャラの左が +X)の絶対値で、
// VRM 0.x への変換は three-vrm-animation が行う。腕を下ろす = 左腕 z=-1.2 / 右腕 z=+1.2。

import { qAxisAngle, qMul, type Quat } from './quat'

export type Euler = [number, number, number]

export interface PoseFrame {
  /** ボーン名 → オイラー角(x,y,z)。書かなかったボーンは単位回転(Tポーズ) */
  rot: Record<string, Euler>
  /** hips の高さ(メートル)。指定したモーションだけ translation トラックを出す */
  hipsY?: number
}

export interface MotionDef {
  name: string
  durationSec: number
  /** キーフレームの間隔(秒) */
  stepSec: number
  pose: (t: number, duration: number) => PoseFrame
}

// --- ボーン階層(Tポーズ。単位メートル)---
type V3 = [number, number, number]
const mirror = (v: V3): V3 => [-v[0], v[1], v[2]]
const BONES: Array<[name: string, parent: string | null, translation: V3]> = [
  ['hips', null, [0, 1.0, 0]],
  ['spine', 'hips', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.15, 0]],
  ['neck', 'chest', [0, 0.2, 0]],
  ['head', 'neck', [0, 0.08, 0]],
  ['leftShoulder', 'chest', [0.04, 0.12, 0]],
  ['leftUpperArm', 'leftShoulder', [0.1, 0, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.25, 0, 0]],
  ['leftHand', 'leftLowerArm', [0.25, 0, 0]],
  ['rightShoulder', 'chest', mirror([0.04, 0.12, 0])],
  ['rightUpperArm', 'rightShoulder', mirror([0.1, 0, 0])],
  ['rightLowerArm', 'rightUpperArm', mirror([0.25, 0, 0])],
  ['rightHand', 'rightLowerArm', mirror([0.25, 0, 0])],
  ['leftUpperLeg', 'hips', [0.08, -0.05, 0]],
  ['leftLowerLeg', 'leftUpperLeg', [0, -0.4, 0]],
  ['leftFoot', 'leftLowerLeg', [0, -0.4, 0]],
  ['rightUpperLeg', 'hips', mirror([0.08, -0.05, 0])],
  ['rightLowerLeg', 'rightUpperLeg', [0, -0.4, 0]],
  ['rightFoot', 'rightLowerLeg', [0, -0.4, 0]]
]
export const BONE_NAMES = BONES.map(([name]) => name)
const boneIndex = Object.fromEntries(BONES.map(([name], i) => [name, i]))

// --- クォータニオン(x,y,z,w)---
export const eulerToQuat = ([x, y, z]: Euler): Quat => qMul(qMul(qAxisAngle('x', x), qAxisAngle('y', y)), qAxisAngle('z', z))

// --- GLB 書き出し ---
const encoder = new TextEncoder()

function pad4(bytes: Uint8Array, fill: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill)
  out.set(bytes)
  return out
}

/** 骨格の1ボーン。回転トラックは quaternion(x,y,z,w)を時刻順に並べた配列 */
export interface TrackBone {
  name: string
  parent: string | null
  /** 親からの相対位置(メートル。基準姿勢) */
  translation: V3
  rotations?: number[]
}

export interface TracksInput {
  name: string
  generator: string
  /** キーフレームの時刻(秒) */
  times: number[]
  /** 親が先に来る順 */
  bones: TrackBone[]
  /** 回転チャンネルを書く順(省略時は bones の順で、rotations があるもの) */
  rotationOrder?: string[]
  /** hips の位置(x,y,z を時刻順に並べた配列。メートル、ワールド位置)。あれば translation トラックを出す */
  hipsTranslation?: number[]
  /** 表情(VRM の表情プリセット名 → 時刻ごとの重み 0〜1)。VRMA の仕様どおり、表情ごとに空のノードを作り、translation の x に重みを入れる */
  expressions?: Array<{ name: string; weights: number[] }>
}

/** ボーンの階層とトラックから VRMA(glTF Binary)を書き出す。基準姿勢の回転は単位回転(T ポーズ)として出す */
export function buildVrmaFromTracks(input: TracksInput): Uint8Array {
  const { times, bones } = input
  const index = Object.fromEntries(bones.map((b, i) => [b.name, i]))

  const bins: Uint8Array[] = []
  const bufferViews: object[] = []
  const accessors: object[] = []
  let offset = 0
  const addAccessor = (data: ArrayLike<number>, type: 'SCALAR' | 'VEC3' | 'VEC4', withMinMax: boolean): number => {
    const arr = Float32Array.from(data)
    const bytes = new Uint8Array(arr.buffer)
    bins.push(bytes)
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
    const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type]
    const acc: Record<string, unknown> = {
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: arr.length / comps,
      type
    }
    if (withMinMax) {
      let lo = Infinity
      let hi = -Infinity
      for (const v of arr) {
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      acc.min = [lo]
      acc.max = [hi]
    }
    accessors.push(acc)
    offset += bytes.length
    return accessors.length - 1
  }

  const input0 = addAccessor(times, 'SCALAR', true)
  const samplers: object[] = []
  const channels: object[] = []
  const addChannel = (node: number, path: 'rotation' | 'translation', data: ArrayLike<number>, type: 'VEC3' | 'VEC4'): void => {
    const output = addAccessor(data, type, false)
    samplers.push({ input: input0, output, interpolation: 'LINEAR' })
    channels.push({ sampler: samplers.length - 1, target: { node, path } })
  }

  const order = input.rotationOrder ?? bones.filter((b) => b.rotations).map((b) => b.name)
  for (const name of order) {
    const bone = bones[index[name]]
    if (!bone?.rotations) throw new Error(`未知のボーン: ${name}`)
    addChannel(index[name], 'rotation', bone.rotations, 'VEC4')
  }
  const root = bones.findIndex((b) => b.parent === null)
  if (input.hipsTranslation) addChannel(index.hips, 'translation', input.hipsTranslation, 'VEC3')

  const nodes: Array<{ name: string; translation: V3; children?: number[] }> = bones.map((b) => ({
    name: b.name,
    translation: b.translation
  }))
  // 表情のノード(骨格とは別の根)。translation.x に重みを入れる
  const exprNodes: Record<string, { node: number }> = {}
  for (const e of input.expressions ?? []) {
    nodes.push({ name: `expression_${e.name}`, translation: [0, 0, 0] })
    const node = nodes.length - 1
    exprNodes[e.name] = { node }
    addChannel(node, 'translation', e.weights.flatMap((w) => [w, 0, 0]), 'VEC3')
  }
  bones.forEach((b) => {
    if (b.parent !== null) (nodes[index[b.parent]].children ??= []).push(index[b.name])
  })
  const humanBones = Object.fromEntries(bones.map((b) => [b.name, { node: index[b.name] }]))

  const json = {
    asset: { version: '2.0', generator: input.generator },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: { VRMC_vrm_animation: { specVersion: '1.0', humanoid: { humanBones }, ...(Object.keys(exprNodes).length > 0 ? { expressions: { preset: exprNodes } } : {}) } },
    scene: 0,
    scenes: [{ nodes: [root, ...Object.values(exprNodes).map((e) => e.node)] }],
    nodes,
    animations: [{ name: input.name, samplers, channels }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }]
  }

  const bin = new Uint8Array(offset)
  let p = 0
  for (const b of bins) {
    bin.set(b, p)
    p += b.length
  }
  const jsonChunk = pad4(encoder.encode(JSON.stringify(json)), 0x20)
  const binChunk = pad4(bin, 0)

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  out.set(encoder.encode('glTF'), 0)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonChunk.length, true)
  out.set(encoder.encode('JSON'), 16)
  out.set(jsonChunk, 20)
  const binHead = 20 + jsonChunk.length
  view.setUint32(binHead, binChunk.length, true)
  out.set([0x42, 0x49, 0x4e, 0x00], binHead + 4) // 'BIN\0'
  out.set(binChunk, binHead + 8)
  return out
}

export function buildVrma(def: MotionDef): Uint8Array {
  const times: number[] = []
  for (let t = 0; t <= def.durationSec + 1e-9; t += def.stepSec) times.push(Math.min(t, def.durationSec))
  const frames = times.map((t) => def.pose(t, def.durationSec))

  const animated = new Set(frames.flatMap((f) => Object.keys(f.rot)))
  for (const bone of animated) {
    if (!(bone in boneIndex)) throw new Error(`未知のボーン: ${bone}`)
  }
  const bones: TrackBone[] = BONES.map(([name, parent, translation]) => ({
    name,
    parent,
    translation,
    ...(animated.has(name) ? { rotations: frames.flatMap((f) => eulerToQuat(f.rot[name] ?? [0, 0, 0])) } : {})
  }))
  return buildVrmaFromTracks({
    name: def.name,
    generator: 'VMaid builtin motions',
    times,
    bones,
    rotationOrder: [...animated],
    ...(frames.some((f) => f.hipsY !== undefined) ? { hipsTranslation: frames.flatMap((f) => [0, f.hipsY ?? 1.0, 0]) } : {})
  })
}
