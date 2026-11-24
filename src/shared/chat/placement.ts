// 「自分の吹き出し」の配置。キャラと、画面中央下(=ユーザーのいる側)を結ぶ線上のキャラの近くに置き、
// しっぽは画面中央下を指す。ウィンドウ内の座標(css px)で計算する純粋関数。

export interface Size {
  w: number
  h: number
}
export interface Point {
  x: number
  y: number
}

export interface TailShape {
  /** しっぽを描く箱の左上と大きさ(吹き出し内の座標) */
  left: number
  top: number
  width: number
  height: number
  /** 三角形の3点(箱の中の座標)。[底辺の点, 底辺の点, 先端] */
  points: [Point, Point, Point]
  /** 先端の向き(単位ベクトル)。テスト・デバッグ用 */
  direction: Point
}

export interface UserBubblePlacement {
  /** 吹き出しの左上(ウィンドウ内の座標) */
  left: number
  top: number
  tail: TailShape
}

export interface PlacementOptions {
  tailLength: number
  /** しっぽの底辺を、吹き出しの辺より内側へ潜らせる量。底辺を本体に隠し、見える辺を2辺だけにする */
  tailInset: number
  /** しっぽの根元の半幅と、吹き出しの角丸の半径(css px)。根元は角丸にかからない直線部分に置く */
  tailHalfBase: number
  cornerRadius: number
  /** キャラの体の中心(ウィンドウ内の割合)。ここから画面中央下へ向かう線上に置く */
  characterAnchor: { x: number; y: number }
  /** キャラからどれだけ離すか(ウィンドウ高さに対する割合)。離しすぎない */
  distanceRatio: number
  /** 顔にかぶらないよう、吹き出しの上端がこの割合(ウィンドウ高さ)より上に来ないようにする */
  minTopRatio: number
}

export const defaultPlacementOptions: PlacementOptions = {
  tailLength: 12,
  tailInset: 3,
  tailHalfBase: 8,
  cornerRadius: 14,
  characterAnchor: { x: 0.5, y: 0.62 },
  distanceRatio: 0.28,
  minTopRatio: 0.5
}

const norm = (x: number, y: number): Point => {
  const len = Math.hypot(x, y)
  return len < 1e-6 ? { x: 0, y: 1 } : { x: x / len, y: y / len }
}

/**
 * @param win ウィンドウの大きさ
 * @param winPos ウィンドウ左上の、画面上の座標
 * @param screenTarget 画面中央下の、画面上の座標(ユーザーがいる側)
 * @param bubble 吹き出しの大きさ
 */
export function placeUserBubble(
  win: Size,
  winPos: Point,
  screenTarget: Point,
  bubble: Size,
  opt: PlacementOptions = defaultPlacementOptions
): UserBubblePlacement {
  const target: Point = { x: screenTarget.x - winPos.x, y: screenTarget.y - winPos.y } // ウィンドウ内の座標
  const anchor: Point = { x: win.w * opt.characterAnchor.x, y: win.h * opt.characterAnchor.y }

  // キャラ → 画面中央下 の方向に、少しだけ離れた位置を吹き出しの中心にする
  const d = norm(target.x - anchor.x, target.y - anchor.y)
  const dist = win.h * opt.distanceRatio
  let cx = anchor.x + d.x * dist
  let cy = anchor.y + d.y * dist

  // しっぽの分の余白を残してウィンドウ内に収める。上は顔にかぶらない位置まで
  const margin = opt.tailLength + 6
  const minX = margin + bubble.w / 2
  const maxX = win.w - margin - bubble.w / 2
  cx = minX > maxX ? win.w / 2 : Math.min(maxX, Math.max(minX, cx))
  const minY = Math.max(margin, win.h * opt.minTopRatio) + bubble.h / 2
  const maxY = win.h - margin - bubble.h / 2
  cy = minY > maxY ? maxY : Math.min(maxY, Math.max(minY, cy))

  // しっぽ: 画面中央下へ向かう方向が「横寄り」なら左右の辺、「縦寄り」なら上下の辺から出す。
  // 三角形は回転ではなく3点で作る。底辺の2点は辺に沿って並べ、さらに本体の内側へ tailInset だけ潜らせる。
  // こうすると底辺は必ず吹き出しの中に隠れ、見える辺は先端へ向かう2辺だけになる(3辺見える不自然さを防ぐ)。
  // 根元は、角の丸い部分にかからない範囲(pad)に寄せる。
  const t = norm(target.x - cx, target.y - cy)
  const toSide = t.x === 0 ? Infinity : bubble.w / 2 / Math.abs(t.x) // 中心から左右の辺に届くまでの距離
  const toTopBottom = t.y === 0 ? Infinity : bubble.h / 2 / Math.abs(t.y)
  const pad = opt.cornerRadius + opt.tailHalfBase
  const along = (center: number, offset: number, length: number): number =>
    length <= 2 * pad ? length / 2 : Math.min(length - pad, Math.max(pad, center + offset))
  const horizontal = Math.abs(t.x) > Math.abs(t.y) // 左右の辺から出るか
  let base: Point // 辺の上の根元の中心
  let normal: Point // その辺の外向きの法線
  if (horizontal) {
    normal = { x: t.x > 0 ? 1 : -1, y: 0 }
    base = { x: t.x > 0 ? bubble.w : 0, y: along(bubble.h / 2, t.y * toSide, bubble.h) }
  } else {
    normal = { x: 0, y: t.y > 0 ? 1 : -1 }
    base = { x: along(bubble.w / 2, t.x * toTopBottom, bubble.w), y: t.y > 0 ? bubble.h : 0 }
  }
  const tangent: Point = { x: -normal.y, y: normal.x } // 辺に沿う向き
  const inner: Point = { x: base.x - normal.x * opt.tailInset, y: base.y - normal.y * opt.tailInset }
  const p1: Point = { x: inner.x - tangent.x * opt.tailHalfBase, y: inner.y - tangent.y * opt.tailHalfBase }
  const p2: Point = { x: inner.x + tangent.x * opt.tailHalfBase, y: inner.y + tangent.y * opt.tailHalfBase }
  // 先端: 根元から画面中央下の方向へ tailLength。辺の法線から45度以内なので、必ず外向きになる
  const apex: Point = { x: base.x + t.x * opt.tailLength, y: base.y + t.y * opt.tailLength }
  const xs = [p1.x, p2.x, apex.x]
  const ys = [p1.y, p2.y, apex.y]
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const rel = (p: Point): Point => ({ x: p.x - left, y: p.y - top })
  return {
    left: cx - bubble.w / 2,
    top: cy - bubble.h / 2,
    tail: {
      left,
      top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top,
      points: [rel(p1), rel(p2), rel(apex)],
      direction: t
    }
  }
}
