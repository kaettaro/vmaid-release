import { unzipSync, zipSync } from 'fflate'
import { isSafeRelativePath, pickManifest } from './manifest'

// パックを、1つのファイル(.vmaidpack = zip)にして、自分の別のPC(Mac → Windows など)へ移すための書き出し・取り込み。
// 取り込みは、悪意のある(または壊れた)zip を想定して検査する: 危険なパス(zip slip)・大きすぎる展開・多すぎるファイル・
// 想定外の種類のファイル・Windows で衝突する名前(大文字小文字違い)。純粋ロジック(fflate は純JS・ネイティブなし)。

/** Mod のファイル(zip)の拡張子。旧 `.vmaidpack` も、取り込みでは受け付ける */
export const MOD_FILE_EXT = '.vmaidmod'
export const PACK_FILE_EXT = '.vmaidpack'
export const MAX_ENTRIES = 400
/** 展開後の合計の上限(バイト) */
export const MAX_TOTAL_BYTES = 500 * 1024 * 1024
/** 1ファイルの上限(バイト)。VRMA は、モーションの登録と同じ 30MB まで */
export const MAX_FILE_BYTES = 30 * 1024 * 1024
export const MAX_MANIFEST_FILE_BYTES = 1_000_000

/** PMX の小道具のテクスチャ(画像・MMD のスフィア) */
const PROP_TEXTURE_EXT = /\.(png|jpe?g|bmp|tga|gif|webp|dds|spa|sph)$/

/** パックに入れてよいファイル: pack.yaml、.vrma / .bvh、説明文(.txt / .md) */
export function isAllowedPackFile(path: string): boolean {
  const lower = path.toLowerCase()
  return lower === 'mod.yaml' || lower === 'pack.yaml' || lower.endsWith('.vrma') || lower.endsWith('.bvh') || lower.endsWith('.js') || lower.endsWith('.glb') || lower.endsWith('.fbx') || lower.endsWith('.pmx') || PROP_TEXTURE_EXT.test(lower) || lower.endsWith('.txt') || lower.endsWith('.md')
}

export type PackFiles = Record<string, Uint8Array>

/** ファイルの集まり(パックのフォルダからの相対パス → 中身)を、zip にする。キーが不正なら例外 */
export function packToZip(files: PackFiles): Uint8Array {
  for (const path of Object.keys(files)) {
    if (!isSafeRelativePath(path) || !isAllowedPackFile(path)) throw new Error(`パックに入れられないファイルです: ${path}`)
  }
  // .vrma は、すでに圧縮されている部分が多いので、軽く圧縮する(level 1)
  return zipSync(files, { level: 1 })
}

export type UnzipResult = { ok: true; files: PackFiles } | { ok: false; error: string }

/** zip を検査しながら展開する。問題があれば、理由つきで ok: false(何も書き出さない) */
export function unzipPack(bytes: Uint8Array): UnzipResult {
  let error: string | null = null
  let count = 0
  let total = 0
  const seen = new Set<string>()
  const names = new Map<string, string>() // 元の名前 → 正規化した名前
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (error) return false
        // Windows のツールが付ける `\` 区切りを `/` にそろえてから検査する
        const name = f.name.replace(/\\/g, '/')
        if (name.endsWith('/')) return false // フォルダの項目は、読み飛ばす
        if (!isSafeRelativePath(name)) {
          error = `危険なパスが含まれています: ${f.name}`
          return false
        }
        if (!isAllowedPackFile(name)) {
          error = `パックに入れられない種類のファイルです: ${f.name}`
          return false
        }
        const key = name.toLowerCase()
        if (seen.has(key)) {
          error = `同じ名前(大文字小文字の違いを含む)のファイルが重複しています: ${f.name}`
          return false
        }
        seen.add(key)
        if (++count > MAX_ENTRIES) {
          error = `ファイルが多すぎます(上限 ${MAX_ENTRIES})`
          return false
        }
        const limit = name.toLowerCase() === 'pack.yaml' || name.toLowerCase() === 'mod.yaml' ? MAX_MANIFEST_FILE_BYTES : MAX_FILE_BYTES
        if (f.originalSize > limit) {
          error = `ファイルが大きすぎます: ${f.name}`
          return false
        }
        total += f.originalSize
        if (total > MAX_TOTAL_BYTES) {
          error = '展開後の大きさが、上限を超えています'
          return false
        }
        names.set(f.name, name)
        return true
      }
    })
  } catch (e) {
    return { ok: false, error: `zip を読めませんでした(${e instanceof Error ? e.message : String(e)})` }
  }
  if (error) return { ok: false, error }
  const out: PackFiles = {}
  for (const [orig, data] of Object.entries(files)) {
    const name = names.get(orig) ?? orig.replace(/\\/g, '/')
    out[name] = data
  }
  if (!pickManifest(out)) return { ok: false, error: 'mod.yaml(旧: pack.yaml)が入っていません(Mod ではありません)' }
  return { ok: true, files: out }
}
