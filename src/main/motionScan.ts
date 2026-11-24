import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { isVmd } from '../shared/mmd/names'
import { checkVrmaBytes, MAX_VRMA_BYTES, type MotionImportSummary } from '../shared/motionLibrary'
import { convertBvhFile, isBvhPath, type BvhFileResult } from './bvhConvert'
import { isFbxPath } from './fbxConvert'

// フォルダの中の .vrma / .bvh を探す(.bvh は取り込み時に VRMA へ変換する)。Electron 非依存(テストできる)。
// 誤って巨大なフォルダ(ホームやドライブ全体)を選んでも固まらないよう、深さと走査数に上限を設ける。

const MAX_DEPTH = 6
/** 走査するエントリ数の上限(ファイルを数える前に、フォルダの探索自体を打ち切る) */
const MAX_ENTRIES = 200000
const MOTION_EXTENSIONS = ['.vrma', '.bvh']
/** MMD 対応 Mod が ON のときだけ、探す・取り込む */
const VMD_EXTENSION = '.vmd'
export const isVmdPath = (p: string): boolean => extname(p).toLowerCase() === VMD_EXTENSION

export interface ScanResult {
  /** 見つかった .vrma / .bvh のパス(名前順) */
  paths: string[]
  /** 探索を途中で打ち切った(エントリが多すぎる) */
  aborted: boolean
}

export function scanVrmaFiles(root: string, opts: { vmd?: boolean; fbx?: boolean } = {}): ScanResult {
  const extensions = [...MOTION_EXTENSIONS, ...(opts.vmd ? [VMD_EXTENSION] : []), ...(opts.fbx ? ['.fbx'] : [])]
  const paths: string[] = []
  let entries = 0
  let aborted = false

  const walk = (dir: string, depth: number): void => {
    if (aborted) return
    let names: string[]
    try {
      names = readdirSync(dir).sort()
    } catch {
      return // 読めないフォルダは飛ばす
    }
    for (const name of names) {
      if (++entries > MAX_ENTRIES) {
        aborted = true
        return
      }
      if (name.startsWith('.')) continue // 隠しファイル・フォルダ(.git、.DS_Store など)
      const path = join(dir, name)
      let st
      try {
        st = statSync(path) // シンボリックリンクは辿った先で判定する(ループは深さ上限で止まる)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (depth < MAX_DEPTH) walk(path, depth + 1)
      } else if (st.isFile() && extensions.includes(extname(name).toLowerCase())) {
        paths.push(path)
      }
    }
  }
  walk(root, 0)
  return { paths, aborted }
}

export interface VetOptions {
  /** BVH を VRMA へ変換した結果の置き場所 */
  bvhCacheDir?: string
  /** 検査する件数の上限。0 または省略なら、無制限 */
  maxFiles?: number
  /** VMD(MMD のモーション)を取り込んでよいか。MMD 対応 Mod が ON のときだけ true */
  allowVmd?: boolean
  /** FBX(Mixamo など)を取り込んでよいか。FBX インポーター Mod が ON のときだけ true */
  allowFbx?: boolean
  /** FBX を、あらかじめ(非同期で)変換した結果(元のパス → 結果)。FBX の変換は非同期なので、検査の前に済ませておく */
  fbxResults?: ReadonlyMap<string, BvhFileResult>
}

export interface VetResult {
  /** 読める VRMA のパス。.bvh を渡したものは、変換後の .vrma のパスになる */
  ok: string[]
  /** ok と同じ順で、元のパス(.bvh を渡したものは、変換前の .bvh のパス) */
  sources: string[]
  rejected: MotionImportSummary['rejected']
  truncatedFrom?: number
  /** あらたに BVH から変換した数(変換済みのキャッシュを使ったものは数えない) */
  converted: number
  /** 利用者に伝えたい注意(無視した関節など) */
  notes: string[]
}

type VetOne = { ok: { path: string; source: string; converted: boolean; notes: string[] } } | { rejected: { path: string; reason: string } }

/** 1ファイルを検査する(.bvh は変換してから) */
function vetOne(source: string, opts: VetOptions): VetOne {
  let path = source
  let converted = false
  const notes: string[] = []
  if (isVmdPath(source)) {
    // VMD は、VRMA に変換せず、そのまま登録する(MMD のモデルで再生する)。形式と大きさだけ確かめる
    if (!opts.allowVmd) return { rejected: { path: source, reason: 'VMD は、設定 →「Mod」で「MMD 対応」を ON にすると取り込めます' } }
    try {
      const size = statSync(source).size
      if (size > MAX_VRMA_BYTES) return { rejected: { path: source, reason: `大きすぎます(${Math.round(size / 1e6)}MB。上限 ${MAX_VRMA_BYTES / 1024 / 1024}MB)` } }
      if (!isVmd(new Uint8Array(readFileSync(source)).subarray(0, 64))) return { rejected: { path: source, reason: 'VMD ファイルではありません' } }
      return { ok: { path: source, source, converted: false, notes } }
    } catch {
      return { rejected: { path: source, reason: '読み込めません' } }
    }
  }
  if (isFbxPath(source)) {
    if (!opts.allowFbx) return { rejected: { path: source, reason: 'FBX は、設定 →「Mod」で「FBX インポーター」を ON にすると取り込めます' } }
    const r = opts.fbxResults?.get(source)
    if (!r) return { rejected: { path: source, reason: 'FBX を変換できませんでした' } }
    if (!r.ok) return { rejected: { path: source, reason: r.reason } }
    path = r.path
    if (r.report) {
      converted = true
      if (r.report.ignored.length > 0) {
        const names = r.report.ignored.slice(0, 5).join(', ') + (r.report.ignored.length > 5 ? ' ほか' : '')
        notes.push(`${source}: 対応できない骨を無視しました(${names})`)
      }
      notes.push(...r.report.warnings.map((w) => `${source}: ${w}`))
    }
  } else if (isBvhPath(source)) {
    if (!opts.bvhCacheDir) return { rejected: { path: source, reason: 'BVH の変換先が指定されていません' } }
    const r = convertBvhFile(source, opts.bvhCacheDir)
    if (!r.ok) return { rejected: { path: source, reason: r.reason } }
    path = r.path
    if (r.report) {
      converted = true
      if (r.report.ignored.length > 0) {
        const names = r.report.ignored.slice(0, 5).join(', ') + (r.report.ignored.length > 5 ? ' ほか' : '')
        notes.push(`${source}: 対応できない関節を無視しました(${names})`)
      }
      notes.push(...r.report.warnings.map((w) => `${source}: ${w}`))
    }
  }
  try {
    const size = statSync(path).size
    if (size > MAX_VRMA_BYTES) {
      return { rejected: { path: source, reason: `大きすぎます(${Math.round(size / 1e6)}MB。上限 ${MAX_VRMA_BYTES / 1024 / 1024}MB)` } }
    }
    const check = checkVrmaBytes(new Uint8Array(readFileSync(path)))
    if (!check.ok) return { rejected: { path: source, reason: check.reason } }
    return { ok: { path, source, converted, notes } }
  } catch {
    return { rejected: { path: source, reason: '読み込めません' } }
  }
}

const emptyResult = (): VetResult => ({ ok: [], sources: [], rejected: [], converted: 0, notes: [] })

function collect(res: VetResult, one: VetOne): void {
  if ('rejected' in one) {
    res.rejected.push(one.rejected)
    return
  }
  res.ok.push(one.ok.path)
  res.sources.push(one.ok.source)
  if (one.ok.converted) res.converted++
  res.notes.push(...one.ok.notes)
}

/**
 * 候補のパスを検査して、読めるものと、読めないもの(理由つき)に分ける(同期)。
 * 件数・サイズの上限を超えるものは取り込まない。.bvh は bvhCacheDir に VRMA として変換してから検査する。
 */
export function vetVrmaFiles(candidates: string[], opts: VetOptions = {}): VetResult {
  const res = emptyResult()
  const limit = opts.maxFiles && opts.maxFiles > 0 ? opts.maxFiles : candidates.length
  for (const source of candidates.slice(0, limit)) collect(res, vetOne(source, opts))
  if (candidates.length > limit) res.truncatedFrom = candidates.length
  return res
}

/** 一度に処理する時間の目安(ミリ秒)。これを超えたら、いったん制御を返して、画面・メニューを固めない */
const SLICE_MS = 40

/**
 * vetVrmaFiles の非同期版。大量のファイル(BVH の変換を含む)でも、メインプロセスを固めないよう、
 * 一定時間ごとに制御を返す。onProgress に、処理した数と総数を知らせる
 */
export async function vetVrmaFilesAsync(
  candidates: string[],
  opts: VetOptions = {},
  onProgress: (done: number, total: number) => void = () => {}
): Promise<VetResult> {
  const res = emptyResult()
  const limit = opts.maxFiles && opts.maxFiles > 0 ? opts.maxFiles : candidates.length
  const list = candidates.slice(0, limit)
  let sliceStart = Date.now()
  for (let i = 0; i < list.length; i++) {
    collect(res, vetOne(list[i], opts))
    if (Date.now() - sliceStart >= SLICE_MS) {
      onProgress(i + 1, list.length)
      await new Promise<void>((r) => setImmediate(r))
      sliceStart = Date.now()
    }
  }
  onProgress(list.length, list.length)
  if (candidates.length > limit) res.truncatedFrom = candidates.length
  return res
}
