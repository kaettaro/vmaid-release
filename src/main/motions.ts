import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import type { MotionImportOptions, MotionItem, MotionState, MotionTagEdit } from '../shared/ipc'
import { buildMotionList, pickMotionSource, tagMapOf } from '../shared/motionIndex'
import { describeImport, registerMotions, renameMotionEntry, validateMotionName, type MotionImportSummary } from '../shared/motionLibrary'
import {
  addTags,
  addTagsEach,
  deleteTag,
  folderTags,
  normalizeTag,
  parentFolderTag,
  removeMotionTags,
  removeTags,
  renameMotionTags,
  renameTag,
  setTags
} from '../shared/motionMeta'
import { BUILTIN_MOTION_NAMES, BUILTIN_MOTION_TAGS, generateBuiltinMotions } from '../shared/motions/builtin'
import type { MotionMetaStore } from './motionMetaStore'
import { convertFbxFile, isFbxPath } from './fbxConvert'
import type { BvhFileResult } from './bvhConvert'
import { isVmdPath, scanVrmaFiles, vetVrmaFilesAsync } from './motionScan'
import { planVmdPairs } from '../shared/motions/vmdPair'
import { classifyVmdFile, convertVmdFiles } from './vmdConvert'
import type { PackStore } from './packStore'
import type { SettingsStore } from './settingsStore'

/** BVH を VRMA へ変換した結果の置き場所(userData/motions-converted) */
export const bvhCacheDir = (): string => join(app.getPath('userData'), 'motions-converted')

/** 内蔵モーションは起動後に1回だけ生成して使い回す(名前 → VRMA) */
let builtinCache: Map<string, Uint8Array> | null = null
const builtinMotions = (): Map<string, Uint8Array> => {
  builtinCache ??= new Map(generateBuiltinMotions().map((m) => [m.name, m.data]))
  return builtinCache
}

/** VMD(MMD のモーション)を扱ってよいか。公式の機能 Mod「MMD 対応」(PMX で再生・VRM 用に変換)が ON のとき */
const vmdAllowed = (d: MotionDeps): boolean => vmdToVrmAllowed(d)
/** VMD を、VRM のモデル用に変換してよいか。公式の機能 Mod「MMD 対応」が ON のとき(2026-10-17 に、VMD インポーターを統合) */
const vmdToVrmAllowed = (d: Pick<MotionDeps, 'store'>): boolean => d.store.get().mods.features.includes('mmd')
/** FBX のモーションを扱ってよいか。公式の機能 Mod「FBX インポーター」が ON のとき */
const fbxAllowed = (d: MotionDeps): boolean => d.store.get().mods.features.includes('fbx-import')

/** 取り込みダイアログの、拡張子と表示名(Mod が ON のものだけ増える) */
function motionFilter(d: MotionDeps): { label: string; extensions: string[] } {
  const extensions = ['vrma', 'bvh', ...(vmdAllowed(d) ? ['vmd'] : []), ...(fbxAllowed(d) ? ['fbx'] : [])]
  return { label: extensions.map((e) => e.toUpperCase()).join(' / '), extensions }
}

export interface MotionDeps {
  store: SettingsStore
  meta: MotionMetaStore
  packs?: PackStore
}

/** 設定画面の一覧(内蔵 → パック → 登録。同名は1行)。タグは「最初から持つタグ + 利用者が付けたもの」 */
export function motionItems(d: MotionDeps): MotionItem[] {
  return buildMotionList({
    builtin: BUILTIN_MOTION_NAMES,
    builtinTags: BUILTIN_MOTION_TAGS,
    pack: d.packs?.motionEntries() ?? [],
    library: d.store.get().motion.library,
    userTags: d.meta.get().tags
  })
}

/** 使えるモーションの名前の一覧とタグ、待機・足ロックの設定(キャラウィンドウへ送る)。中身は読まない */
export function readMotionState(d: MotionDeps): MotionState {
  const { idle } = d.store.get().motion
  // 足の接地補正は、公式の機能 Mod「足の接地補正」(foot-lock)が ON のときだけ
  const footLock = d.store.get().mods.features.includes('foot-lock')
  const items = motionItems(d)
  // VMD は、MMD のモデルで再生する(VRM のモデルでは、MMD 対応が ON のときだけ、変換して使う)。VMD の名前を、別に知らせる
  const vmd = vmdAllowed(d) ? d.store.get().motion.library.filter((m) => isVmdPath(m.path)).map((m) => m.name) : []
  return { names: items.map((i) => i.name), tags: tagMapOf(items), idle, footLock, vmd, vmdToVrm: vmdToVrmAllowed(d) }
}

/** モーション1件の VRMA の中身。同名なら 登録 > パック > 内蔵。無い・読めなければ null */
export function readMotionData(store: SettingsStore, packs: PackStore | undefined, name: string): Uint8Array | null {
  const { library } = store.get().motion
  const libraryEntry = library.find((m) => m.name === name)
  const packEntry = packs?.motionEntries().find((e) => e.name === name)
  const builtin = builtinMotions()
  const source = pickMotionSource(name, {
    builtin: new Set(builtin.has(name) ? [name] : []),
    pack: new Set(packEntry ? [name] : []),
    library: new Set(libraryEntry ? [name] : [])
  })
  try {
    if (source === 'library' && libraryEntry) return new Uint8Array(readFileSync(libraryEntry.path))
    if (source === 'pack' && packEntry) return new Uint8Array(readFileSync(packEntry.path))
    if (source === 'builtin') return builtin.get(name) ?? null
  } catch {
    console.warn(`[motion] 読み込めません: ${name}`)
  }
  return null
}

/**
 * VRM のモデル用に、モーション 1 件の VRMA の中身を返す。VMD(MMD 対応が ON)なら、変換した VRMA(表情の VMD があれば、足す)。
 * それ以外は readMotionData と同じ。変換の結果は、中身が同じなら使い回す。
 */
export function readMotionDataForVrm(store: SettingsStore, packs: PackStore | undefined, name: string): Uint8Array | null {
  const entry = store.get().motion.library.find((m) => m.name === name)
  if (entry && isVmdPath(entry.path)) {
    if (!vmdToVrmAllowed({ store })) return null
    const r = convertVmdFiles([entry.path, ...(entry.faces ?? [])], bvhCacheDir(), { armAngleDeg: store.get().vmdImport.armAngleDeg }, name)
    if (r.ok) return r.vrma
    console.warn(`[motion] VMD を変換できません: ${name}: ${r.reason}`)
    return null
  }
  return readMotionData(store, packs, name)
}

/** VMD のモーションの変換の結果(使った表情・警告など)を、行ごとの文にして返す。変換していなければ、ここで変換する */
export function vmdMotionReport(d: MotionDeps, name: string): { ok: boolean; lines: string[] } {
  const entry = d.store.get().motion.library.find((m) => m.name === name)
  if (!entry || !isVmdPath(entry.path)) return { ok: false, lines: ['VMD のモーションではありません'] }
  if (!vmdToVrmAllowed(d)) return { ok: false, lines: ['設定 →「Mod」で「MMD 対応」を ON にすると、VRM のモデル用に変換します'] }
  const r = convertVmdFiles([entry.path, ...(entry.faces ?? [])], bvhCacheDir(), { armAngleDeg: d.store.get().vmdImport.armAngleDeg }, name)
  if (!r.ok) return { ok: false, lines: [r.reason] }
  const lines = [`長さ ${r.report.durationSec.toFixed(1)} 秒(${r.report.frames} フレーム)`]
  lines.push(r.report.expressions.length > 0 ? `使った表情: ${r.report.expressions.join('、')}` : '表情のキーは、ありませんでした')
  lines.push(...r.report.warnings)
  return { ok: true, lines }
}

/** 表情の VMD を選んで、VMD のモーションに足す(体の VMD と表情の VMD が別ファイルのとき。VRM のモデルで使うときの変換に使う) */
export function pickAndAddMotionFaces(d: MotionDeps, name: string): { ok: boolean; message: string } {
  const entry = d.store.get().motion.library.find((m) => m.name === name)
  if (!entry || !isVmdPath(entry.path)) return { ok: false, message: 'VMD のモーションではありません' }
  app.focus({ steal: true })
  const paths = dialog.showOpenDialogSync({ title: `「${name}」に足す、表情の VMD を選択(複数選べます)`, properties: ['openFile', 'multiSelections'], filters: [{ name: 'VMD', extensions: ['vmd'] }] })
  if (!paths || paths.length === 0) return { ok: true, message: '' }
  const bad = paths.filter((p) => classifyVmdFile(p) === null || classifyVmdFile(p) === 'empty')
  if (bad.length > 0) return { ok: false, message: `VMD として読めない(またはキーが空の)ファイルがあります: ${bad.map((p) => p.split(/[\\\\/]/).pop()).join('、')}` }
  const faces = [...new Set([...(entry.faces ?? []), ...paths])].slice(0, 20)
  d.store.update((s) => {
    s.motion.library = s.motion.library.map((m) => (m.name === name ? { ...m, faces } : m))
  })
  return { ok: true, message: `表情の VMD を ${paths.length} 件足しました` }
}

/** VMD のモーションに足してある、表情の VMD を、すべて外す */
export function clearMotionFaces(d: MotionDeps, name: string): void {
  d.store.update((s) => {
    s.motion.library = s.motion.library.map((m) => {
      if (m.name !== name || !m.faces) return m
      const { faces: _faces, ...rest } = m
      void _faces
      return rest
    })
  })
}

export interface ImportOutcome {
  /** ダイアログで選ばれたか(キャンセルなら false) */
  picked: boolean
  summary: MotionImportSummary
  message: string
}

const CANCELLED: ImportOutcome = { picked: false, summary: { added: 0, duplicates: 0, rejected: [] }, message: '' }

export const NO_TAGS: MotionImportOptions = { tags: [], tagFromFolders: false }

/** 取り込み時のオプションを、安全な形に整える(IPC で受け取った値は信用しない) */
export function sanitizeImportOptions(raw: unknown): MotionImportOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as { tags?: unknown; tagFromFolders?: unknown }
  const tags = Array.isArray(o.tags) ? [...new Set(o.tags.flatMap((t) => (typeof t === 'string' && normalizeTag(t) ? [normalizeTag(t) as string] : [])))].slice(0, 50) : []
  return { tags, tagFromFolders: o.tagFromFolders === true }
}

/** 候補のパスを検査して、まとめて登録し、タグを付ける。結果を返す */
async function importPaths(
  d: MotionDeps,
  candidates: string[],
  opts: MotionImportOptions,
  extra: { folderRoot?: string; truncatedByScan?: boolean },
  onProgress: (done: number, total: number) => void
): Promise<ImportOutcome> {
  // FBX の変換は非同期なので、検査の前に済ませる(上限の件数まで)
  const fbxResults = new Map<string, BvhFileResult>()
  if (fbxAllowed(d)) {
    const max = d.store.get().motion.maxImportFiles
    for (const p of max > 0 ? candidates.slice(0, max) : candidates) if (isFbxPath(p)) fbxResults.set(p, await convertFbxFile(p, bvhCacheDir()))
  }
  const vetted = await vetVrmaFilesAsync(candidates, { bvhCacheDir: bvhCacheDir(), maxFiles: d.store.get().motion.maxImportFiles, allowVmd: vmdAllowed(d), allowFbx: fbxAllowed(d), fbxResults }, onProgress)
  // MMD 対応が ON のとき: 体の VMD と表情の VMD(同じフォルダ・同じ名前のまとまり)を、1 つのモーションにする
  let toRegister = vetted.ok
  const pairNotes: string[] = []
  let facePlan: Map<string, string[]> | null = null
  if (vmdToVrmAllowed(d)) {
    const plan = planVmdPairs(vetted.ok.filter(isVmdPath).map((path) => ({ path, kind: classifyVmdFile(path) ?? ('empty' as const) })))
    if (plan.faces.size > 0) {
      facePlan = plan.faces
      const faceFiles = new Set([...plan.faces.values()].flat())
      toRegister = vetted.ok.filter((p) => !faceFiles.has(p))
      const base = (p: string): string => p.split(/[\\/]/).pop() ?? p
      for (const [body, faces] of plan.faces) pairNotes.push(`体と表情を組み合わせました: ${base(body)} + ${faces.map(base).join('、')}`)
    }
  }
  const result = registerMotions(d.store.get().motion.library, toRegister)
  if (result.added.length > 0) {
    d.store.update((s) => {
      s.motion.library = result.library
    })
  }
  if (facePlan) {
    const plan = facePlan
    d.store.update((s) => {
      s.motion.library = s.motion.library.map((m) => {
        const f = plan.get(m.path)
        return f ? { ...m, faces: [...new Set([...(m.faces ?? []), ...f])].slice(0, 20) } : m
      })
    })
  }

  // タグ: 全件共通のタグ + (希望すれば)フォルダ名。すでに登録済みだったものにも付ける(あとから、まとめてタグを付けたいとき用)
  let tagged = 0
  if (opts.tags.length > 0 || opts.tagFromFolders) {
    const nameByPath = new Map(result.library.map((m) => [m.path, m.name]))
    const pairs: Array<[string, string[]]> = []
    vetted.ok.forEach((path, i) => {
      const name = nameByPath.get(path)
      if (!name) return
      const source = vetted.sources[i]
      const fromFolder = !opts.tagFromFolders ? [] : extra.folderRoot ? folderTags(extra.folderRoot, source) : parentFolderTag(source)
      const tags = [...opts.tags, ...fromFolder]
      if (tags.length > 0) pairs.push([name, tags])
    })
    const before = d.meta.get()
    const after = addTagsEach(before, pairs)
    if (after !== before) d.meta.set(after)
    tagged = pairs.length
  }

  const summary: MotionImportSummary = {
    added: result.added.length,
    duplicates: result.duplicates.length,
    rejected: vetted.rejected,
    converted: vetted.converted,
    notes: [...(vetted.notes ?? []), ...pairNotes],
    ...(vetted.truncatedFrom !== undefined ? { truncatedFrom: vetted.truncatedFrom } : {})
  }
  let message = describeImport(summary)
  if (tagged > 0) message += ` / ${tagged}件にタグを付けました`
  if (extra.truncatedByScan) message += ' / フォルダ内のファイルが多すぎたため、探索を途中で打ち切りました'
  return { picked: true, summary, message }
}

/** VRMAを複数選んで一括登録する(選択ダイアログは、Ctrl/Cmd/Shift で複数選べる) */
export async function pickAndAddMotions(d: MotionDeps, opts: MotionImportOptions = NO_TAGS, onProgress: (done: number, total: number) => void = () => {}): Promise<ImportOutcome> {
  // モデル選択と同じ理由で、前面化して同期ダイアログを使う(characterWindow.pickModel 参照)
  app.focus({ steal: true })
  const paths = dialog.showOpenDialogSync({
    title: `モーション(${motionFilter(d).label})を選択(複数選べます)`,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: motionFilter(d).label, extensions: motionFilter(d).extensions }]
  })
  if (!paths || paths.length === 0) return CANCELLED
  return importPaths(d, paths, opts, {}, onProgress)
}

/** フォルダを選んで、中の .vrma / .bvh(サブフォルダも含む)を一括登録する */
export async function pickAndAddMotionFolder(d: MotionDeps, opts: MotionImportOptions = NO_TAGS, onProgress: (done: number, total: number) => void = () => {}): Promise<ImportOutcome> {
  app.focus({ steal: true })
  const dirs = dialog.showOpenDialogSync({
    title: 'モーションが入っているフォルダを選択(中の VRMA / BVH をまとめて取り込みます)',
    properties: ['openDirectory']
  })
  if (!dirs || dirs.length === 0) return CANCELLED
  const scan = scanVrmaFiles(dirs[0], { vmd: vmdAllowed(d), fbx: fbxAllowed(d) })
  return importPaths(d, scan.paths, opts, { folderRoot: dirs[0], truncatedByScan: scan.aborted }, onProgress)
}

export function setIdleMotion(store: SettingsStore, name: string | null): void {
  store.update((s) => (s.motion.idle = name))
}

/** 1回の取り込みで検査する件数の上限(0 = 無制限) */
export function setMaxImportFiles(store: SettingsStore, n: number): void {
  const v = Number.isFinite(n) ? Math.min(1_000_000, Math.max(0, Math.floor(n))) : 0
  store.update((s) => (s.motion.maxImportFiles = v))
}

/**
 * 登録モーションの名前を変える(内蔵モーションは変更できない)。
 * 変更後の名前が、内蔵・ほかの登録と被るなら失敗する。待機に使っていれば、待機の指定も新しい名前に追従する。タグも追従する
 */
export function renameMotion(d: MotionDeps, from: string, rawTo: string): { ok: true; name: string } | { ok: false; reason: string } {
  const { library } = d.store.get().motion
  if (!library.some((m) => m.name === from)) return { ok: false, reason: 'このモーションは、登録を変更できません(内蔵・パックのモーションの名前は変えられません)' }
  const taken = [...BUILTIN_MOTION_NAMES, ...library.filter((m) => m.name !== from).map((m) => m.name)]
  const check = validateMotionName(rawTo, taken)
  if (!check.ok || check.name === from) return check.ok ? { ok: true, name: from } : check
  d.store.update((s) => {
    s.motion.library = renameMotionEntry(s.motion.library, from, check.name)
    if (s.motion.idle === from) s.motion.idle = check.name
  })
  d.meta.set(renameMotionTags(d.meta.get(), from, check.name))
  return { ok: true, name: check.name }
}

/** 登録を、まとめて外す(内蔵・パックのものは無視する)。外した数を返す。待機に使っていれば、待機なしに戻す。タグも消す */
export function removeMotions(d: MotionDeps, names: readonly string[]): number {
  const drop = new Set(names)
  const before = d.store.get().motion.library.length
  d.store.update((s) => {
    s.motion.library = s.motion.library.filter((m) => !drop.has(m.name))
    // 待機に使っていたものを外したら、待機なしに戻す(同じ名前の内蔵・パックのモーションが残るなら、それを使う)
    const idle = s.motion.idle
    if (idle !== null && drop.has(idle) && !BUILTIN_MOTION_NAMES.includes(idle) && !d.packs?.motionEntries().some((e) => e.name === idle)) s.motion.idle = null
  })
  d.meta.set(removeMotionTags(d.meta.get(), names))
  return before - d.store.get().motion.library.length
}

export function removeMotion(d: MotionDeps, name: string): void {
  removeMotions(d, [name])
}

/** タグを、まとめて足す・外す・入れ替える。存在しない名前は無視する(IPC の入力は信用しない) */
export function editMotionTags(d: MotionDeps, edit: MotionTagEdit): void {
  const known = new Set(motionItems(d).map((i) => i.name))
  const names = edit.names.filter((n) => typeof n === 'string' && known.has(n))
  let meta = d.meta.get()
  if (edit.set) meta = setTags(meta, names, edit.set)
  else {
    if (edit.add) meta = addTags(meta, names, edit.add)
    if (edit.remove) meta = removeTags(meta, names, edit.remove)
  }
  d.meta.set(meta)
}

export function renameMotionTagEverywhere(d: MotionDeps, from: string, to: string): void {
  d.meta.set(renameTag(d.meta.get(), from, to))
}

export function deleteMotionTagEverywhere(d: MotionDeps, tag: string): void {
  d.meta.set(deleteTag(d.meta.get(), tag))
}
