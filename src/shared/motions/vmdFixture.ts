// テスト用: VMD のバイト列を、組み立てる(実際の素材を使わずに、パーサ・変換・取り込みを試すため)。本番のコードからは使わない。
// Shift-JIS の書き込みは、ボーン名を ASCII + 少数の日本語に絞るため、テーブルで引く(TextEncoder は UTF-8 しか書けない)。

import type { VmdIkState } from './vmdParse'

/** よく使う骨・モーフの名前の Shift-JIS(必要になったものだけ足す) */
const SJIS: Record<string, number[]> = {
  センター: [0x83, 0x5a, 0x83, 0x93, 0x83, 0x5e, 0x81, 0x5b],
  上半身: [0x8f, 0xe3, 0x94, 0xbc, 0x90, 0x67],
  下半身: [0x89, 0xba, 0x94, 0xbc, 0x90, 0x67],
  左腕: [0x8d, 0xb6, 0x98, 0x72],
  左ひじ: [0x8d, 0xb6, 0x82, 0xd0, 0x82, 0xb6],
  左足: [0x8d, 0xb6, 0x91, 0xab],
  左ひざ: [0x8d, 0xb6, 0x82, 0xd0, 0x82, 0xb4],
  左足首: [0x8d, 0xb6, 0x91, 0xab, 0x8e, 0xf1],
  左足ＩＫ: [0x8d, 0xb6, 0x91, 0xab, 0x82, 0x68, 0x82, 0x6a],
  まばたき: [0x82, 0xdc, 0x82, 0xce, 0x82, 0xbd, 0x82, 0xab],
  あ: [0x82, 0xa0],
  笑い: [0x8f, 0xce, 0x82, 0xa2],
  謎のモーフ: [0x93, 0xe4, 0x82, 0xcc, 0x83, 0x82, 0x81, 0x5b, 0x83, 0x74]
}

export interface FixtureBoneKey {
  name: string
  frame: number
  position?: [number, number, number]
  rotation?: [number, number, number, number]
  /** 補間(既定は、直線) */
  interp?: number[]
}
export interface FixtureMorphKey {
  name: string
  frame: number
  weight: number
}

const LINEAR = (): number[] => {
  // 4 本の曲線(x, y, z, 回転)すべてが 直線 = (20,20) (107,107)
  const a = new Array(64).fill(0)
  for (let c = 0; c < 4; c++) {
    a[c] = 20 // x1
    a[c + 4] = 20 // y1
    a[c + 8] = 107 // x2
    a[c + 12] = 107 // y2
  }
  return a
}

function writeName(bytes: Uint8Array, offset: number, name: string, max: number): void {
  const enc = SJIS[name] ?? Array.from(new TextEncoder().encode(name))
  bytes.set(enc.slice(0, max), offset)
}

export function buildVmd(opts: { bones?: FixtureBoneKey[]; morphs?: FixtureMorphKey[]; ikStates?: VmdIkState[]; model?: string }): Uint8Array {
  const bones = opts.bones ?? []
  const morphs = opts.morphs ?? []
  const ik = opts.ikStates ?? []
  const size = 30 + 20 + 4 + bones.length * 111 + 4 + morphs.length * 23 + 4 * 3 + 4 + ik.reduce((s, k) => s + 9 + Object.keys(k.states).length * 21, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode('Vocaloid Motion Data 0002'), 0)
  writeName(out, 30, opts.model ?? 'test', 20)
  let o = 50
  view.setUint32(o, bones.length, true)
  o += 4
  for (const k of bones) {
    writeName(out, o, k.name, 15)
    view.setUint32(o + 15, k.frame, true)
    const p = k.position ?? [0, 0, 0]
    const r = k.rotation ?? [0, 0, 0, 1]
    for (let i = 0; i < 3; i++) view.setFloat32(o + 19 + i * 4, p[i], true)
    for (let i = 0; i < 4; i++) view.setFloat32(o + 31 + i * 4, r[i], true)
    out.set(k.interp ?? LINEAR(), o + 47)
    o += 111
  }
  view.setUint32(o, morphs.length, true)
  o += 4
  for (const k of morphs) {
    writeName(out, o, k.name, 15)
    view.setUint32(o + 15, k.frame, true)
    view.setFloat32(o + 19, k.weight, true)
    o += 23
  }
  o += 4 * 3 // カメラ・照明・セルフシャドウの件数(0)
  view.setUint32(o, ik.length, true)
  o += 4
  for (const k of ik) {
    view.setUint32(o, k.frame, true)
    out[o + 4] = 1
    const names = Object.keys(k.states)
    view.setUint32(o + 5, names.length, true)
    o += 9
    for (const n of names) {
      writeName(out, o, n, 20)
      out[o + 20] = k.states[n] ? 1 : 0
      o += 21
    }
  }
  return out
}
