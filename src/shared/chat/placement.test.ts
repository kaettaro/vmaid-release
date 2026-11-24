import { describe, expect, it } from 'vitest'
import { defaultPlacementOptions, placeUserBubble, type Point, type Size, type UserBubblePlacement } from './placement'

const win = { w: 400, h: 600 }
const bubble = { w: 260, h: 60 }
const o = defaultPlacementOptions
const margin = o.tailLength + 6

/** しっぽの3点を、吹き出し内の座標に戻す */
const absPoints = (p: UserBubblePlacement): [Point, Point, Point] =>
  p.tail.points.map((q) => ({ x: q.x + p.tail.left, y: q.y + p.tail.top })) as [Point, Point, Point]

/** 点が吹き出しの四角形の内側(辺を含む)にあるか */
const inside = (pt: Point, b: Size, eps = 1e-6): boolean => pt.x >= -eps && pt.x <= b.w + eps && pt.y >= -eps && pt.y <= b.h + eps

describe('placeUserBubble: 吹き出しの位置', () => {
  it('画面中央下がキャラの真下にあるなら、吹き出しは中央で、しっぽは真下を向く', () => {
    const p = placeUserBubble(win, { x: 100, y: 200 }, { x: 300, y: 1000 }, bubble)
    expect(p.left + bubble.w / 2).toBeCloseTo(200)
    expect(p.tail.direction.y).toBeCloseTo(1)
    expect(p.tail.direction.x).toBeCloseTo(0)
  })

  it('キャラが画面の右側にいるなら吹き出しは左寄り、左側なら右寄り', () => {
    const right = placeUserBubble(win, { x: 1000, y: 300 }, { x: 700, y: 900 }, bubble)
    expect(right.left + bubble.w / 2).toBeLessThan(200)
    expect(right.tail.direction.x).toBeLessThan(0) // 左(画面中央)へ向く
    const left = placeUserBubble(win, { x: 0, y: 300 }, { x: 700, y: 900 }, bubble)
    expect(left.left + bubble.w / 2).toBeGreaterThan(200)
    expect(left.tail.direction.x).toBeGreaterThan(0)
  })

  it('どんな位置でも、吹き出しはしっぽの余白を残してウィンドウ内に収まり、顔(上半分)にかからない', () => {
    for (let i = 0; i < 400; i++) {
      const winPos = { x: Math.random() * 3000 - 500, y: Math.random() * 1200 - 200 }
      const target = { x: Math.random() * 3000, y: Math.random() * 1500 }
      const b = { w: 100 + Math.random() * 200, h: 30 + Math.random() * 120 }
      const p = placeUserBubble(win, winPos, target, b)
      expect(p.left).toBeGreaterThanOrEqual(margin - 1e-6)
      expect(p.left + b.w).toBeLessThanOrEqual(win.w - margin + 1e-6)
      expect(p.top + b.h).toBeLessThanOrEqual(win.h - margin + 1e-6)
      expect(p.top).toBeGreaterThanOrEqual(Math.min(win.h * 0.5, win.h - margin - b.h) - 1e-6)
    }
  })

  it('ウィンドウより幅の広い吹き出しでも破綻しない(小さく縮小したとき)', () => {
    const p = placeUserBubble({ w: 120, h: 180 }, { x: 0, y: 0 }, { x: 500, y: 500 }, { w: 200, h: 40 })
    expect(Number.isFinite(p.left)).toBe(true)
    expect(p.left + 100).toBeCloseTo(60) // 中央に置く
  })

  it('目標がキャラの位置と一致しても(方向が定まらない)破綻しない', () => {
    const p = placeUserBubble(win, { x: 0, y: 0 }, { x: 200, y: 372 }, bubble)
    expect(absPoints(p).every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true)
  })
})

describe('placeUserBubble: しっぽの形(見える辺は2辺だけ)', () => {
  const random = (): UserBubblePlacement & { b: Size } => {
    const b = { w: 120 + Math.random() * 200, h: 2 * (o.cornerRadius + o.tailHalfBase) + 4 + Math.random() * 100 }
    const p = placeUserBubble(win, { x: Math.random() * 3000 - 500, y: Math.random() * 1200 - 200 }, { x: Math.random() * 3000, y: Math.random() * 1500 }, b)
    // しっぽの座標は吹き出しの中(吹き出しの左上が原点)で扱う
    return { ...p, b }
  }

  it('底辺の2点は、必ず吹き出しの内側にある(底辺が外に見えて3辺になることがない)', () => {
    for (let i = 0; i < 1000; i++) {
      const p = random()
      const [p1, p2] = absPoints(p)
      expect(inside(p1, p.b)).toBe(true)
      expect(inside(p2, p.b)).toBe(true)
    }
  })

  it('先端は必ず吹き出しの外にある(しっぽが見える)', () => {
    for (let i = 0; i < 1000; i++) {
      const p = random()
      expect(inside(absPoints(p)[2], p.b, -1e-9)).toBe(false)
    }
  })

  it('底辺は辺に沿っている(回転して辺とずれることがない)', () => {
    for (let i = 0; i < 1000; i++) {
      const p = random()
      const [p1, p2] = absPoints(p)
      // 底辺は水平か垂直(辺と平行)
      expect(Math.abs(p1.x - p2.x) < 1e-9 || Math.abs(p1.y - p2.y) < 1e-9).toBe(true)
    }
  })

  it('底辺の2点は辺から tailInset だけ内側で、角丸にかからない', () => {
    const pad = o.cornerRadius + o.tailHalfBase
    for (let i = 0; i < 1000; i++) {
      const p = random()
      const [p1, p2] = absPoints(p)
      for (const q of [p1, p2]) {
        const dEdge = Math.min(q.x, p.b.w - q.x, q.y, p.b.h - q.y) // 最も近い辺までの距離
        expect(dEdge).toBeGreaterThanOrEqual(o.tailInset - 1e-6)
        expect(dEdge).toBeLessThanOrEqual(o.tailInset + 1e-6)
      }
      // 辺に沿った方向では、角から pad 以上離れている(底辺の端が角丸にかからない)
      const horizontalBase = Math.abs(p1.y - p2.y) < 1e-9
      const mid = horizontalBase ? (p1.x + p2.x) / 2 : (p1.y + p2.y) / 2
      const length = horizontalBase ? p.b.w : p.b.h
      expect(mid).toBeGreaterThanOrEqual(pad - 1e-6)
      expect(mid).toBeLessThanOrEqual(length - pad + 1e-6)
    }
  })

  it('しっぽは、出る辺の法線から45度以内の向き(横に寝すぎない)', () => {
    for (let i = 0; i < 1000; i++) {
      const p = random()
      const [p1, p2, apex] = absPoints(p)
      const base = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const horizontalBase = Math.abs(p1.y - p2.y) < 1e-9
      const normalOutward = horizontalBase ? { x: 0, y: base.y > p.b.h / 2 ? 1 : -1 } : { x: base.x > p.b.w / 2 ? 1 : -1, y: 0 }
      const v = { x: apex.x - base.x, y: apex.y - base.y }
      const cos = (v.x * normalOutward.x + v.y * normalOutward.y) / Math.hypot(v.x, v.y)
      expect(cos).toBeGreaterThanOrEqual(Math.SQRT1_2 - 0.1) // inset の分だけ余裕を持たせる
    }
  })
})
