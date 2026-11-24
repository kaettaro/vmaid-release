// BVH(Biovision Hierarchy)のパーサー。Electron/Node 非依存の純粋関数。
// 読むのは、HIERARCHY(ROOT / JOINT / End Site、OFFSET、CHANNELS)と MOTION(Frames、Frame Time、数値の表)。
// 壊れた・巨大な入力でも固まらないよう、関節数・フレーム数・文字数に上限を設ける。

export const MAX_BVH_CHARS = 60 * 1024 * 1024
export const MAX_BVH_JOINTS = 400
export const MAX_BVH_FRAMES = 200000
/** 全フレーム分の数値の総数の上限(メモリ保護) */
export const MAX_BVH_VALUES = 40_000_000

export type BvhChannel = 'Xposition' | 'Yposition' | 'Zposition' | 'Xrotation' | 'Yrotation' | 'Zrotation'
const CHANNELS = new Set<string>(['Xposition', 'Yposition', 'Zposition', 'Xrotation', 'Yrotation', 'Zrotation'])

export interface BvhJoint {
  name: string
  /** 親の関節の番号(ルートは -1) */
  parent: number
  /** 親からの相対位置(ファイルの単位のまま) */
  offset: [number, number, number]
  /** この関節のチャンネル(ファイルの並びのまま。回転の合成順を決める) */
  channels: BvhChannel[]
  /** フレームの行の中で、この関節のチャンネルが始まる位置 */
  channelStart: number
}

export interface Bvh {
  joints: BvhJoint[]
  frames: number
  /** フレームの間隔(秒) */
  frameTime: number
  /** 1フレームあたりの数値の数 */
  stride: number
  /** frames × stride の表(行優先) */
  data: Float32Array
}

export type BvhParseResult = { ok: true; bvh: Bvh } | { ok: false; reason: string }

const fail = (reason: string): BvhParseResult => ({ ok: false, reason })

/** HIERARCHY 部分を、空白区切りの語と波括弧に分ける */
function tokenize(s: string): string[] {
  return s
    .replace(/[{}]/g, (c) => ` ${c} `)
    .split(/\s+/)
    .filter((t) => t !== '')
}

export function parseBvh(text: string): BvhParseResult {
  if (text.length > MAX_BVH_CHARS) return fail('BVH が大きすぎます')
  const split = text.search(/^\s*MOTION\s*$/m)
  if (split < 0) return fail('BVH として読めません(MOTION の行がありません)')
  const head = tokenize(text.slice(0, split))
  const body = text.slice(split)

  // --- HIERARCHY(再帰を使わず、スタックで読む。深すぎる入力でも落ちない)---
  let pos = 0
  if (head[pos++]?.toUpperCase() !== 'HIERARCHY') return fail('BVH として読めません(HIERARCHY で始まっていません)')
  const joints: BvhJoint[] = []
  let stride = 0
  let rootSeen = false
  /** いま開いているブロック。関節の番号、End Site は -1 */
  const stack: number[] = []

  const startJoint = (name: string | undefined, parent: number): string | null => {
    if (!name) return '関節の名前がありません'
    if (joints.length >= MAX_BVH_JOINTS) return `関節が多すぎます(上限 ${MAX_BVH_JOINTS})`
    if (head[pos++] !== '{') return '波括弧 { がありません'
    joints.push({ name, parent, offset: [0, 0, 0], channels: [], channelStart: 0 })
    stack.push(joints.length - 1)
    return null
  }

  while (pos < head.length) {
    const t = head[pos++]
    const key = t.toUpperCase()
    if (key === 'ROOT') {
      if (rootSeen) return fail('複数の ROOT は未対応です')
      rootSeen = true
      const e = startJoint(head[pos++], -1)
      if (e) return fail(e)
    } else if (key === 'JOINT') {
      const top = stack[stack.length - 1]
      if (top === undefined || top < 0) return fail('JOINT の位置が不正です')
      const e = startJoint(head[pos++], top)
      if (e) return fail(e)
    } else if (key === 'END') {
      if (head[pos++]?.toUpperCase() !== 'SITE') return fail('End Site が不正です')
      if (head[pos++] !== '{') return fail('波括弧 { がありません')
      stack.push(-1)
    } else if (key === 'OFFSET') {
      const v = [Number(head[pos]), Number(head[pos + 1]), Number(head[pos + 2])]
      pos += 3
      if (v.some((n) => !Number.isFinite(n))) return fail('OFFSET の数値が不正です')
      const top = stack[stack.length - 1]
      if (top !== undefined && top >= 0) joints[top].offset = [v[0], v[1], v[2]]
    } else if (key === 'CHANNELS') {
      const n = Number(head[pos++])
      if (!Number.isInteger(n) || n < 0 || n > 6) return fail('CHANNELS の数が不正です')
      const top = stack[stack.length - 1]
      if (top === undefined || top < 0) return fail('CHANNELS の位置が不正です')
      const chans: BvhChannel[] = []
      for (let i = 0; i < n; i++) {
        const c = head[pos++]
        const norm = c ? c[0].toUpperCase() + c.slice(1).toLowerCase() : ''
        if (!CHANNELS.has(norm)) return fail(`未対応のチャンネルです: ${c ?? ''}`)
        chans.push(norm as BvhChannel)
      }
      joints[top].channels = chans
      joints[top].channelStart = stride
      stride += n
    } else if (t === '}') {
      if (stack.length === 0) return fail('波括弧 } が多すぎます')
      stack.pop()
    } else {
      return fail(`HIERARCHY に不明な語があります: ${t.slice(0, 30)}`)
    }
  }
  if (stack.length !== 0) return fail('波括弧が閉じていません')
  if (joints.length === 0) return fail('関節がありません')
  if (stride === 0) return fail('チャンネルがありません')

  // --- MOTION ---
  const lines = body.split(/\r?\n/)
  let li = lines.findIndex((l) => l.trim().toUpperCase() === 'MOTION') + 1 // MOTION の行の次から(CRLF だと先頭に空行が付くことがある)
  let frames = NaN
  let frameTime = NaN
  while (li < lines.length && (Number.isNaN(frames) || Number.isNaN(frameTime))) {
    const line = lines[li++].trim()
    if (line === '') continue
    const f = /^frames\s*:\s*(\S+)$/i.exec(line)
    const ft = /^frame\s*time\s*:\s*(\S+)$/i.exec(line)
    if (f) frames = Number(f[1])
    else if (ft) frameTime = Number(ft[1])
    else return fail('MOTION の見出し(Frames / Frame Time)が不正です')
  }
  if (!Number.isInteger(frames) || frames < 1) return fail('Frames が不正です')
  if (!Number.isFinite(frameTime) || frameTime <= 0 || frameTime > 10) return fail('Frame Time が不正です')
  if (frames > MAX_BVH_FRAMES) return fail(`フレーム数が多すぎます(上限 ${MAX_BVH_FRAMES})`)
  if (frames * stride > MAX_BVH_VALUES) return fail('データが大きすぎます')

  const data = new Float32Array(frames * stride)
  let n = 0
  for (; li < lines.length && n < data.length; li++) {
    const line = lines[li].trim()
    if (line === '') continue
    for (const tok of line.split(/\s+/)) {
      if (n >= data.length) break
      const v = Number(tok)
      if (!Number.isFinite(v)) return fail(`MOTION の数値が不正です(${li + 1} 行目)`)
      data[n++] = v
    }
  }
  if (n < data.length) return fail(`MOTION のデータが足りません(必要 ${data.length} 個、実際 ${n} 個)`)

  return { ok: true, bvh: { joints, frames, frameTime, stride, data } }
}
