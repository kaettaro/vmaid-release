// 「話しかけ控え」: キャラのほうから話しかけてよいか、の判定。Electron / DOM に依存しない純粋ロジック。
// 話しかけるルール(定期・放置など)の条件「話しかけてよいとき」(canTalk)が使う。
// 控えるとき: 「静かにして」・会話中/ゲーム中/非表示・夜間の時間帯・直前の話しかけから最小の間隔・1 日の上限。

import { z } from 'zod'

const clamp = (n: number, lo: number, hi: number): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export const TalkSchema = z.object({
  /** 「静かにして」: ON の間は、自分からは、話しかけない(トレイのメニュー・設定から) */
  muted: z.boolean().catch(false),
  /** 話しかけの最小の間隔(分)。前に話しかけてから、これだけ空ける */
  minGapMin: z.number().catch(10).transform((n) => Math.round(clamp(n, 0, 1440))),
  /** 1 日に話しかける回数の上限。0 = 無制限 */
  dailyLimit: z.number().catch(20).transform((n) => Math.round(clamp(n, 0, 1000))),
  /** 夜間は話しかけない */
  quietEnabled: z.boolean().catch(true),
  quietFrom: z.string().regex(HHMM).catch('23:00'),
  quietTo: z.string().regex(HHMM).catch('07:00')
})
export type TalkSettings = z.infer<typeof TalkSchema>
export const DEFAULT_TALK: TalkSettings = TalkSchema.parse({})

export type TalkPatch = Partial<TalkSettings>

/** 設定画面・キャラ窓へ渡す形(Mod の ON/OFF つき) */
export type TalkView = TalkSettings & { enabled: boolean }

/** 話しかけの記録(1 日の回数と、最後の時刻) */
export interface TalkLog {
  /** 最後に話しかけた時刻(ミリ秒。無ければ null) */
  lastAt: number | null
  /** 回数を数えている日(`YYYY-MM-DD`。ローカル時刻) */
  day: string
  count: number
}

export const EMPTY_LOG: TalkLog = { lastAt: null, day: '', count: 0 }

/** 控える理由。ok のとき null */
export type TalkBlock = 'muted' | 'busy' | 'quiet' | 'gap' | 'limit'

const pad = (n: number): string => String(n).padStart(2, '0')
export const dayKey = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** 夜間(話しかけない時間帯)か。from > to なら、日をまたぐ(23:00〜07:00)。from = to なら、夜間なし */
export function inQuietHours(s: Pick<TalkSettings, 'quietEnabled' | 'quietFrom' | 'quietTo'>, now: number): boolean {
  if (!s.quietEnabled) return false
  const d = new Date(now)
  const cur = d.getHours() * 60 + d.getMinutes()
  const from = minutesOf(s.quietFrom)
  const to = minutesOf(s.quietTo)
  if (from === to) return false
  return from < to ? cur >= from && cur < to : cur >= from || cur < to
}

/** その日の回数(日が変わっていれば 0) */
export const countToday = (log: TalkLog, now: number): number => (log.day === dayKey(now) ? log.count : 0)

/** いま、話しかけてよいか。控えるなら、その理由 */
export function talkBlock(s: TalkSettings, log: TalkLog, now: number, busy: boolean): TalkBlock | null {
  if (s.muted) return 'muted'
  if (busy) return 'busy'
  if (inQuietHours(s, now)) return 'quiet'
  if (log.lastAt !== null && now - log.lastAt < s.minGapMin * 60_000) return 'gap'
  if (s.dailyLimit > 0 && countToday(log, now) >= s.dailyLimit) return 'limit'
  return null
}

/** 話しかけた記録を足す */
export function recordTalk(log: TalkLog, now: number): TalkLog {
  const day = dayKey(now)
  return { lastAt: now, day, count: (log.day === day ? log.count : 0) + 1 }
}

/** 保存してあった記録を、安全に読む(壊れていたら空) */
export function parseTalkLog(raw: unknown): TalkLog {
  if (typeof raw !== 'object' || raw === null) return EMPTY_LOG
  const o = raw as Record<string, unknown>
  const lastAt = typeof o.lastAt === 'number' && Number.isFinite(o.lastAt) ? o.lastAt : null
  const day = typeof o.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? o.day : ''
  const count = typeof o.count === 'number' && Number.isFinite(o.count) ? Math.max(0, Math.min(100_000, Math.round(o.count))) : 0
  return { lastAt, day, count }
}

export const TALK_BLOCK_LABEL: Record<TalkBlock, string> = {
  muted: '「静かにして」が ON',
  busy: '会話中・ゲーム中・非表示',
  quiet: '夜間',
  gap: '前の話しかけから間もない',
  limit: '今日の上限に達した'
}
