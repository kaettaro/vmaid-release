import { z } from 'zod'
import { EmotionsSchema, pruneEmotions } from '../state/runtime'

// キャラの気分・親密度(ふれあいの積み重ね)。Electron 非依存の純粋ロジック。
// キャラごとに保存され、ルールの条件(affection / mood)とアクション(changeAffection / setMood)から使う。

/** 気分の種類。ルールの mood / setMood の選択肢(定義データ) */
export const MOODS: Array<{ value: string; label: string }> = [
  { value: 'normal', label: 'ふつう' },
  { value: 'happy', label: 'うれしい' },
  { value: 'shy', label: '照れている' },
  { value: 'annoyed', label: 'ふくれている' },
  { value: 'sleepy', label: 'ねむい' },
  { value: 'sad', label: 'さみしい' }
]
const MOOD_VALUES = MOODS.map((m) => m.value)

export const AFFECTION_MIN = 0
export const AFFECTION_MAX = 100
export const DEFAULT_AFFECTION = 30

/** 触れ合いがないとき: この時間(時間)は減らない。そのあと、1時間あたりこの分だけゆっくり減る */
export const DECAY_GRACE_HOURS = 6
export const DECAY_PER_HOUR = 0.5
/** これ以下には、時間の経過だけでは減らない(最初のなじみ具合は、放置では消えない) */
export const DECAY_FLOOR = 10

export const CharStateSchema = z.object({
  affection: z.number().catch(DEFAULT_AFFECTION),
  mood: z.string().catch('normal'),
  /** 気分が自動で元(ふつう)に戻る時刻(エポックms)。null なら戻さない */
  moodUntil: z.number().nullable().catch(null),
  /** 親密度を最後に更新した時刻(減衰の基準) */
  updatedAt: z.number().catch(0),
  /** 名前つきの感情値(Mod「状態と感情」。時間で減る) */
  emotions: EmotionsSchema
})

export type CharState = z.infer<typeof CharStateSchema>

export const clampAffection = (v: number): number => (Number.isFinite(v) ? Math.min(AFFECTION_MAX, Math.max(AFFECTION_MIN, v)) : DEFAULT_AFFECTION)

export function defaultCharState(now: number): CharState {
  return { affection: DEFAULT_AFFECTION, mood: 'normal', moodUntil: null, updatedAt: now, emotions: {} }
}

/** 保存データを読む。壊れていれば既定。範囲外は丸め、知らない気分は「ふつう」 */
export function parseCharState(raw: unknown, now: number): CharState {
  const r = CharStateSchema.safeParse(typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {})
  const s = r.success ? r.data : defaultCharState(now)
  return {
    affection: clampAffection(s.affection),
    mood: MOOD_VALUES.includes(s.mood) ? s.mood : 'normal',
    moodUntil: s.moodUntil !== null && Number.isFinite(s.moodUntil) ? s.moodUntil : null,
    updatedAt: s.updatedAt > 0 ? s.updatedAt : now,
    emotions: pruneEmotions(s.emotions, now)
  }
}

/** 時間の経過を反映する: 気分の期限切れと、親密度のゆっくりした減少 */
export function tickCharState(s: CharState, now: number): CharState {
  let { affection, mood, moodUntil, updatedAt } = s
  if (moodUntil !== null && now >= moodUntil) {
    mood = 'normal'
    moodUntil = null
  }
  const hours = (now - updatedAt) / 3_600_000
  if (hours > DECAY_GRACE_HOURS && affection > DECAY_FLOOR) {
    affection = Math.max(DECAY_FLOOR, affection - (hours - DECAY_GRACE_HOURS) * DECAY_PER_HOUR)
    updatedAt = now - DECAY_GRACE_HOURS * 3_600_000 // 減らした分は、もう一度数えない(猶予の位置へ進める)
  }
  return { ...s, affection, mood, moodUntil, updatedAt }
}

/** 親密度を増減する(0〜100に収める)。触れ合いがあったので、減衰の基準時刻も更新する */
export function changeAffection(s: CharState, delta: number, now: number): CharState {
  return { ...s, affection: clampAffection(s.affection + delta), updatedAt: now }
}

/** 気分を変える。durationSec が 0 なら、次に変えるまで続く。それ以外は、その秒数のあと「ふつう」に戻る */
export function setMood(s: CharState, mood: string, durationSec: number, now: number): CharState {
  const m = MOOD_VALUES.includes(mood) ? mood : 'normal'
  return { ...s, mood: m, moodUntil: m !== 'normal' && durationSec > 0 ? now + durationSec * 1000 : null }
}
