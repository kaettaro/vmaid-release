// 触れ合いの動作(長押し・なでる)の認識。Electron/DOM に依存しない純粋なクラス。時刻は呼び出し側が渡す(テストで決定的に動かす)。
//
// - 長押し(hold): ボタンを押して、ほとんど動かさずに HOLD_START_MS 以上続けたとき。続いている間、HOLD_EMIT_MS おきに通知する。
//   動かした(ドラッグ=移動・Shift+ドラッグ=回転)ら、長押しではなくなる。
// - なでる(stroke): ボタンを押さずに、同じ部位の上でポインタを往復させたとき。往復の回数・移動距離・速さで判定する。
//   なでている間、STROKE_EMIT_MS おきに通知し、止めてしばらく経つ(または部位が変わる・体から外れる)と、なで終わり(strokeEnd)を通知する。

export interface GestureSample {
  /** 時刻(ms) */
  t: number
  x: number
  y: number
  /** その位置の部位(体の外なら null) */
  part: string | null
  side: string | null
}

export type GestureEvent = {
  type: 'hold' | 'stroke' | 'strokeEnd'
  part: string
  side: string
  /** 続けた秒数 */
  sec: number
  /** 1回の長押し/なでの通し番号 */
  session: number
}

export const HOLD_START_MS = 600
export const HOLD_EMIT_MS = 500
/** 押したまま、この距離(px)より動かしたら、長押しではない(ドラッグ) */
export const HOLD_MOVE_PX = 10

/** なでる判定: この時間の窓(ms)のなかで、往復(向きの反転)が STROKE_MIN_REVERSALS 回以上、移動距離が STROKE_MIN_PATH 以上 */
export const STROKE_WINDOW_MS = 1200
export const STROKE_MIN_REVERSALS = 2
export const STROKE_MIN_PATH = 70
/** 往復と数える最小の振れ幅(px)。細かい手ぶれは数えない */
export const STROKE_MIN_SWING = 10
/** 速さの範囲(px/秒)。遅すぎる(ただ置いている)・速すぎる(通り過ぎた)ものは、なでるではない */
export const STROKE_MIN_SPEED = 40
export const STROKE_MAX_SPEED = 3000
export const STROKE_SPEED_WINDOW_MS = 500
export const STROKE_EMIT_MS = 400
/** なでる動きが途切れてから、なで終わりとみなすまでの時間(ms) */
export const STROKE_END_GRACE_MS = 800

interface Point {
  t: number
  x: number
  y: number
}

export class GestureRecognizer {
  private session = 0

  // --- なでる ---
  private points: Point[] = []
  private runPart: string | null = null
  private runSide: string = 'center'
  private stroke: { session: number; start: number; lastActive: number; lastEmit: number } | null = null

  // --- 長押し ---
  private hold: { session: number; start: number; x: number; y: number; part: string; side: string; lastEmit: number; started: boolean } | null = null

  /** ポインタが動いた(ボタンを押していないとき)。なでる判定に使う。出たイベントを返す */
  hover(s: GestureSample): GestureEvent[] {
    const out: GestureEvent[] = []
    if (s.part === null) {
      this.endStroke(s.t, out)
      this.reset()
      return out
    }
    if (this.runPart !== s.part || this.runSide !== (s.side ?? 'center')) {
      // 部位が変わったら、そこから数え直す(前の部位のなでは、ここで終わり)
      this.endStroke(s.t, out)
      this.reset()
      this.runPart = s.part
      this.runSide = s.side ?? 'center'
    }
    this.points.push({ t: s.t, x: s.x, y: s.y })
    this.points = this.points.filter((p) => s.t - p.t <= STROKE_WINDOW_MS)
    if (this.looksLikeStroke()) {
      if (!this.stroke) {
        this.stroke = { session: ++this.session, start: s.t, lastActive: s.t, lastEmit: s.t - STROKE_EMIT_MS }
      }
      this.stroke.lastActive = s.t
      this.emitStroke(s.t, out)
    }
    return out
  }

  /** ボタンが押された。長押しの判定を始める(体の外なら、何もしない) */
  down(s: GestureSample): void {
    this.reset()
    this.hold = s.part === null ? null : { session: 0, start: s.t, x: s.x, y: s.y, part: s.part, side: s.side ?? 'center', lastEmit: 0, started: false }
  }

  /** 押したまま動いた。動かしすぎたら、長押しではなくなる */
  dragMove(s: GestureSample): void {
    if (this.hold && Math.hypot(s.x - this.hold.x, s.y - this.hold.y) > HOLD_MOVE_PX) this.hold = null
  }

  /** ボタンが離された。長押しが続いていたら、そこで終わり */
  up(): void {
    this.hold = null
  }

  /** 時間の経過(動きがないときの、長押しの継続通知・なで終わりの判定)。200ms おき程度で呼ぶ */
  tick(now: number): GestureEvent[] {
    const out: GestureEvent[] = []
    const h = this.hold
    if (h && now - h.start >= HOLD_START_MS && now - h.lastEmit >= HOLD_EMIT_MS) {
      if (!h.started) {
        h.started = true
        h.session = ++this.session
      }
      h.lastEmit = now
      out.push({ type: 'hold', part: h.part, side: h.side, sec: (now - h.start) / 1000, session: h.session })
    }
    if (this.stroke && now - this.stroke.lastActive >= STROKE_END_GRACE_MS) {
      this.endStroke(now, out)
      this.points = []
    }
    return out
  }

  /** ポインタが窓から出た・ドラッグを始めたなどで、すべて打ち切る(なで終わりは通知する) */
  cancel(now: number): GestureEvent[] {
    const out: GestureEvent[] = []
    this.endStroke(now, out)
    this.reset()
    this.hold = null
    return out
  }

  // ---------------------------------------------------------------- 内部
  private reset(): void {
    this.points = []
    this.runPart = null
  }

  private emitStroke(now: number, out: GestureEvent[]): void {
    const st = this.stroke
    if (!st || now - st.lastEmit < STROKE_EMIT_MS || !this.runPart) return
    st.lastEmit = now
    out.push({ type: 'stroke', part: this.runPart, side: this.runSide, sec: (st.lastActive - st.start) / 1000, session: st.session })
  }

  private endStroke(now: number, out: GestureEvent[]): void {
    const st = this.stroke
    if (!st) return
    this.stroke = null
    const part = this.runPart
    if (part) out.push({ type: 'strokeEnd', part, side: this.runSide, sec: Math.max(0, (st.lastActive - st.start) / 1000), session: st.session })
    void now
  }

  /** 直近の窓の動きが、「なでる」(往復・移動距離・速さ)に見えるか */
  private looksLikeStroke(): boolean {
    const p = this.points
    if (p.length < 4) return false
    const span = (p[p.length - 1].t - p[0].t) / 1000
    if (span < 0.3) return false
    // 移動距離(窓の全体)と、速さ(直近 STROKE_SPEED_WINDOW_MS の動き。急に速く振っただけのものを、なでると誤認しない)
    const pathOf = (pts: Point[]): number => {
      let sum = 0
      for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
      return sum
    }
    const path = pathOf(p)
    const last = p[p.length - 1].t
    const recent = p.filter((q) => last - q.t <= STROKE_SPEED_WINDOW_MS)
    const recentSpan = recent.length >= 2 ? (recent[recent.length - 1].t - recent[0].t) / 1000 : 0
    if (path < STROKE_MIN_PATH) return false
    const speed = recentSpan > 0 ? pathOf(recent) / recentSpan : 0
    if (speed < STROKE_MIN_SPEED || speed > STROKE_MAX_SPEED) return false
    // 往復: 横(x)か縦(y)のどちらかで、一定以上の振れ幅の向きの反転を数える
    return Math.max(reversals(p.map((q) => q.x)), reversals(p.map((q) => q.y))) >= STROKE_MIN_REVERSALS
  }
}

/** 値の列で、振れ幅 STROKE_MIN_SWING 以上の向きの反転の回数(手ぶれは数えない) */
export function reversals(values: number[]): number {
  let count = 0
  let dir = 0 // +1 = 増加中 / -1 = 減少中
  let extreme = values[0]
  for (const v of values) {
    if (dir >= 0 && v > extreme) {
      extreme = v
      dir = 1
    } else if (dir <= 0 && v < extreme) {
      extreme = v
      dir = -1
    } else if (dir === 1 && extreme - v >= STROKE_MIN_SWING) {
      count++ // 増加 → 減少
      dir = -1
      extreme = v
    } else if (dir === -1 && v - extreme >= STROKE_MIN_SWING) {
      count++ // 減少 → 増加
      dir = 1
      extreme = v
    } else if (dir === 0) {
      extreme = v
    }
  }
  return count
}
