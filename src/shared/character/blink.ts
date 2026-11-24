// 自動まばたき。モーションとは独立に「blink 表情の値」だけを返す。
// 乱数は注入可能にして、テストで決定的に動かせるようにする。

export interface BlinkOptions {
  minInterval: number
  maxInterval: number
  closeSec: number
  holdSec: number
  openSec: number
}

export const defaultBlinkOptions: BlinkOptions = {
  minInterval: 2,
  maxInterval: 6,
  closeSec: 0.06,
  holdSec: 0.04,
  openSec: 0.12
}

export class BlinkController {
  private untilNext: number
  /** 瞬き開始からの経過秒。瞬きしていない間は null */
  private elapsed: number | null = null

  constructor(
    private readonly rng: () => number = Math.random,
    private readonly opt: BlinkOptions = defaultBlinkOptions
  ) {
    this.untilNext = this.nextInterval()
  }

  private nextInterval(): number {
    return this.opt.minInterval + this.rng() * (this.opt.maxInterval - this.opt.minInterval)
  }

  /** dt 秒進めて、blink 表情の値(0=開 〜 1=閉)を返す */
  update(dt: number): number {
    const { closeSec, holdSec, openSec } = this.opt
    if (this.elapsed === null) {
      this.untilNext -= dt
      if (this.untilNext > 0) return 0
      // 待機が終わったら、超過分を引き継いで瞬き開始
      this.elapsed = -this.untilNext
    } else {
      this.elapsed += dt
    }
    const t = this.elapsed
    if (t < closeSec) return t / closeSec
    if (t < closeSec + holdSec) return 1
    if (t < closeSec + holdSec + openSec) return 1 - (t - closeSec - holdSec) / openSec
    this.elapsed = null
    this.untilNext = this.nextInterval()
    return 0
  }
}
