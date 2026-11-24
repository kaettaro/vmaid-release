import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { buildVrmaFromTracks } from '../shared/motions/builder'
import { retargetBvh } from '../shared/motions/bvhRetarget'
import { skeletonToBvh } from '../shared/motions/skeletonToBvh'
import type { BvhFileResult } from './bvhConvert'
import { MAX_FBX_BYTES, sampleFbx } from './fbxSample'

// FBX のモーションを、取り込み時に VRMA へ変換して、キャッシュに置く(再生側は VRMA のまま)。BVH と同じ経路:
// FBX → 骨格のサンプル → BVH の形(skeletonToBvh)→ 向き・単位・足元の補正と VRM ボーンへの対応(retargetBvh)→ VRMA。
// 変換結果は <cacheDir>/<内容のハッシュ>-fbx<変換版>/<元のファイル名>.vrma に置き、同じ内容なら再変換しない。

/** 変換の仕様を変えたら上げる(古い結果を使い回さない)。BVH の変換版にも依存する */
export const FBX_CONVERTER_VERSION = 1

export const isFbxPath = (path: string): boolean => extname(path).toLowerCase() === '.fbx'

export async function convertFbxFile(src: string, cacheDir: string): Promise<BvhFileResult> {
  let bytes: Buffer
  try {
    const size = statSync(src).size
    if (size > MAX_FBX_BYTES) return { ok: false, reason: `大きすぎます(${Math.round(size / 1e6)}MB。上限 ${MAX_FBX_BYTES / 1024 / 1024}MB)` }
    bytes = readFileSync(src)
  } catch {
    return { ok: false, reason: '読み込めません' }
  }
  const key = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}-fbx${FBX_CONVERTER_VERSION}`
  const base = basename(src, extname(src)) || 'motion'
  const outDir = join(cacheDir, key)
  const outFile = join(outDir, `${base}.vrma`)
  if (existsSync(outFile)) return { ok: true, path: outFile }

  const sampled = await sampleFbx(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  if (!sampled.ok) return { ok: false, reason: `FBX として変換できません: ${sampled.reason}` }
  const bvh = skeletonToBvh(sampled.skeleton)
  if (!bvh.ok) return { ok: false, reason: `FBX として変換できません: ${bvh.reason}` }
  const r = retargetBvh(bvh.bvh)
  if (!r.ok) return { ok: false, reason: `FBX として変換できません: ${r.reason}` }
  const { times, bones, hipsTranslation } = r.tracks
  const vrma = buildVrmaFromTracks({ name: base, generator: 'VMaid FBX import', times, bones, hipsTranslation })
  try {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(outFile, vrma)
  } catch {
    return { ok: false, reason: '変換結果を保存できません' }
  }
  return { ok: true, path: outFile, report: r.report }
}
