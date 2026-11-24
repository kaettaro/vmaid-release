import * as THREE from 'three'
import type { Aim } from '@shared/chase'

// 機能 Mod「追いかけ」: 頭・首・目のボーンに、向きを足す(VRM と PMX で共通)。
// モーション(mixer)が決めた回転の「上に」、親の軸系で回転を掛ける。モーションが、そのボーンの値を毎フレーム書かないことがあるので、
// 描画のあとに必ず元へ戻す(戻さないと、毎フレーム掛け続けて、どんどん回ってしまう)。
// 向きの約束: キャラは +Z を向き、+X が画面の右。yaw の正は画面の右、pitch の正は上(ボーンの回転では、上を向く = X 軸まわりの負)。

const DEG2RAD = Math.PI / 180
const NECK_SHARE = 0.4

const delta = (aim: Aim, share: number): THREE.Quaternion =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-aim.pitch * DEG2RAD * share, aim.yaw * DEG2RAD * share, 0, 'YXZ'))

/** ボーンに、親の軸系での回転を足す。戻す関数を返す */
function rotate(bone: THREE.Object3D, aim: Aim, share: number): () => void {
  const d = delta(aim, share)
  bone.quaternion.premultiply(d)
  const inverse = d.clone().invert()
  return () => {
    bone.quaternion.premultiply(inverse)
  }
}

/** 頭と首に、向きを足す(首 4 割・頭 6 割)。戻す関数を返す */
export function applyHeadChase(neck: THREE.Object3D | null, head: THREE.Object3D | null, aim: Aim): () => void {
  if (aim.yaw === 0 && aim.pitch === 0) return () => {}
  const undo: Array<() => void> = []
  if (neck && head) {
    undo.push(rotate(neck, aim, NECK_SHARE))
    undo.push(rotate(head, aim, 1 - NECK_SHARE))
  } else if (head) undo.push(rotate(head, aim, 1))
  else if (neck) undo.push(rotate(neck, aim, 1))
  return () => {
    for (const u of undo.reverse()) u()
  }
}

/** 目のボーン(PMX の左目・右目)に、向きを足す。戻す関数を返す */
export function applyEyeChase(eyes: Array<THREE.Object3D | null>, aim: Aim): () => void {
  if (aim.yaw === 0 && aim.pitch === 0) return () => {}
  const undo = eyes.filter((e): e is THREE.Object3D => e !== null).map((e) => rotate(e, aim, 1))
  return () => {
    for (const u of undo) u()
  }
}
