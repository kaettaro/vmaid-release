// ダンス Mod の「楽曲の表」: 楽曲の名前(「踊って ○○」の○○)→ モーション + BGM。Electron に依存しない。
// 表は、Mod のスロット(kind: dances)に、JSON 文字列として入る(キャラごと・全キャラ共通)。
// 曲のファイルは、利用者が選ぶ(素材は同梱しない)。

import { z } from 'zod'
import { normalizeText } from './rules/template'

/** 表の行数の上限 */
export const MAX_DANCES = 100

const clamp = (n: number, lo: number, hi: number): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)

export const DanceEntrySchema = z.object({
  /** 楽曲の名前(「踊って ○○」の○○に合う名前) */
  name: z.string().trim().min(1).max(40),
  /** 踊るモーションの名前(登録したモーション) */
  motion: z.string().min(1).max(200),
  /** BGM の曲ファイルのパス(空なら、BGM なしで、モーションだけ) */
  bgm: z.string().max(1000).catch(''),
  /** 曲のここ(秒)から流し始める。前奏を飛ばして、振り付けと合わせる */
  offsetSec: z.number().catch(0).transform((n) => clamp(n, 0, 3600)),
  /** BGM の音量(0〜1) */
  volume: z.number().catch(1).transform((n) => clamp(n, 0, 1))
})

export type DanceEntry = z.infer<typeof DanceEntrySchema>

/** 表(JSON 文字列)を読む。壊れていれば空。1行ずつ検証して、壊れた行だけ捨てる。同じ名前は、後のものを使う */
export function parseDances(text: string | undefined): DanceEntry[] {
  if (!text) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const byName = new Map<string, DanceEntry>()
  for (const e of raw) {
    const r = DanceEntrySchema.safeParse(e)
    if (r.success) byName.set(normalizeText(r.data.name), r.data)
  }
  return [...byName.values()].slice(0, MAX_DANCES)
}

/**
 * 編集中の行(下書き)。名前・モーションが、まだ空の行も、保存できる。
 * 実際に使う表(parseDances)は、名前とモーションがそろった行だけ。下書きは、設定画面を開き直したり、別の操作で画面が作り直されても、消えない。
 */
export const DanceDraftSchema = DanceEntrySchema.extend({
  name: z.string().max(40).catch(''),
  motion: z.string().max(200).catch('')
})

/** 編集画面用に、表(JSON 文字列)を読む。名前が空の行も、同じ名前の行も、そのまま残す */
export function parseDanceDrafts(text: string | undefined): DanceEntry[] {
  if (!text) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: DanceEntry[] = []
  for (const e of raw) {
    const r = DanceDraftSchema.safeParse(e)
    if (r.success) out.push(r.data)
  }
  return out.slice(0, MAX_DANCES)
}

/** 編集画面の行を、スロットに入れる文字列にする(下書きも含める。空なら、空の文字列) */
export function serializeDanceDrafts(entries: readonly DanceEntry[]): string {
  const rows = entries.slice(0, MAX_DANCES).map((e) => DanceDraftSchema.parse(e))
  return rows.length === 0 ? '' : JSON.stringify(rows)
}

/** 表を、スロットに入れる文字列にする(空なら、空の文字列 = 共通の値に戻る) */
export function serializeDances(entries: readonly DanceEntry[]): string {
  const valid = entries.filter((e) => DanceEntrySchema.safeParse(e).success)
  return valid.length === 0 ? '' : JSON.stringify(valid)
}

/**
 * 入力された名前に合う行を探す。全角・半角・大小文字・空白・記号は区別しない。
 * 1) 名前が完全に一致 2) 入力が行の名前を含む(長い名前を優先。「ワルツを」など、助詞つきでも合う) 3) 行の名前が入力を含む(2 文字以上)
 */
export function findDance(entries: readonly DanceEntry[], query: string): DanceEntry | undefined {
  const q = normalizeText(query)
  if (q === '') return undefined
  const keyed = entries.map((e) => ({ e, k: normalizeText(e.name) })).filter((x) => x.k !== '')
  const exact = keyed.find((x) => x.k === q)
  if (exact) return exact.e
  const inside = keyed.filter((x) => q.includes(x.k)).sort((a, b) => b.k.length - a.k.length)[0]
  if (inside) return inside.e
  if (q.length >= 2) return keyed.find((x) => x.k.includes(q))?.e
  return undefined
}

/** 表の中の BGM のパス(読み出しの許可リストに使う) */
export function danceBgmPaths(entries: readonly DanceEntry[]): string[] {
  return entries.map((e) => e.bgm).filter((p) => p !== '')
}
