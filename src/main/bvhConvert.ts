import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { BVH_CONVERTER_VERSION, convertBvhToVrma } from '../shared/motions/bvhToVrma'
import type { RetargetReport } from '../shared/motions/bvhRetarget'

// BVH ファイルを、取り込み時に VRMA へ変換して、キャッシュのフォルダに置く(再生側は VRMA のまま)。
// Electron 非依存(テストできる)。変換結果は <cacheDir>/<内容のハッシュ>-v<変換版>/<元のファイル名>.vrma に置き、
// 同じ内容なら再変換しない(元の BVH を動かしても、内容が同じなら同じ結果を使う)。

/** BVH 1ファイルのサイズの上限(バイト) */
export const MAX_BVH_FILE_BYTES = 50 * 1024 * 1024

export const isBvhPath = (path: string): boolean => extname(path).toLowerCase() === '.bvh'

export type BvhFileResult =
  | { ok: true; path: string; /** 今回あらたに変換したときだけ付く */ report?: RetargetReport }
  | { ok: false; reason: string }

export function convertBvhFile(src: string, cacheDir: string): BvhFileResult {
  let bytes: Buffer
  try {
    const size = statSync(src).size
    if (size > MAX_BVH_FILE_BYTES) return { ok: false, reason: `大きすぎます(${Math.round(size / 1e6)}MB。上限 ${MAX_BVH_FILE_BYTES / 1024 / 1024}MB)` }
    bytes = readFileSync(src)
  } catch {
    return { ok: false, reason: '読み込めません' }
  }
  const key = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-v${BVH_CONVERTER_VERSION}`
  const base = basename(src, extname(src)) || 'motion'
  const outDir = join(cacheDir, key)
  const outFile = join(outDir, `${base}.vrma`)
  if (existsSync(outFile)) return { ok: true, path: outFile }

  // UTF-8(BOM つきでも可)として読む。BVH は ASCII が普通
  const decoded = bytes.toString('utf-8')
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded
  const r = convertBvhToVrma(text, base)
  if (!r.ok) return { ok: false, reason: `BVH として変換できません: ${r.reason}` }
  try {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(outFile, r.vrma)
  } catch {
    return { ok: false, reason: '変換結果を保存できません' }
  }
  return { ok: true, path: outFile, report: r.report }
}
