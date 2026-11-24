// 小道具(glb)の検査。Electron/Three.js に依存しない純粋ロジック。
// 小道具は、Mod が持つ 3D の物(振り子・ハートなど)。次を確かめて、通らないものは読み込まない:
// - GLB(バイナリ glTF 2.0)として正しい形か / 大きさ・JSON の大きさが上限以内か
// - 外部ファイル・URL への参照(`uri` が data: 以外)が無い(中身が、1ファイルで完結している。通信・ほかのファイルの読み出しを起こさない)

export const MAX_PROP_BYTES = 20 * 1024 * 1024
const MAX_JSON_BYTES = 2 * 1024 * 1024
const GLB_MAGIC = 0x46546c67 // 'glTF'(リトルエンディアン)
const CHUNK_JSON = 0x4e4f534a // 'JSON'

export type GlbCheck = { ok: true } | { ok: false; reason: string }

function externalRef(node: unknown, depth = 0): string | null {
  if (depth > 20 || typeof node !== 'object' || node === null) return null
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = externalRef(x, depth + 1)
      if (r) return r
    }
    return null
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'uri' && typeof v === 'string' && !v.startsWith('data:')) return v.slice(0, 80)
    const r = externalRef(v, depth + 1)
    if (r) return r
  }
  return null
}

export function checkGlb(data: Uint8Array): GlbCheck {
  if (data.length > MAX_PROP_BYTES) return { ok: false, reason: `大きすぎます(上限 ${MAX_PROP_BYTES / 1024 / 1024}MB)` }
  if (data.length < 20) return { ok: false, reason: 'GLB として読めません(短すぎます)' }
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (v.getUint32(0, true) !== GLB_MAGIC) return { ok: false, reason: 'GLB ファイルではありません(.glb のみ対応です)' }
  if (v.getUint32(4, true) !== 2) return { ok: false, reason: 'glTF 2.0 ではありません' }
  if (v.getUint32(8, true) !== data.length) return { ok: false, reason: 'GLB の長さが合いません(壊れています)' }
  const jsonLen = v.getUint32(12, true)
  if (v.getUint32(16, true) !== CHUNK_JSON || jsonLen > MAX_JSON_BYTES || 20 + jsonLen > data.length) {
    return { ok: false, reason: 'GLB の JSON 部分が正しくありません' }
  }
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder('utf-8').decode(data.subarray(20, 20 + jsonLen)))
  } catch {
    return { ok: false, reason: 'GLB の JSON を読めません' }
  }
  const ext = externalRef(json)
  if (ext) return { ok: false, reason: `外部ファイル・URL(${ext})を参照しています。1ファイルで完結した GLB にしてください` }
  return { ok: true }
}
