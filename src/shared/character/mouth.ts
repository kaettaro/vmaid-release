// 喋り中の口パク。モーションとは独立に、口の表情(aa)の「自動値」だけを返す(乱数・時間は注入可能)。
// ユーザーが表情・衣装パネルで口を動かしていても、composeExpression の合成で壊れない。

export interface MouthOptions {
  /** 口を開く最大値(0〜1)。開けすぎると不自然 */
  maxOpen: number
  /** 開閉の目標値を切り替える間隔(秒)の範囲 */
  minHold: number
  maxHold: number
  /** 目標値への追従の速さ(大きいほど速い) */
  response: number
}

export const defaultMouthOptions: MouthOptions = { maxOpen: 0.7, minHold: 0.07, maxHold: 0.18, response: 18 }

export class MouthController {
  private value = 0
  private target = 0
  private untilSwitch = 0

  constructor(
    private readonly rng: () => number = Math.random,
    private readonly opt: MouthOptions = defaultMouthOptions
  ) {}

  /** dt 秒進めて、口の開き(0〜maxOpen)を返す。喋っていなければ閉じていく */
  update(dt: number, speaking: boolean): number {
    if (speaking) {
      this.untilSwitch -= dt
      if (this.untilSwitch <= 0) {
        // たまに完全に閉じて、母音の切れ目を作る
        this.target = this.rng() < 0.2 ? 0 : (0.3 + 0.7 * this.rng()) * this.opt.maxOpen
        this.untilSwitch = this.opt.minHold + this.rng() * (this.opt.maxHold - this.opt.minHold)
      }
    } else {
      this.target = 0
      this.untilSwitch = 0
    }
    // 指数的に目標へ近づける(dt が大きくても発散しない)
    this.value += (this.target - this.value) * (1 - Math.exp(-this.opt.response * dt))
    return Math.min(this.opt.maxOpen, Math.max(0, this.value))
  }
}
