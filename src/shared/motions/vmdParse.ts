// VMD(MikuMikuDance のモーション)の読み込み。純粋関数(Electron/DOM に依存しない)。
// 形式は、広く知られたバイナリ形式(公式の仕様書は無い)。手元の実ファイルで、ボーン名・フレーム数・補間の並びを確認して書いている。
//   ヘッダ 30 バイト(Vocaloid Motion Data 0002)+ モデル名 20 バイト(Shift-JIS)
//   ボーン: 件数 u32、1 件 111 バイト = 名前 15 + フレーム u32 + 位置 3×f32 + 回転 4×f32(x,y,z,w)+ 補間 64
//   モーフ: 件数 u32、1 件 23 バイト = 名前 15 + フレーム u32 + 重み f32
//   カメラ(61 バイト)・照明(28 バイト)・セルフシャドウ(9 バイト)は読み飛ばし、
//   そのあとの「プロパティ」(フレーム u32 + 表示 u8 + IK の数 u32 + [IK 名 20 バイト + ON/OFF u8]…)に、足 IK の ON/OFF が入る。
// 座標・回転は MMD の左手系のまま返す(右手系への変換は、使う側で)。

export interface VmdBoneKey {
  frame: number
  /** MMD の座標(左手系)のままの、基準位置からの移動量 */
  position: [number, number, number]
  /** MMD の回転(x, y, z, w) */
  rotation: [number, number, number, number]
  /** 補間: 4 本のベジェ曲線(x, y, z, 回転)の制御点 (x1, x2, y1, y2)。0〜127 */
  curves: { x: Curve; y: Curve; z: Curve; rot: Curve }
}

/** ベジェ曲線の制御点 (x1, y1) (x2, y2)。0〜1 に正規化済み */
export interface Curve {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface VmdMorphKey {
  frame: number
  weight: number
}

/** IK の ON/OFF の切り替え(そのフレームから) */
export interface VmdIkState {
  frame: number
  states: Record<string, boolean>
}

export interface Vmd {
  modelName: string
  /** ボーン名 → フレーム順のキー */
  bones: Map<string, VmdBoneKey[]>
  morphs: Map<string, VmdMorphKey[]>
  ikStates: VmdIkState[]
  /** 最後のキーのフレーム */
  lastFrame: number
}

export type VmdParseResult = { ok: true; vmd: Vmd } | { ok: false; reason: string }

const HEADER_V2 = 'Vocaloid Motion Data 0002'
const HEADER_V1 = 'Vocaloid Motion Data file'
const BONE_BYTES = 111
const MORPH_BYTES = 23
const CAMERA_BYTES = 61
const LIGHT_BYTES = 28
const SHADOW_BYTES = 9
/** 1 ファイルのキーの数の上限(壊れたファイルで、メモリを使い切らないように) */
export const MAX_VMD_KEYS = 2_000_000

/** ファイルの先頭が VMD か */
export function looksLikeVmd(bytes: Uint8Array): boolean {
  if (bytes.length < 50) return false
  let s = ''
  for (let i = 0; i < HEADER_V2.length; i++) s += String.fromCharCode(bytes[i])
  return s === HEADER_V2 || s.slice(0, HEADER_V1.length) === HEADER_V1
}

export function parseVmd(bytes: Uint8Array): VmdParseResult {
  if (!looksLikeVmd(bytes)) return { ok: false, reason: 'VMD ファイルではありません(ヘッダが違います)' }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder('shift-jis')
  const text = (offset: number, max: number): string => {
    let end = 0
    while (end < max && bytes[offset + end] !== 0) end++
    return decoder.decode(bytes.subarray(offset, offset + end))
  }
  const isV1 = String.fromCharCode(...bytes.subarray(0, HEADER_V1.length)) === HEADER_V1
  const modelName = text(30, isV1 ? 10 : 20)
  let o = 30 + (isV1 ? 10 : 20)
  const need = (n: number): boolean => o + n <= bytes.length
  const readCount = (): number | null => {
    if (!need(4)) return null
    const n = view.getUint32(o, true)
    o += 4
    return n
  }

  const boneCount = readCount()
  if (boneCount === null) return { ok: false, reason: 'VMD が途中で切れています' }
  if (boneCount > MAX_VMD_KEYS || !need(boneCount * BONE_BYTES)) return { ok: false, reason: 'VMD のボーンのキーの数が不正です(壊れているか、大きすぎます)' }
  const bones = new Map<string, VmdBoneKey[]>()
  let lastFrame = 0
  for (let i = 0; i < boneCount; i++) {
    const base = o + i * BONE_BYTES
    const name = text(base, 15)
    const frame = view.getUint32(base + 15, true)
    const f = (k: number): number => view.getFloat32(base + 19 + k * 4, true)
    const ip = (k: number): number => bytes[base + 47 + k] / 127
    const curve = (c: number): Curve => ({ x1: ip(c), x2: ip(c + 8), y1: ip(c + 4), y2: ip(c + 12) })
    const key: VmdBoneKey = {
      frame,
      position: [f(0), f(1), f(2)],
      rotation: [f(3), f(4), f(5), f(6)],
      curves: { x: curve(0), y: curve(1), z: curve(2), rot: curve(3) }
    }
    if (![...key.position, ...key.rotation].every(Number.isFinite)) continue
    let list = bones.get(name)
    if (!list) bones.set(name, (list = []))
    list.push(key)
    lastFrame = Math.max(lastFrame, frame)
  }
  o += boneCount * BONE_BYTES
  for (const list of bones.values()) list.sort((a, b) => a.frame - b.frame)

  const morphs = new Map<string, VmdMorphKey[]>()
  const morphCount = readCount()
  if (morphCount !== null) {
    if (morphCount > MAX_VMD_KEYS || !need(morphCount * MORPH_BYTES)) return { ok: false, reason: 'VMD のモーフのキーの数が不正です(壊れているか、大きすぎます)' }
    for (let i = 0; i < morphCount; i++) {
      const base = o + i * MORPH_BYTES
      const name = text(base, 15)
      const frame = view.getUint32(base + 15, true)
      const weight = view.getFloat32(base + 19, true)
      if (!Number.isFinite(weight)) continue
      let list = morphs.get(name)
      if (!list) morphs.set(name, (list = []))
      list.push({ frame, weight })
      lastFrame = Math.max(lastFrame, frame)
    }
    o += morphCount * MORPH_BYTES
    for (const list of morphs.values()) list.sort((a, b) => a.frame - b.frame)
  }

  // カメラ・照明・セルフシャドウは読み飛ばす(無いファイルもある)
  for (const size of [CAMERA_BYTES, LIGHT_BYTES, SHADOW_BYTES]) {
    const n = readCount()
    if (n === null) break
    if (!need(n * size)) return { ok: true, vmd: { modelName, bones, morphs, ikStates: [], lastFrame } }
    o += n * size
  }

  // プロパティ(IK の ON/OFF)
  const ikStates: VmdIkState[] = []
  const propCount = readCount()
  if (propCount !== null && propCount <= MAX_VMD_KEYS) {
    for (let i = 0; i < propCount; i++) {
      if (!need(9)) break
      const frame = view.getUint32(o, true)
      const ikCount = view.getUint32(o + 5, true)
      o += 9
      if (ikCount > 1000 || !need(ikCount * 21)) break
      const states: Record<string, boolean> = {}
      for (let k = 0; k < ikCount; k++) {
        states[text(o, 20)] = bytes[o + 20] !== 0
        o += 21
      }
      ikStates.push({ frame, states })
    }
    ikStates.sort((a, b) => a.frame - b.frame)
  }
  return { ok: true, vmd: { modelName, bones, morphs, ikStates, lastFrame } }
}

/** ファイルの中身の種類: 体(ボーンの動き)・表情(モーフ)・どちらも・どちらも無い */
export function vmdKind(vmd: Vmd): 'body' | 'face' | 'both' | 'empty' {
  const hasBone = [...vmd.bones.values()].some((l) => l.length > 0)
  const hasMorph = [...vmd.morphs.values()].some((l) => l.length > 0)
  if (hasBone && hasMorph) return 'both'
  if (hasBone) return 'body'
  if (hasMorph) return 'face'
  return 'empty'
}
