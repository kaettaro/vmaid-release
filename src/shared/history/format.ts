import { z } from 'zod'
import { DEFAULT_CHARACTER_ID } from '../characters'

// 会話履歴の保存形式(SPEC 7章): history/YYYY-MM.jsonl、1行1メッセージ {ts, role, text}。
// ネイティブDBを避けるため JSONL。Electron非依存の純粋ロジック。

export const HistoryEntrySchema = z.object({
  /** 発話時刻(エポックミリ秒) */
  ts: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  /** どのキャラとの会話か(古い記録には無い。無ければ、最初のキャラ `default` のもの) */
  characterId: z.string().optional()
})

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>

export function serializeEntry(e: HistoryEntry): string {
  return JSON.stringify(e.characterId ? { ts: e.ts, role: e.role, text: e.text, characterId: e.characterId } : { ts: e.ts, role: e.role, text: e.text })
}

/** JSONLを読む。壊れた行(書き込み途中の切断など)は、全体を止めずに読み飛ばす */
export function parseLines(content: string): HistoryEntry[] {
  const out: HistoryEntry[] = []
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const r = HistoryEntrySchema.safeParse(JSON.parse(line))
      if (r.success) out.push(r.data)
    } catch {
      // 壊れた行は無視
    }
  }
  return out
}

/** その記録が、このキャラとの会話か(characterId が無い古い記録は、最初のキャラ `default` のもの) */
export function belongsTo(e: HistoryEntry, characterId: string): boolean {
  return (e.characterId ?? DEFAULT_CHARACTER_ID) === characterId
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 保存先ファイル名の月(ローカル時間)。例: 2026-10 */
export function monthKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function fileNameForMonth(month: string): string {
  return `${month}.jsonl`
}

/** ファイル名が履歴ファイル(YYYY-MM.jsonl)か。月の文字列を返す(違えば null) */
export function monthFromFileName(name: string): string | null {
  const m = /^(\d{4}-\d{2})\.jsonl$/.exec(name)
  return m ? m[1] : null
}

/**
 * 文脈に使うため、末尾から直近 maxTurns ターン分を取り出す。
 * ターンは「ユーザー発話から次のユーザー発話の手前まで」。先頭が assistant で始まる断片は捨てる。
 */
export function lastTurns(entries: HistoryEntry[], maxTurns: number): HistoryEntry[] {
  let turns = 0
  let start = entries.length
  for (let i = entries.length - 1; i >= 0; i--) {
    start = i
    if (entries[i].role === 'user' && ++turns >= maxTurns) break
  }
  const slice = entries.slice(start)
  const firstUser = slice.findIndex((e) => e.role === 'user')
  return firstUser === -1 ? [] : slice.slice(firstUser)
}

export interface ExportNames {
  character: string
  user: string
  /** 記録ごとのキャラ名(キャラごとに分けて保存しているため)。無ければ character を使う */
  characterOf?: (characterId: string | undefined) => string
}

export function toExportJson(entries: HistoryEntry[], characterOf?: (characterId: string | undefined) => string): string {
  return JSON.stringify(
    entries.map((e) => ({
      time: new Date(e.ts).toISOString(),
      role: e.role,
      ...(characterOf ? { character: characterOf(e.characterId) } : {}),
      text: e.text
    })),
    null,
    2
  )
}

const formatTime = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 人が読めるテキスト。日付が変わるところに見出しを入れる */
export function toExportText(entries: HistoryEntry[], names: ExportNames): string {
  const lines: string[] = []
  let day = ''
  for (const e of entries) {
    const d = formatTime(e.ts).slice(0, 10)
    if (d !== day) {
      if (day) lines.push('')
      lines.push(`# ${d}`, '')
      day = d
    }
    const who = e.role === 'user' ? names.user : (names.characterOf?.(e.characterId) ?? names.character)
    lines.push(`[${formatTime(e.ts).slice(11)}] ${who}: ${e.text.replace(/\r?\n/g, '\n    ')}`)
  }
  return lines.join('\n') + (lines.length > 0 ? '\n' : '')
}

export interface HistorySummary {
  /** 保存されているメッセージ数 */
  messages: number
  /** 最初・最後の発話時刻(なければ null) */
  firstTs: number | null
  lastTs: number | null
  /** ディスク上の合計サイズ(バイト) */
  bytes: number
}

/** 1 件を指す印(削除の指定に使う)。同じ時刻・役割・キャラの記録は、同じ印になる */
export function entryKey(e: Pick<HistoryEntry, 'ts' | 'role' | 'characterId'>): string {
  return `${e.ts}|${e.role}|${e.characterId ?? ''}`
}

export interface HistoryFilter {
  /** このキャラとの会話だけ(省略ならすべて) */
  characterId?: string
  /** 本文にこの言葉を含むものだけ(空白区切りで、すべて含む。大文字小文字は区別しない) */
  query?: string
}

/** 条件に合う記録だけ(元の順を保つ) */
export function filterEntries(entries: readonly HistoryEntry[], f: HistoryFilter): HistoryEntry[] {
  const words = (f.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((e) => (f.characterId === undefined || belongsTo(e, f.characterId)) && words.every((w) => e.text.toLowerCase().includes(w)))
}

/** 新しい順に並べて、offset 件目から limit 件を取り出す。total は、条件に合った全件数 */
export function pageNewestFirst(entries: readonly HistoryEntry[], offset: number, limit: number): { items: HistoryEntry[]; total: number } {
  const sorted = [...entries].sort((a, b) => b.ts - a.ts)
  const o = Math.max(0, Math.floor(offset))
  return { items: sorted.slice(o, o + Math.max(0, Math.floor(limit))), total: sorted.length }
}

/** 新しいほうから n 件(条件に合うものの中で)の印 */
export function newestKeys(entries: readonly HistoryEntry[], n: number, f: HistoryFilter = {}): string[] {
  return pageNewestFirst(filterEntries(entries, f), 0, n).items.map(entryKey)
}
