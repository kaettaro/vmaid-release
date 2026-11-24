// 床より下に入ったモデルを、持ち上げる量の計算。Three.js に依存しない純粋な関数。
//
// モーション(特に BVH の取り込み)は、元の骨格の体の比率で作られているので、別のモデルに当てると、
// 横になる・座る・膝をつくポーズで、手足や頭が床の下に入ることがある(窓の下にはみ出して見切れる)。
// 関節(ボーンの位置)が「床の高さ(floorJointY)」を下回ったぶんだけ、モデル全体を持ち上げる。
// 床の上にあるときは何もしない(立ち姿・ダンスなど。足首の高さが約 7cm あるので、床の高さ 4cm なら触らない)。

export interface GroundLiftParams {
  /** 関節の位置が、これより下に入らないようにする(メートル。床からの高さ)。ボーンは関節の中心なので、少し上を床とする */
  floorJointY: number
  /** 持ち上げる量が増えるときの時定数(秒)。短い = すぐ持ち上げる(めり込みが見えない) */
  riseSec: number
  /** 持ち上げる量が減るときの時定数(秒)。長い = ゆっくり下ろす(ちらつかない) */
  fallSec: number
  /** 持ち上げる量の上限(メートル)。異常なポーズで、モデルが飛んでいかないように */
  maxLift: number
}

export const DEFAULT_GROUND_LIFT: GroundLiftParams = {
  floorJointY: 0.04,
  riseSec: 0.05,
  fallSec: 0.3,
  maxLift: 0.8
}

/**
 * 1フレーム進めた「持ち上げる量」を返す。
 * minJointY は、いまの持ち上げを除いた(持ち上げる前の)最低の関節の高さ。
 */
export function stepGroundLift(current: number, minJointY: number, dt: number, p: GroundLiftParams = DEFAULT_GROUND_LIFT): number {
  const target = Number.isFinite(minJointY) ? Math.min(p.maxLift, Math.max(0, p.floorJointY - minJointY)) : 0
  const tau = target > current ? p.riseSec : p.fallSec
  const k = tau > 0 ? 1 - Math.exp(-Math.max(0, dt) / tau) : 1
  const next = current + (target - current) * k
  return Math.abs(next) < 1e-5 ? 0 : next
}
