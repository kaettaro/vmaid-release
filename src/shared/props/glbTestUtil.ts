/** テスト用の GLB を作る(JSON チャンクだけ) */
export function makeGlb(json: unknown, opts: { version?: number; lengthDelta?: number } = {}): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const padded = Math.ceil(text.length / 4) * 4
  const body = new Uint8Array(padded).fill(0x20)
  body.set(text)
  const total = 20 + padded
  const out = new Uint8Array(total)
  const v = new DataView(out.buffer)
  v.setUint32(0, 0x46546c67, true)
  v.setUint32(4, opts.version ?? 2, true)
  v.setUint32(8, total + (opts.lengthDelta ?? 0), true)
  v.setUint32(12, padded, true)
  v.setUint32(16, 0x4e4f534a, true)
  out.set(body, 20)
  return out
}
