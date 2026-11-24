// クリックとダブルクリックの判定。クリック=ふれあい(リアクション)、ダブルクリック=会話。
// 時刻と位置だけを受け取る純粋ロジック(DOM非依存)にして、テストできるようにする。

export interface ClickPoint {
  x: number
  y: number
  time: number
}

export const DOUBLE_CLICK_MAX_MS = 350
export const DOUBLE_CLICK_MAX_DIST_PX = 12

/**
 * 直前のクリックと今回のクリックが、ダブルクリックを構成するか。
 * 3回連続は「ダブル → 次の新しい1回目」として扱いたいので、呼び出し側はダブル成立後に履歴を捨てる。
 */
export function isDoubleClick(prev: ClickPoint | null, now: ClickPoint): boolean {
  if (!prev) return false
  const dt = now.time - prev.time
  return dt >= 0 && dt <= DOUBLE_CLICK_MAX_MS && Math.hypot(now.x - prev.x, now.y - prev.y) <= DOUBLE_CLICK_MAX_DIST_PX
}
