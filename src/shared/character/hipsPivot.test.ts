import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { qAxisAngle, type Quat, type Vec3 } from '../motions/quat'
import { applyHipsPivot, createHipsPivotState, resetHipsPivot, restoreHipsPivot } from './hipsPivot'

const PIVOT: Vec3 = [0, 0.2, 0.03]
const rotX90: Quat = qAxisAngle('x', Math.PI / 2)

describe('applyHipsPivot', () => {
  it('回転が単位なら、位置は変わらない', () => {
    const s = createHipsPivotState()
    const p = applyHipsPivot(s, [0.1, 0.6, 0], [0, 0, 0, 1], PIVOT)
    expect(p[0]).toBeCloseTo(0.1)
    expect(p[1]).toBeCloseTo(0.6)
    expect(p[2]).toBeCloseTo(0)
  })

  it('回転があれば、股関節の中点(位置 + R·pivot + 補正)が、回転なしのときと同じ場所に来る', () => {
    const s = createHipsPivotState()
    const pos: Vec3 = [0, 0.6, 0]
    const out = applyHipsPivot(s, pos, rotX90, PIVOT)
    // 補正後の位置 + R·pivot = 元の位置 + pivot(回転で股関節が動かない)
    const r = new THREE.Vector3(...PIVOT).applyQuaternion(new THREE.Quaternion(...rotX90))
    expect(out[0] + r.x).toBeCloseTo(pos[0] + PIVOT[0])
    expect(out[1] + r.y).toBeCloseTo(pos[1] + PIVOT[1])
    expect(out[2] + r.z).toBeCloseTo(pos[2] + PIVOT[2])
  })

  it('書き直されない(位置が前回の補正後のまま)なら、何度呼んでも同じ結果になる(累積しない)', () => {
    const s = createHipsPivotState()
    let pos: Vec3 = [0, 0.6, 0]
    const first = applyHipsPivot(s, pos, rotX90, PIVOT)
    pos = first
    for (let i = 0; i < 100; i++) pos = applyHipsPivot(s, pos, rotX90, PIVOT)
    expect(pos).toEqual(first)
  })

  it('アニメーションが位置を書き直したら、その値を新しい元の位置にする', () => {
    const s = createHipsPivotState()
    const a = applyHipsPivot(s, [0, 0.6, 0], rotX90, PIVOT)
    const b = applyHipsPivot(s, [0.5, 0.6, 0], rotX90, PIVOT) // 書き直された(前回の補正後とは違う値)
    expect(b[0] - a[0]).toBeCloseTo(0.5)
    expect(b[1]).toBeCloseTo(a[1])
  })

  it('回転が変わっても、元の位置からの補正になる(毎フレーム足し込まない)', () => {
    const s = createHipsPivotState()
    let pos: Vec3 = [0, 0.6, 0]
    pos = applyHipsPivot(s, pos, rotX90, PIVOT)
    pos = applyHipsPivot(s, pos, [0, 0, 0, 1], PIVOT) // 回転が単位に戻った → 元の位置に戻る
    expect(pos[0]).toBeCloseTo(0)
    expect(pos[1]).toBeCloseTo(0.6)
    expect(pos[2]).toBeCloseTo(0)
  })
})

describe('restoreHipsPivot / resetHipsPivot', () => {
  it('補正したままの位置なら、元の位置を返す。state は捨てる', () => {
    const s = createHipsPivotState()
    const out = applyHipsPivot(s, [0, 0.6, 0], rotX90, PIVOT)
    expect(restoreHipsPivot(s, out)).toEqual([0, 0.6, 0])
    expect(s.base).toBeNull()
  })
  it('アニメーションが書き直したあとなら、null(何もしない)', () => {
    const s = createHipsPivotState()
    applyHipsPivot(s, [0, 0.6, 0], rotX90, PIVOT)
    expect(restoreHipsPivot(s, [9, 9, 9])).toBeNull()
  })
  it('何も補正していなければ null', () => {
    expect(restoreHipsPivot(createHipsPivotState(), [0, 0, 0])).toBeNull()
    const s = createHipsPivotState()
    resetHipsPivot(s)
    expect(s).toEqual({ base: null, written: null })
  })
})

describe('Three.js の AnimationMixer と組み合わせたとき(腰が動かないモーションで、累積して飛んでいく不具合の再現)', () => {
  /** hips の位置が一定、回転も一定のクリップ(静止ポーズ。chillf / cagedbf などと同じ) */
  function staticClip(hips: THREE.Object3D): THREE.AnimationClip {
    return new THREE.AnimationClip('static', 2, [
      new THREE.VectorKeyframeTrack(`${hips.name}.position`, [0, 2], [0, 0.6, 0, 0, 0.6, 0]),
      new THREE.QuaternionKeyframeTrack(`${hips.name}.quaternion`, [0, 2], [...rotX90, ...rotX90])
    ])
  }

  function run(compensate: (hips: THREE.Object3D, step: number) => void, steps: number): THREE.Vector3 {
    const root = new THREE.Object3D()
    const hips = new THREE.Object3D()
    hips.name = 'hips'
    root.add(hips)
    const mixer = new THREE.AnimationMixer(root)
    mixer.clipAction(staticClip(hips)).play()
    for (let i = 0; i < steps; i++) {
      mixer.update(1 / 60)
      compensate(hips, i)
    }
    return hips.position.clone()
  }

  it('毎フレーム足し込む方式(旧実装)は、値が変わらないトラックで位置が累積してずれていく', () => {
    const pivot = new THREE.Vector3(...PIVOT)
    const naive = (hips: THREE.Object3D): void => {
      hips.position.add(pivot).sub(pivot.clone().applyQuaternion(hips.quaternion))
    }
    const a = run(naive, 10)
    const b = run(naive, 100)
    expect(b.distanceTo(a)).toBeGreaterThan(1) // 90 フレームで 1m 以上ずれる(= 画面外へ飛ぶ)
  })

  it('applyHipsPivot を使えば、何フレーム経っても位置は同じ', () => {
    const s = createHipsPivotState()
    const compensate = (hips: THREE.Object3D): void => {
      const q = hips.quaternion
      const out = applyHipsPivot(s, [hips.position.x, hips.position.y, hips.position.z], [q.x, q.y, q.z, q.w], PIVOT)
      hips.position.set(out[0], out[1], out[2])
    }
    const a = run(compensate, 10)
    resetHipsPivot(s)
    const b = run(compensate, 600)
    expect(b.distanceTo(a)).toBeLessThan(1e-9)
    expect(b.length()).toBeLessThan(1) // 補正量は有限(約 0.2m)
  })
})
