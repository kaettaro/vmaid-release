// 登録済みVRMAの一覧操作。Electron非依存の純粋関数
export interface MotionEntry {
  name: string
  path: string
  /** VMD に足す、表情の VMD のパス */
  faces?: string[]
}

/** パス(Win/Mac両対応)から拡張子なしのファイル名を取り出す */
export function motionNameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.vrma$/i, '') || 'motion'
}

/** 同じパスは重複登録しない。名前が被ったら -2, -3… を付ける */
export function registerMotion(library: MotionEntry[], path: string): MotionEntry[] {
  if (library.some((m) => m.path === path)) return library
  const base = motionNameFromPath(path)
  let name = base
  for (let i = 2; library.some((m) => m.name === name); i++) name = `${base}-${i}`
  return [...library, { name, path }]
}

export interface BulkRegisterResult {
  library: MotionEntry[]
  /** 新しく登録したもの */
  added: MotionEntry[]
  /** すでに登録済みだった(同じパス)のでスキップしたもの */
  duplicates: string[]
}

/**
 * 複数のパスをまとめて登録する。同じパスは1つにまとめ、名前が被れば連番を付ける。
 * 数千件でも遅くならないよう、パスと名前は Set で引く(1件ずつ全件を調べると、件数の2乗で遅くなる)
 */
export function registerMotions(library: MotionEntry[], paths: string[]): BulkRegisterResult {
  const knownPaths = new Set(library.map((m) => m.path))
  const usedNames = new Set(library.map((m) => m.name))
  /** 名前の元ごとに、次に試す連番(同じ名前が何百もあるとき、毎回 2 から数え直さない) */
  const nextSuffix = new Map<string, number>()
  const added: MotionEntry[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    if (seen.has(path)) continue // 選択に同じファイルが重複していても1回だけ
    seen.add(path)
    if (knownPaths.has(path)) {
      duplicates.push(path)
      continue
    }
    const base = motionNameFromPath(path)
    let name = base
    if (usedNames.has(name)) {
      let i = nextSuffix.get(base) ?? 2
      while (usedNames.has(`${base}-${i}`)) i++
      name = `${base}-${i}`
      nextSuffix.set(base, i + 1)
    }
    usedNames.add(name)
    knownPaths.add(path)
    added.push({ name, path })
  }
  return { library: added.length > 0 ? [...library, ...added] : library, added, duplicates }
}

export interface MotionImportSummary {
  added: number
  duplicates: number
  /** 読み込めなかった(VRMAとして不正・大きすぎる等)ファイルと、その理由 */
  rejected: Array<{ path: string; reason: string }>
  /** 打ち切った(上限を超えた)場合、見つかった総数 */
  truncatedFrom?: number
  /** あらたに BVH から VRMA へ変換した数 */
  converted?: number
  /** 利用者に伝えたい注意(無視した関節など) */
  notes?: string[]
}

/** 取り込み結果を、1行の日本語にする */
export function describeImport(s: MotionImportSummary): string {
  if (s.added === 0 && s.duplicates === 0 && s.rejected.length === 0) return '取り込めるモーション(.vrma / .bvh)が見つかりませんでした'
  const parts = [`${s.added}件を追加しました`]
  if (s.converted) parts.push(`うち${s.converted}件は BVH から変換`)
  if (s.duplicates > 0) parts.push(`${s.duplicates}件は登録済みのためスキップ`)
  if (s.rejected.length > 0) parts.push(`${s.rejected.length}件は読み込めませんでした`)
  if (s.truncatedFrom !== undefined) parts.push(`多すぎるため先頭の一部だけを取り込みました(見つかった数: ${s.truncatedFrom})`)
  return parts.join(' / ')
}

/** VRMA(glTF Binary)として最低限成り立っているか。先頭が "glTF" で、全体の長さがファイルサイズと一致する */
export function checkVrmaBytes(bytes: Uint8Array): { ok: true } | { ok: false; reason: string } {
  if (bytes.length < 20) return { ok: false, reason: 'ファイルが小さすぎます' }
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (magic !== 'glTF') return { ok: false, reason: 'VRMA(glTF Binary)ではありません' }
  const total = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true)
  if (total !== bytes.length) return { ok: false, reason: 'ファイルが壊れています(サイズが一致しません)' }
  return { ok: true }
}

/** 取り込みの上限(1回あたりの件数・1ファイルのサイズ)。暴走や誤って巨大なフォルダを選んだ場合の保護 */
export const MAX_VRMA_BYTES = 30 * 1024 * 1024

/** モーション名の上限(文字数) */
export const MAX_MOTION_NAME = 40

/**
 * 新しいモーション名を整える。前後の空白を除き、1〜40文字、制御文字なし。
 * 既存の名前(内蔵・登録済み。変更前の自分の名前は除く)と被る場合は、理由つきでエラーにする。
 */
export function validateMotionName(raw: string, taken: Iterable<string>): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.trim()
  // eslint-disable-next-line no-control-regex
  if (name === '' || [...name].length > MAX_MOTION_NAME || /[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, reason: `名前は、1〜${MAX_MOTION_NAME}文字で入力してください` }
  }
  for (const t of taken) if (t === name) return { ok: false, reason: `「${name}」は、すでに使われている名前です` }
  return { ok: true, name }
}

/** 登録済みモーションの名前を変える(ファイルの場所は変えない)。見つからなければそのまま返す */
export function renameMotionEntry(library: MotionEntry[], from: string, to: string): MotionEntry[] {
  return library.map((m) => (m.name === from ? { ...m, name: to } : m))
}
