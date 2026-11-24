// 機能 Mod「追いかけ」の設定と、純粋なロジック(Electron・three に依存しない)。
// キャラが、画面上のカーソルの方を向く。視線(目)・頭と首・体ごと、の3つを、それぞれ ON/OFF できる。
// カーソルの位置は、main が OS から読む(ローカルの座標だけ。通信しない)。ここでは、角度の計算とやわらかい追従だけを行う。

import { z } from 'zod'

export const CHASE_ID = 'chase'

const clamp = (n: number, lo: number, hi: number): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)
const num = (lo: number, hi: number, def: number) => z.number().catch(def).transform((n) => clamp(n, lo, hi))

export const ChaseSchema = z.object({
  /** 視線(目だけ。目のボーンか、視線の表情があるモデルのみ) */
  gaze: z.boolean().catch(true),
  /** 頭と首 */
  head: z.boolean().catch(true),
  /** 体ごと(キャラ全体の向き。保存してある向きとは別に、一時的に足す) */
  body: z.boolean().catch(false),
  /** 追う強さ(1 でカーソルの真正面まで、0.5 で半分) */
  strength: num(0, 1, 0.8),
  /** 追いつく速さ(大きいほど、すばやい) */
  speed: num(1, 10, 5),
  /** 頭の最大の角度(度) */
  headMaxDeg: num(5, 80, 35),
  /** 体の最大の角度(度) */
  bodyMaxDeg: num(5, 60, 25),
  /** カーソルがこの距離(画面上のピクセル)より遠いと、反応しない。0 なら、どこまででも追う */
  reactDistance: num(0, 4000, 0),
  /** 目 → 頭 → 体の順に、少しずつ遅れてついてくる */
  cascade: z.boolean().catch(true)
})

export type ChaseSettings = z.infer<typeof ChaseSchema>

/** 設定のうち、変えた項目だけ(保存の更新用) */
export const ChasePatchSchema = ChaseSchema.partial()
export type ChasePatch = z.infer<typeof ChasePatchSchema>

export interface ChaseView extends ChaseSettings {
  /** Mod が ON か */
  enabled: boolean
}

/** 向き(度)。yaw: 正が画面の右、pitch: 正が上 */
export interface Aim {
  yaw: number
  pitch: number
}

export interface ChaseState {
  gaze: Aim
  head: Aim
  body: Aim
}

export const ZERO_AIM: Aim = { yaw: 0, pitch: 0 }
export const ZERO_STATE: ChaseState = { gaze: ZERO_AIM, head: ZERO_AIM, body: ZERO_AIM }

/** 画面上の距離を角度にするときの、奥行き(ピクセル)。小さいほど、近づいたときに大きく振り向く */
export const DEPTH_PX = 450
/** 目の最大の角度(度) */
export const GAZE_MAX_DEG = 30
/** 体が受け持つ、全体の向きの割合(残りを頭・目が受け持つ) */
const BODY_SHARE = 0.5

const RAD2DEG = 180 / Math.PI

/** 頭の位置から見た、カーソルの向き。座標は、同じ座標系の画面上のピクセル(y は下が大きい) */
export function aimAt(cursor: { x: number; y: number }, head: { x: number; y: number }, depthPx: number = DEPTH_PX): Aim {
  const dx = cursor.x - head.x
  const dy = head.y - cursor.y // 上が正
  return { yaw: Math.atan2(dx, depthPx) * RAD2DEG, pitch: Math.atan2(dy, depthPx) * RAD2DEG }
}

/** 頭からカーソルまでの距離(ピクセル) */
export function cursorDistance(cursor: { x: number; y: number }, head: { x: number; y: number }): number {
  return Math.hypot(cursor.x - head.x, cursor.y - head.y)
}

const clampAxis = (v: number, max: number): number => Math.min(max, Math.max(-max, v))

/** 全体の向きを、体・頭・目に割り振った、それぞれの目標の角度。OFF の部分は 0 */
export function chaseTargets(aim: Aim, s: ChaseSettings): ChaseState {
  const a: Aim = { yaw: aim.yaw * s.strength, pitch: aim.pitch * s.strength }
  // 体: 左右だけ(上下に傾けると、倒れ込んで見える)
  const body: Aim = s.body ? { yaw: clampAxis(a.yaw * BODY_SHARE, s.bodyMaxDeg), pitch: 0 } : ZERO_AIM
  const rest1: Aim = { yaw: a.yaw - body.yaw, pitch: a.pitch }
  // 頭: 上下は、左右の 6 割まで(上を向きすぎない)
  const head: Aim = s.head ? { yaw: clampAxis(rest1.yaw, s.headMaxDeg), pitch: clampAxis(rest1.pitch, s.headMaxDeg * 0.6) } : ZERO_AIM
  const rest2: Aim = { yaw: rest1.yaw - head.yaw, pitch: rest1.pitch - head.pitch }
  // 目: 頭が受け持ちきれなかった分(頭が OFF なら、全部)
  const gaze: Aim = s.gaze ? { yaw: clampAxis(rest2.yaw, GAZE_MAX_DEG), pitch: clampAxis(rest2.pitch, GAZE_MAX_DEG * 0.7) } : ZERO_AIM
  return { gaze, head, body }
}

const smooth = (cur: number, target: number, rate: number, dt: number): number => cur + (target - cur) * (1 - Math.exp(-rate * dt))

/** 1フレーム分、現在の角度を目標へ近づける。cascade なら、目 → 頭 → 体の順に、遅れてついてくる */
export function chaseStep(cur: ChaseState, target: ChaseState, s: ChaseSettings, dt: number): ChaseState {
  const base = s.speed * 1.2
  const rates = s.cascade ? { gaze: base * 1.8, head: base, body: base * 0.5 } : { gaze: base, head: base, body: base }
  const step = (c: Aim, t: Aim, rate: number): Aim => ({ yaw: smooth(c.yaw, t.yaw, rate, dt), pitch: smooth(c.pitch, t.pitch, rate, dt) })
  return { gaze: step(cur.gaze, target.gaze, rates.gaze), head: step(cur.head, target.head, rates.head), body: step(cur.body, target.body, rates.body) }
}

/**
 * ステージが、毎フレーム使う追従の本体。設定とカーソルを受け取り、いまの角度を返す。
 * cursor が null(まだ届いていない)・反応距離の外のときは、正面へ戻る。
 */
export class ChaseDriver {
  private settings: ChaseSettings | null = null
  private state: ChaseState = ZERO_STATE

  /** null で OFF(すぐ正面へ戻る = 次の update が ZERO_STATE を返す) */
  setSettings(s: ChaseSettings | null): void {
    this.settings = s
    if (!s) this.state = ZERO_STATE
  }

  get active(): boolean {
    return this.settings !== null
  }

  get current(): ChaseState {
    return this.state
  }

  update(dt: number, cursor: { x: number; y: number } | null, head: { x: number; y: number } | null): ChaseState {
    const s = this.settings
    if (!s) return ZERO_STATE
    let target = ZERO_STATE
    if (cursor && head) {
      const far = s.reactDistance > 0 && cursorDistance(cursor, head) > s.reactDistance
      if (!far) target = chaseTargets(aimAt(cursor, head), s)
    }
    this.state = chaseStep(this.state, target, s, dt)
    return this.state
  }
}
