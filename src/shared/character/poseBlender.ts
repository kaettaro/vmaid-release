import * as THREE from 'three'

// モーションの切り替えを、なめらかにする(標準機能)。
// モーションを始める(または終わって待機に戻る)瞬間の「いまの姿勢」を覚えておき、次のフレームから、新しい姿勢へ、補間しながら移る。
// 骨の回転は球面補間、位置は直線補間。補間にかける時間は、姿勢の違いの大きさで決める(近ければ短く、遠ければ長く)。
// モーションの再生(mixer)が決めた姿勢の「あと」に、骨の値を上書きする。毎フレーム、mixer が値を書き直すので、積み重なることはない。

/** 補間にかける時間の最小・最大(秒)と、姿勢の違い(最大の角度。ラジアン)あたりの増え方 */
export const BLEND_MIN_SEC = 0.12
export const BLEND_MAX_SEC = 0.7
const SEC_PER_RAD = 0.4
/** これより違いが小さければ、補間しない(ラジアン。約 1 度) */
const SKIP_BELOW_RAD = 0.02

/** 姿勢の違いの大きさ(最大の角度。ラジアン)から、補間にかける時間(秒) */
export function blendDuration(maxAngleRad: number): number {
  if (!Number.isFinite(maxAngleRad) || maxAngleRad < SKIP_BELOW_RAD) return 0
  return Math.min(BLEND_MAX_SEC, Math.max(BLEND_MIN_SEC, BLEND_MIN_SEC + maxAngleRad * SEC_PER_RAD))
}

/** 0 → 1 をなめらかに(始まりと終わりがゆるやか) */
export function smoothstep(f: number): number {
  const x = Math.min(1, Math.max(0, f))
  return x * x * (3 - 2 * x)
}

interface Snap {
  node: THREE.Object3D
  q: THREE.Quaternion
  p: THREE.Vector3
}

export class PoseBlender {
  private snaps: Snap[] = []
  private elapsed = 0
  /** null = まだ決めていない(最初の apply で、新しい姿勢との違いから決める) */
  private duration: number | null = null
  private readonly tmpQ = new THREE.Quaternion()
  private readonly tmpP = new THREE.Vector3()

  get active(): boolean {
    return this.snaps.length > 0
  }

  /**
   * いまの姿勢を覚えて、次の apply から、新しい姿勢へ移り始める。nodes は、補間する骨(モーションが動かす骨)。
   * すでに補間の途中なら、そのときの見た目の姿勢から、やり直す(連続で切り替えても、ぴくっとならない)。
   */
  begin(nodes: Iterable<THREE.Object3D>): void {
    this.snaps = [...nodes].map((node) => ({ node, q: node.quaternion.clone(), p: node.position.clone() }))
    this.elapsed = 0
    this.duration = null
  }

  cancel(): void {
    this.snaps = []
  }

  /** モーション(mixer)を更新したあとに、毎フレーム呼ぶ。補間が終わった・必要ないときは、何もしない */
  apply(dt: number): void {
    if (this.snaps.length === 0) return
    if (this.duration === null) {
      let maxAngle = 0
      for (const s of this.snaps) maxAngle = Math.max(maxAngle, s.q.angleTo(s.node.quaternion))
      this.duration = blendDuration(maxAngle)
      if (this.duration === 0) {
        this.snaps = []
        return
      }
    }
    this.elapsed += dt
    if (this.elapsed >= this.duration) {
      this.snaps = []
      return
    }
    const k = smoothstep(this.elapsed / this.duration)
    for (const s of this.snaps) {
      this.tmpQ.copy(s.node.quaternion) // モーションが決めた、新しい姿勢
      this.tmpP.copy(s.node.position)
      s.node.quaternion.copy(s.q).slerp(this.tmpQ, k)
      s.node.position.copy(s.p).lerp(this.tmpP, k)
    }
  }
}
