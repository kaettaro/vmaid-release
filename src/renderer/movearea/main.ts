import type { Rect } from '@shared/geometry'
import { MAX_RECTS, MIN_RECT_SIZE } from '@shared/move'
import { toGlobal, toLocal, type MoveAreaInit } from '@shared/moveArea'

/**
 * 移動範囲を決める窓の画面。暗い幕の上に、動ける範囲を明るく抜いて見せる。
 * 矩形は絶対座標で持ち、描くときだけ、この窓の中の座標へ直す。変えたら main へ送る(他のディスプレイの窓へ伝わる)。
 */
const canvas = document.getElementById('c') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const HANDLE = 14

let init: MoveAreaInit | null = null
let rects: Rect[] = []
let selected = -1
type Drag =
  | { kind: 'new'; sx: number; sy: number }
  | { kind: 'move'; index: number; dx: number; dy: number }
  | { kind: 'resize'; index: number; corner: 'nw' | 'ne' | 'sw' | 'se' }
let drag: Drag | null = null
let pointer = { x: 0, y: 0 }

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

function resize(): void {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  draw()
}

/** 窓の中の座標の矩形 */
const local = (i: number): Rect => toLocal(rects[i]!, init!.origin)
const setLocal = (i: number, r: Rect): void => {
  rects[i] = toGlobal(r, init!.origin)
}

function normalized(ax: number, ay: number, bx: number, by: number): Rect {
  const W = init!.size.width
  const H = init!.size.height
  const x1 = clamp(Math.min(ax, bx), 0, W)
  const y1 = clamp(Math.min(ay, by), 0, H)
  const x2 = clamp(Math.max(ax, bx), 0, W)
  const y2 = clamp(Math.max(ay, by), 0, H)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function cornerAt(r: Rect, x: number, y: number): 'nw' | 'ne' | 'sw' | 'se' | null {
  const near = (px: number, py: number): boolean => Math.abs(x - px) <= HANDLE && Math.abs(y - py) <= HANDLE
  if (near(r.x, r.y)) return 'nw'
  if (near(r.x + r.width, r.y)) return 'ne'
  if (near(r.x, r.y + r.height)) return 'sw'
  if (near(r.x + r.width, r.y + r.height)) return 'se'
  return null
}

const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height

/** 点にある矩形(後ろに描いたものが手前) */
function hit(x: number, y: number): number {
  for (let i = rects.length - 1; i >= 0; i--) if (inside(local(i), x, y)) return i
  return -1
}

function sync(): void {
  window.vmaid.moveAreaChange(rects)
}

function draw(): void {
  if (!init) return
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(8, 10, 18, 0.62)'
  ctx.fillRect(0, 0, W, H)
  const list: Array<{ r: Rect; sel: boolean; ghost: boolean }> = rects.map((_, i) => ({ r: local(i), sel: i === selected, ghost: false }))
  if (drag?.kind === 'new') list.push({ r: normalized(drag.sx, drag.sy, pointer.x, pointer.y), sel: true, ghost: true })
  for (const { r } of list) ctx.clearRect(r.x, r.y, r.width, r.height) // 範囲の中は、幕を抜く
  for (const { r, sel, ghost } of list) {
    ctx.lineWidth = sel ? 3 : 2
    ctx.strokeStyle = sel ? '#ffd166' : '#8be9fd'
    ctx.setLineDash(ghost ? [8, 6] : [])
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height)
    ctx.setLineDash([])
    // キャラの窓の大きさの目安(収まるかを見る)。矩形が小さいときは、中央に寄る
    const gw = init.guide.width
    const gh = init.guide.height
    const gx = r.x + (r.width - gw) / 2
    const gy = r.y + (r.height - gh) / 2
    ctx.strokeStyle = r.width < gw || r.height < gh ? 'rgba(255, 140, 140, 0.8)' : 'rgba(255, 255, 255, 0.45)'
    ctx.setLineDash([4, 5])
    ctx.lineWidth = 1
    ctx.strokeRect(gx + 0.5, gy + 0.5, gw, gh)
    ctx.setLineDash([])
    if (sel && !ghost) {
      ctx.fillStyle = '#ffd166'
      for (const [px, py] of [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]] as const) ctx.fillRect(px - 5, py - 5, 10, 10)
    }
  }
  ctx.fillStyle = '#fff'
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillText(`${rects.length}/${MAX_RECTS} か所`, 16, H - 16)
}

canvas.addEventListener('mousedown', (e) => {
  if (!init || e.button !== 0) return
  const x = e.clientX
  const y = e.clientY
  pointer = { x, y }
  // 選んでいる矩形の角 → 大きさ変更
  if (selected >= 0) {
    const c = cornerAt(local(selected), x, y)
    if (c) {
      drag = { kind: 'resize', index: selected, corner: c }
      return
    }
  }
  const i = hit(x, y)
  if (i >= 0) {
    selected = i
    const r = local(i)
    drag = { kind: 'move', index: i, dx: x - r.x, dy: y - r.y }
  } else if (rects.length < MAX_RECTS) {
    selected = -1
    drag = { kind: 'new', sx: x, sy: y }
  } else {
    selected = -1
  }
  draw()
})

window.addEventListener('mousemove', (e) => {
  if (!init) return
  pointer = { x: e.clientX, y: e.clientY }
  if (drag?.kind === 'move') {
    const r = local(drag.index)
    setLocal(drag.index, { ...r, x: clamp(pointer.x - drag.dx, 0, init.size.width - r.width), y: clamp(pointer.y - drag.dy, 0, init.size.height - r.height) })
  } else if (drag?.kind === 'resize') {
    const r = local(drag.index)
    const right = r.x + r.width
    const bottom = r.y + r.height
    const px = clamp(pointer.x, 0, init.size.width)
    const py = clamp(pointer.y, 0, init.size.height)
    const fixedX = drag.corner === 'nw' || drag.corner === 'sw' ? right : r.x
    const fixedY = drag.corner === 'nw' || drag.corner === 'ne' ? bottom : r.y
    setLocal(drag.index, normalized(fixedX, fixedY, px, py))
  }
  draw()
})

window.addEventListener('mouseup', () => {
  if (!init || !drag) return
  if (drag.kind === 'new') {
    const r = normalized(drag.sx, drag.sy, pointer.x, pointer.y)
    if (r.width >= MIN_RECT_SIZE && r.height >= MIN_RECT_SIZE && rects.length < MAX_RECTS) {
      rects.push(toGlobal(r, init.origin))
      selected = rects.length - 1
    }
  } else if (drag.kind === 'resize') {
    // 小さすぎる矩形にしない
    const r = local(drag.index)
    if (r.width < MIN_RECT_SIZE || r.height < MIN_RECT_SIZE) setLocal(drag.index, { ...r, width: Math.max(r.width, MIN_RECT_SIZE), height: Math.max(r.height, MIN_RECT_SIZE) })
  }
  drag = null
  sync()
  draw()
})

function removeSelected(): void {
  if (selected < 0) return
  rects.splice(selected, 1)
  selected = -1
  sync()
  draw()
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.code === 'Escape') window.vmaid.moveAreaFinish(false)
  else if (e.key === 'Enter') window.vmaid.moveAreaFinish(true)
  else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected()
})
document.getElementById('save')!.addEventListener('click', () => window.vmaid.moveAreaFinish(true))
document.getElementById('cancel')!.addEventListener('click', () => window.vmaid.moveAreaFinish(false))
document.getElementById('clear')!.addEventListener('click', () => {
  rects = []
  selected = -1
  sync()
  draw()
})
// 右クリックで、その矩形を消す
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  const i = hit(e.clientX, e.clientY)
  if (i >= 0) {
    selected = i
    removeSelected()
  }
})

window.addEventListener('resize', resize)
window.vmaid.onMoveAreaRects((next) => {
  rects = next
  if (selected >= rects.length) selected = -1
  draw()
})
void window.vmaid.moveAreaInit().then((i) => {
  if (!i) return
  init = i
  rects = i.rects
  resize()
})
