// 移動範囲を画面上で決める窓と、main のやり取り(Electron 非依存)
import type { Rect } from './geometry'

/** 範囲を決める窓(ディスプレイごとに 1 枚)が、起動時に受け取るもの */
export interface MoveAreaInit {
  /** この窓が覆うディスプレイの、左上(画面上の絶対座標。DIP) */
  origin: { x: number; y: number }
  size: { width: number; height: number }
  /** いまの矩形(すべてのディスプレイ分。絶対座標) */
  rects: Rect[]
  /** キャラの窓の大きさ(矩形の中に、薄く目安を出す) */
  guide: { width: number; height: number }
}

/** 窓の中で描くための、矩形の座標変換(絶対 ⇄ この窓の中) */
export const toLocal = (r: Rect, origin: { x: number; y: number }): Rect => ({ ...r, x: r.x - origin.x, y: r.y - origin.y })
export const toGlobal = (r: Rect, origin: { x: number; y: number }): Rect => ({ ...r, x: r.x + origin.x, y: r.y + origin.y })
