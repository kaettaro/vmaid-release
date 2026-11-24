import { qRotate, type Quat, type Vec3 } from '../motions/quat'

// hips の回転で股関節がずれないよう、hips の位置を補正する計算。Three.js に依存しない純粋な関数。
//
// 補正は「元の位置(アニメーションが書いた位置)」に対して計算し直す。毎フレーム、いまの位置に足し込んではいけない:
// Three.js の AnimationMixer は、値が変化しないトラック(腰が動かないモーション)の位置を、毎フレームは書き直さない。
// そのため足し込む方式だと、補正が累積して、腰が加速度的にずれていく(モデルが画面の外へ飛んでいく)。

export interface HipsPivotState {
  /** 最後に使った元の位置(補正前) */
  base: Vec3 | null
  /** 最後に書き込んだ位置(補正後) */
  written: Vec3 | null
}

export const createHipsPivotState = (): HipsPivotState => ({ base: null, written: null })

export function resetHipsPivot(state: HipsPivotState): void {
  state.base = null
  state.written = null
}

const same = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/**
 * いまの hips の位置 position に対して、補正後の位置を返す(state を更新する)。
 * - position が、前回こちらが書いた値のまま(アニメーションが書き直していない)なら、前回の元の位置を使う
 * - 違う値なら(アニメーションが書き直した)、いまの値を元の位置とする
 * 補正後 = 元の位置 + pivot − R(q)·pivot(pivot = hips から股関節の中点への、基準姿勢での差)
 */
export function applyHipsPivot(state: HipsPivotState, position: Vec3, rotation: Quat, pivot: Vec3): Vec3 {
  const base: Vec3 = state.written && state.base && same(position, state.written) ? state.base : [position[0], position[1], position[2]]
  const rotated = qRotate(rotation, pivot)
  const written: Vec3 = [base[0] + pivot[0] - rotated[0], base[1] + pivot[1] - rotated[1], base[2] + pivot[2] - rotated[2]]
  state.base = base
  state.written = written
  return written
}

/**
 * 補正をやめるとき: いまの位置が、こちらが書いた値のままなら、元の位置を返す(戻す必要がある)。
 * アニメーションが書き直したあとなら null(何もしなくてよい)。state は捨てる
 */
export function restoreHipsPivot(state: HipsPivotState, position: Vec3): Vec3 | null {
  const out = state.written && state.base && same(position, state.written) ? state.base : null
  resetHipsPivot(state)
  return out
}
