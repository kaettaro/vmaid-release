import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseVmd, vmdKind, type Vmd } from '../shared/motions/vmdParse'
import { convertVmdToVrma, VMD_CONVERTER_VERSION, type VmdConvertReport } from '../shared/motions/vmdToVrma'

/** 1 ファイルの大きさの上限(VMD は、長いダンスでも数 MB。壊れたファイル・別のファイルで、メモリを使い切らないように) */
const MAX_VMD_BYTES = 128 * 1024 * 1024

export type VmdFileConvert = { ok: true; vrma: Uint8Array; report: VmdConvertReport; cached: boolean } | { ok: false; reason: string }

/** ファイルの中身(ボーンのキー / モーフのキー)から、体用・表情用・両方・空を調べる。読めなければ null */
export function classifyVmdFile(path: string): ReturnType<typeof vmdKind> | null {
  try {
    if (statSync(path).size > MAX_VMD_BYTES) return null
    const r = parseVmd(new Uint8Array(readFileSync(path)))
    return r.ok ? vmdKind(r.vmd) : null
  } catch {
    return null
  }
}

/**
 * VMD(体 + あれば表情)を VRMA へ変換する。結果は、ファイルの中身と変換の設定が同じなら、使い回す(userData/motions-converted/vmd-…)。
 * paths の先頭が体のファイルで、残りが表情のファイル。
 */
export function convertVmdFiles(paths: readonly string[], cacheDir: string, opts: { armAngleDeg: number | null }, name: string): VmdFileConvert {
  const buffers: Uint8Array[] = []
  for (const p of paths) {
    try {
      if (statSync(p).size > MAX_VMD_BYTES) return { ok: false, reason: `大きすぎます: ${p}` }
      buffers.push(new Uint8Array(readFileSync(p)))
    } catch {
      return { ok: false, reason: `読み込めません: ${p}` }
    }
  }
  const hash = createHash('sha256')
  hash.update(`v${VMD_CONVERTER_VERSION};arm=${opts.armAngleDeg ?? 'auto'};`)
  for (const b of buffers) hash.update(b)
  const dir = join(cacheDir, `vmd-v${VMD_CONVERTER_VERSION}-${hash.digest('hex').slice(0, 16)}`)
  const vrmaPath = join(dir, 'motion.vrma')
  const reportPath = join(dir, 'report.json')
  if (existsSync(vrmaPath) && existsSync(reportPath)) {
    try {
      return { ok: true, vrma: new Uint8Array(readFileSync(vrmaPath)), report: JSON.parse(readFileSync(reportPath, 'utf-8')) as VmdConvertReport, cached: true }
    } catch {
      // 壊れていたら、作り直す
    }
  }
  const vmds: Vmd[] = []
  for (let i = 0; i < buffers.length; i++) {
    const r = parseVmd(buffers[i])
    if (!r.ok) return { ok: false, reason: `${paths[i]}: ${r.reason}` }
    vmds.push(r.vmd)
  }
  const r = convertVmdToVrma(vmds, name, { armAngleDeg: opts.armAngleDeg })
  if (!r.ok) return { ok: false, reason: r.reason }
  try {
    mkdirSync(dir, { recursive: true })
    const tmp = `${vrmaPath}.tmp`
    writeFileSync(tmp, r.vrma)
    renameSync(tmp, vrmaPath) // 書き込み途中で壊れないよう、一時ファイル経由
    writeFileSync(reportPath, JSON.stringify(r.report), 'utf-8')
  } catch (e) {
    console.warn('[motion] VMD の変換結果を保存できません', e) // 保存できなくても、今回の再生には使える
  }
  return { ok: true, vrma: r.vrma, report: r.report, cached: false }
}
