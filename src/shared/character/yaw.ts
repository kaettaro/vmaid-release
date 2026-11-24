// キャラの向き(左右 yaw と、上下 pitch。度)。Electron/Three.js 非依存の純粋ロジック。
// yaw: 0 = 正面、正 = 画面の右を向く(-180〜180)。pitch: 0 = まっすぐ、正 = 頭が手前(見る人のほう)に倒れる(-75〜75)。

/** ドラッグ1pxあたりの回転量(度) */
export const DEG_PER_PX = 0.6
/** 吸着する刻み(度)と、吸着する範囲(刻みの前後この角度以内) */
export const SNAP_STEP = 45
export const SNAP_RANGE = 6
/** 追従の速さ(大きいほど速い。1/秒) */
const FOLLOW_RATE = 14

/** 角度を -180〜180 に丸める */
export function wrapDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  const m = ((((deg + 180) % 360) + 360) % 360) - 180
  // 180 ちょうどは -180 ではなく 180 として扱う
  return m === -180 && deg > 0 ? 180 : m
}

/** from から to へ、最短で回るときの回転量(-180〜180) */
export function shortestDelta(from: number, to: number): number {
  const d = wrapDeg(to - from)
  return d === -180 ? 180 : d
}

/** 現在の角度を、目標へ向けて dt 秒ぶん進める(指数的な平滑化。dt が大きくても行き過ぎない) */
export function stepYaw(current: number, target: number, dt: number): number {
  const delta = shortestDelta(current, target)
  if (Math.abs(delta) < 0.05) return wrapDeg(target)
  const k = 1 - Math.exp(-FOLLOW_RATE * Math.max(0, dt))
  return wrapDeg(current + delta * k)
}

/** ドラッグ開始時の角度と、横方向の移動量(px。右が正)から、新しい角度を求める */
export function dragToYaw(startYaw: number, dxPx: number): number {
  return wrapDeg(startYaw + dxPx * DEG_PER_PX)
}

/** 45°刻みの近く(±6°)なら、その刻みに吸着する */
export function snapYaw(deg: number): number {
  const w = wrapDeg(deg)
  const nearest = Math.round(w / SNAP_STEP) * SNAP_STEP
  return Math.abs(w - nearest) <= SNAP_RANGE ? wrapDeg(nearest) : w
}

/** 上下の傾きの上限(度)。これ以上は倒さない(真上・真下からだと、キャラが寝てしまう) */
export const PITCH_LIMIT = 75

export interface Orientation {
  yaw: number
  pitch: number
}

export const clampPitch = (deg: number): number => (Number.isFinite(deg) ? Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, deg)) : 0)

/** ドラッグ開始時の傾きと、縦方向の移動量(px。下が正。下へドラッグ=頭が手前に倒れる)から、新しい傾きを求める */
export function dragToPitch(startPitch: number, dyPx: number): number {
  return clampPitch(startPitch + dyPx * DEG_PER_PX)
}

/** 傾きを、45°刻みの近く(±6°)なら吸着させる(0 に戻しやすい) */
export function snapPitch(deg: number): number {
  const p = clampPitch(deg)
  const nearest = Math.round(p / SNAP_STEP) * SNAP_STEP
  return Math.abs(p - nearest) <= SNAP_RANGE ? clampPitch(nearest) : p
}

/** 傾きを、目標へ向けて dt 秒ぶん進める(なめらかな追従) */
export function stepPitch(current: number, target: number, dt: number): number {
  if (Math.abs(target - current) < 0.05) return target
  return current + (target - current) * (1 - Math.exp(-FOLLOW_RATE * Math.max(0, dt)))
}
