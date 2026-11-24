// キャラウィンドウの位置・サイズ計算。Electron非依存の純粋関数

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_SCALE = 0.3
export const MAX_SCALE = 3
/** 倍率1.0のときのウィンドウサイズ。縦長の全身表示を想定 */
export const BASE_WINDOW_SIZE = { width: 400, height: 600 } as const

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

export function windowSizeForScale(scale: number): { width: number; height: number } {
  const s = clampScale(scale)
  return {
    width: Math.round(BASE_WINDOW_SIZE.width * s),
    height: Math.round(BASE_WINDOW_SIZE.height * s)
  }
}

/** 拡大縮小後のウィンドウ位置。足元中央を固定して大きさだけ変える */
export function boundsAfterScale(current: Rect, scale: number): Rect {
  const size = windowSizeForScale(scale)
  return {
    x: Math.round(current.x + (current.width - size.width) / 2),
    y: Math.round(current.y + current.height - size.height),
    ...size
  }
}

/** いずれかの作業領域と、縦横ともに minVisible px 以上重なっているか(画面外に消えた位置の復元防止) */
export function isRectVisible(rect: Rect, workAreas: Rect[], minVisible = 48): boolean {
  return workAreas.some((area) => {
    const w = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x)
    const h = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y)
    return w >= minVisible && h >= minVisible
  })
}

/** 初回起動の位置: 作業領域の右下 */
export function defaultPosition(
  workArea: Rect,
  size: { width: number; height: number },
  margin = 24
): { x: number; y: number } {
  return {
    x: workArea.x + workArea.width - size.width - margin,
    y: workArea.y + workArea.height - size.height - margin
  }
}

/**
 * 表情・衣装パネルの位置。キャラの右隣、入らなければ左隣。上端をキャラに揃え、作業領域からはみ出さないよう収める。
 * キャラが動いたら再計算して追従させる。
 */
export function panelBounds(
  character: Rect,
  size: { width: number; height: number },
  workArea: Rect,
  gap = 8
): Rect {
  const height = Math.min(size.height, workArea.height)
  const width = Math.min(size.width, workArea.width)
  let x = character.x + character.width + gap
  if (x + width > workArea.x + workArea.width) x = character.x - gap - width
  x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(character.y, workArea.y), workArea.y + workArea.height - height)
  return { x: Math.round(x), y: Math.round(y), width, height }
}
