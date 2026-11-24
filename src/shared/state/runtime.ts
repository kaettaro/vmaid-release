// 状態(自由な名前のモード)と感情値の純粋ロジック(M13)。Electron/DOM に依存しない。
// - 状態: 「開始 → 終了(または、指定秒数で自動終了)」の名前つきのモード。実行中だけ(再起動で消える)。どの Mod のルールが始めたか(source)を持つ。
// - 感情値: 名前つきの数値(0〜100)。キャラごとに保存し、時間でゆっくり 0 に向かって減る。
import { z } from 'zod'

/** 状態・感情の名前: 1〜24文字で、制御文字・カンマ・改行を含まない */
export function normalizeStateName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  // eslint-disable-next-line no-control-regex
  if (name === '' || [...name].length > 24 || /[\u0000-\u001f\u007f,]/.test(name)) return null
  return name
}

// ------------------------------------------------------------ 状態(モード)
export interface ModeEntry {
  /** 終了する時刻(エポックms)。null なら、終了のアクションまで続く */
  until: number | null
  /** 始めたルールの Mod の id。自分のルールなら null。Mod を OFF にしたときに、その Mod の状態を終わらせるのに使う */
  source: string | null
}
export type Modes = Map<string, ModeEntry>

export function startMode(modes: Modes, name: string, durationSec: number, source: string | null, now: number): void {
  const n = normalizeStateName(name)
  if (n === null || (modes.size >= 50 && !modes.has(n))) return
  modes.set(n, { until: durationSec > 0 ? now + durationSec * 1000 : null, source })
}

export function endMode(modes: Modes, name: string): void {
  modes.delete(name)
}

/** 期限が切れたものを外して、いま続いている状態の名前を返す */
export function activeModes(modes: Modes, now: number): Set<string> {
  for (const [name, e] of modes) if (e.until !== null && now >= e.until) modes.delete(name)
  return new Set(modes.keys())
}

/** keep に含まれない Mod が始めた状態を、すべて終わらせる(自分のルールの状態は、残す)。終わらせた名前を返す */
export function releaseModes(modes: Modes, keep: ReadonlySet<string>): string[] {
  const ended: string[] = []
  for (const [name, e] of modes) {
    if (e.source !== null && !keep.has(e.source)) {
      modes.delete(name)
      ended.push(name)
    }
  }
  return ended
}

// ------------------------------------------------------------ 感情値
export const EMOTION_MAX = 100
/** 感情値が、時間で減る速さ(1分あたり)。0 に向かって、直線的に */
export const EMOTION_DECAY_PER_MIN = 1
const MAX_EMOTIONS = 30

const EmotionSchema = z.object({ value: z.number(), at: z.number() })

/** 保存データの読み込み: 壊れた1件が、ほかを道連れにしないよう、1件ずつ検証して、壊れたものだけを捨てる */
export const EmotionsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((r) => {
    const out: Record<string, { value: number; at: number }> = {}
    for (const [name, v] of Object.entries(r)) {
      const p = EmotionSchema.safeParse(v)
      if (p.success && normalizeStateName(name) !== null) out[name] = p.data
    }
    return out
  })

export type Emotions = Record<string, { value: number; at: number }>

const clamp = (v: number): number => (Number.isFinite(v) ? Math.min(EMOTION_MAX, Math.max(0, v)) : 0)

/** いまの感情値(時間の減衰を反映) */
export function emotionValue(emotions: Emotions, name: string, now: number): number {
  const e = emotions[name]
  if (!e) return 0
  const minutes = Math.max(0, (now - e.at) / 60_000)
  return clamp(e.value - minutes * EMOTION_DECAY_PER_MIN)
}

/** 感情値を決める。0 になったものは、持たない */
export function setEmotion(emotions: Emotions, name: string, value: number, now: number): Emotions {
  const n = normalizeStateName(name)
  if (n === null) return emotions
  const v = clamp(value)
  const next = { ...emotions }
  if (v <= 0) delete next[n]
  else if (n in next || Object.keys(next).length < MAX_EMOTIONS) next[n] = { value: v, at: now }
  return next
}

export function changeEmotion(emotions: Emotions, name: string, delta: number, now: number): Emotions {
  const n = normalizeStateName(name)
  return n === null ? emotions : setEmotion(emotions, n, emotionValue(emotions, n, now) + delta, now)
}

/** 減りきったものを、取り除く(保存するデータを増やさない) */
export function pruneEmotions(emotions: Emotions, now: number): Emotions {
  const next: Emotions = {}
  for (const name of Object.keys(emotions)) if (emotionValue(emotions, name, now) > 0) next[name] = emotions[name]
  return next
}
