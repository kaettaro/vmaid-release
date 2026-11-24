// 緊急リセットの、確認ダイアログの文言と、「元に戻す」ための記録(リセット直前の状態)。Electron に依存しない型と文言。

import type { AdjustLayer } from './adjust'
import type { Rect } from './geometry'

/** リセット直前の、戻せる状態。戻せないもの(再生中のモーション・ルールの状態・小道具・画面効果・ゲーム・BGM)は、含まない */
export interface ResetSnapshot {
  /** キャラ窓の位置・大きさ */
  bounds: Rect
  scale: number
  clickThrough: boolean
  /** 表示されていたか */
  visible: boolean
  orientation: { yaw: number; pitch: number }
  /** 重ねていた表情・衣装セット */
  layers: AdjustLayer[]
}

export const RESET_DIALOG = {
  message: 'キャラを初期状態に戻します',
  detail:
    '【戻るもの】表示 / 位置(主画面の右下)/ 大きさ 100% / クリック透過 OFF / 向き / 重ねた表情・衣装セット\n' +
    '【止まるもの】再生中のモーション・ルールの状態・小道具・画面効果・ゲーム・BGM(これらは、元に戻しても再開しません)\n' +
    '保存した設定と、Mod の ON/OFF は、変わりません。リセットのあとで「元に戻す」を選ぶと、【戻るもの】だけを、リセット前の状態に戻せます。',
  ok: '初期状態に戻す',
  cancel: 'キャンセル'
} as const

/** リセット直前の記録を作る */
export function makeResetSnapshot(input: ResetSnapshot): ResetSnapshot {
  return {
    bounds: { ...input.bounds },
    scale: input.scale,
    clickThrough: input.clickThrough,
    visible: input.visible,
    orientation: { ...input.orientation },
    layers: input.layers.map((l) => ({ ...l, values: { ...l.values } }))
  }
}
