// モーションの再生の状態(再生ウィンドウの、進み具合のバー・時間の表示・シーク用)。Electron/Three.js 非依存。

export interface PlaybackInfo {
  /** 再生しているモーションの名前 */
  name: string
  /** 再生の位置(秒。クリップの先頭から) */
  time: number
  /** クリップの長さ(秒) */
  duration: number
  /** くり返し再生か(ルール・再生ウィンドウの「ループ」) */
  looping: boolean
  /** 一時停止中か */
  paused: boolean
}

/** 秒を、範囲 0〜duration に収める(NaN は 0) */
export function clampSeek(sec: number, duration: number): number {
  if (!Number.isFinite(sec) || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(duration, Math.max(0, sec))
}

/** 進み具合(0〜1) */
export function progressRatio(p: Pick<PlaybackInfo, 'time' | 'duration'>): number {
  if (!(p.duration > 0)) return 0
  return Math.min(1, Math.max(0, p.time / p.duration))
}

/** 「0:01.2」の形(分:秒.小数 1 桁) */
export function formatSec(sec: number): string {
  const t = Number.isFinite(sec) ? Math.max(0, sec) : 0
  const tenths = Math.floor(t * 10 + 1e-9)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`
}

/** 「0:01.2 / 0:04.0」 */
export function formatPlayback(p: Pick<PlaybackInfo, 'time' | 'duration'>): string {
  return `${formatSec(p.time)} / ${formatSec(p.duration)}`
}

/** 受け取った値が、再生の状態の形か(IPC の入力の検証。不正なら null) */
export function parsePlayback(raw: unknown): PlaybackInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.name !== 'string' || r.name.length > 200) return null
  if (typeof r.time !== 'number' || typeof r.duration !== 'number' || !Number.isFinite(r.time) || !Number.isFinite(r.duration)) return null
  return { name: r.name, time: Math.max(0, r.time), duration: Math.max(0, r.duration), looping: r.looping === true, paused: r.paused === true }
}
