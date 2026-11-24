/**
 * 足の接地補正(足ロック)の計算。Three.js に依存しない純粋な関数。
 *
 * MMD 由来のダンスは足を IK で床に固定して作られるが、VRMA に変換すると脚の回転(FK)に焼き込まれ、
 * 元モデルと脚の長さ・腰幅が違うと足先が床の上を滑る。そこで、床に着いている足(軸足)の水平位置が
 * 前のフレームから動いた分を打ち消すよう、キャラ全体をずらす。ずれが溜まって画面外へ漂わないよう、
 * ずらし量はゆっくり0へ戻し、上限(maxOffset)も設ける。
 *
 * 座標はモデル(scene)のローカル座標。x, z が水平、y が高さ(単位はメートル)。
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface FootLockParams {
  /** 軸足とみなす高さ(接地時の足首の高さからの余裕。メートル) */
  plantTolerance: number
  /** ずらし量が元へ戻る時定数(秒)。短いほど早く戻るが、足は滑って見える */
  recoverSec: number
  /** ずらし量の上限(メートル) */
  maxOffset: number
  /** 1フレームの足の移動がこれを超えたら、ループの巻き戻りなどの飛びとみなして補正しない(メートル) */
  maxStep: number
}

export const DEFAULT_FOOT_LOCK: FootLockParams = {
  plantTolerance: 0.04,
  recoverSec: 2,
  maxOffset: 0.6,
  maxStep: 0.25
}

export interface FootLockState {
  /** 打ち消すためにモデルをずらしている量(ローカル座標の水平) */
  offsetX: number
  offsetZ: number
  /** 前のフレームの足首の位置。まだ無ければ null */
  prevLeft: Vec3 | null
  prevRight: Vec3 | null
}

export function createFootLockState(): FootLockState {
  return { offsetX: 0, offsetZ: 0, prevLeft: null, prevRight: null }
}

/**
 * 1フレーム進める。state を更新して返す(同じオブジェクト)。
 * restAnkleY は、立ち姿(接地)のときの足首の高さ。これより plantTolerance 以内の足を「床に着いている」とみなす。
 * 両足とも着いているときは、より低い方を軸にする。
 */
export function stepFootLock(
  state: FootLockState,
  left: Vec3,
  right: Vec3,
  restAnkleY: number,
  dt: number,
  params: FootLockParams = DEFAULT_FOOT_LOCK
): FootLockState {
  const limit = restAnkleY + params.plantTolerance
  const leftDown = left.y <= limit
  const rightDown = right.y <= limit
  let side: 'left' | 'right' | null = null
  if (leftDown && rightDown) side = left.y <= right.y ? 'left' : 'right'
  else if (leftDown) side = 'left'
  else if (rightDown) side = 'right'

  if (side) {
    const cur = side === 'left' ? left : right
    const prev = side === 'left' ? state.prevLeft : state.prevRight
    if (prev) {
      const dx = cur.x - prev.x
      const dz = cur.z - prev.z
      if (Math.hypot(dx, dz) <= params.maxStep) {
        state.offsetX -= dx
        state.offsetZ -= dz
      }
    }
  }

  // 元の位置へゆっくり戻す
  const k = params.recoverSec > 0 ? Math.exp(-Math.max(0, dt) / params.recoverSec) : 0
  state.offsetX *= k
  state.offsetZ *= k

  // 上限(円形)に収める
  const len = Math.hypot(state.offsetX, state.offsetZ)
  if (len > params.maxOffset) {
    const s = params.maxOffset / len
    state.offsetX *= s
    state.offsetZ *= s
  }

  state.prevLeft = { ...left }
  state.prevRight = { ...right }
  return state
}

/** モーションの切り替え・モデルの読み込み直後などに、ずらし量と前フレームの記憶を捨てる */
export function resetFootLock(state: FootLockState): void {
  state.offsetX = 0
  state.offsetZ = 0
  state.prevLeft = null
  state.prevRight = null
}
