import { describe, expect, it } from 'vitest'
import { ChaseDriver, ChasePatchSchema, ChaseSchema, GAZE_MAX_DEG, aimAt, chaseStep, chaseTargets, cursorDistance, ZERO_STATE, type ChaseSettings } from './chase'

const defaults = ChaseSchema.parse({})
const on = (patch: Partial<ChaseSettings>): ChaseSettings => ({ ...defaults, ...patch })

describe('追いかけの設定', () => {
  it('壊れた値は、既定値か範囲内に直る', () => {
    const s = ChaseSchema.parse({ strength: 9, speed: 'x', headMaxDeg: -5, gaze: 'yes' })
    expect(s.strength).toBe(1)
    expect(s.speed).toBe(5)
    expect(s.headMaxDeg).toBe(5)
    expect(s.gaze).toBe(true)
  })
  it('パッチは、指定した項目だけ', () => {
    expect(ChasePatchSchema.parse({ body: true })).toEqual({ body: true })
  })
})

describe('向きの計算', () => {
  it('カーソルが右なら yaw が正、上なら pitch が正、真下の足元なら pitch が負', () => {
    const head = { x: 200, y: 200 }
    expect(aimAt({ x: 650, y: 200 }, head).yaw).toBeCloseTo(45)
    expect(aimAt({ x: -250, y: 200 }, head).yaw).toBeCloseTo(-45)
    expect(aimAt({ x: 200, y: -250 }, head).pitch).toBeCloseTo(45)
    expect(aimAt({ x: 200, y: 650 }, head).pitch).toBeCloseTo(-45)
    expect(aimAt(head, head)).toEqual({ yaw: 0, pitch: 0 })
  })
  it('距離', () => {
    expect(cursorDistance({ x: 3, y: 4 }, { x: 0, y: 0 })).toBe(5)
  })
})

describe('体・頭・目への割り振り', () => {
  const aim = { yaw: 40, pitch: 20 }
  it('すべて OFF なら、すべて 0', () => {
    expect(chaseTargets(aim, on({ gaze: false, head: false, body: false }))).toEqual(ZERO_STATE)
  })
  it('頭だけ ON なら、強さをかけた向きを、上限内で頭が受け持つ(上下は左右の 6 割まで)', () => {
    const t = chaseTargets(aim, on({ gaze: false, head: true, body: false, strength: 0.5, headMaxDeg: 30 }))
    expect(t.head.yaw).toBeCloseTo(20)
    expect(t.head.pitch).toBeCloseTo(10)
    expect(chaseTargets({ yaw: 90, pitch: 90 }, on({ gaze: false, head: true, body: false, strength: 1, headMaxDeg: 30 })).head).toEqual({ yaw: 30, pitch: 18 })
  })
  it('頭と目が ON なら、頭が受け持ちきれない分を目が受け持つ', () => {
    const t = chaseTargets({ yaw: 60, pitch: 0 }, on({ gaze: true, head: true, body: false, strength: 1, headMaxDeg: 30 }))
    expect(t.head.yaw).toBe(30)
    expect(t.gaze.yaw).toBe(GAZE_MAX_DEG)
  })
  it('頭が OFF で目だけ ON なら、目が受け持つ(上限まで)', () => {
    const t = chaseTargets({ yaw: 10, pitch: 5 }, on({ gaze: true, head: false, body: false, strength: 1 }))
    expect(t.gaze).toEqual({ yaw: 10, pitch: 5 })
    expect(t.head).toEqual({ yaw: 0, pitch: 0 })
  })
  it('体は左右だけ。受け持つ分だけ、頭の分が減る', () => {
    const t = chaseTargets({ yaw: 40, pitch: 20 }, on({ gaze: false, head: true, body: true, strength: 1, bodyMaxDeg: 25, headMaxDeg: 80 }))
    expect(t.body).toEqual({ yaw: 20, pitch: 0 })
    expect(t.head.yaw).toBeCloseTo(20)
  })
})

describe('なめらかな追従', () => {
  it('目標へ近づき、十分な時間で届く。行きすぎない', () => {
    const s = on({ cascade: false })
    const target = chaseTargets({ yaw: 30, pitch: 0 }, s)
    let cur = ZERO_STATE
    let prev = 0
    for (let i = 0; i < 600; i++) {
      cur = chaseStep(cur, target, s, 1 / 60)
      expect(cur.head.yaw).toBeGreaterThanOrEqual(prev)
      expect(cur.head.yaw).toBeLessThanOrEqual(target.head.yaw + 1e-9)
      prev = cur.head.yaw
    }
    expect(cur.head.yaw).toBeCloseTo(target.head.yaw, 2)
  })
  it('cascade なら、目 → 頭 → 体の順に、遅れてついてくる', () => {
    const s = on({ gaze: true, head: true, body: true, cascade: true, strength: 1, headMaxDeg: 80, bodyMaxDeg: 60 })
    // それぞれが目標に対して、どれだけ近づいたか(割合)
    const target = chaseTargets({ yaw: 40, pitch: 0 }, { ...s, headMaxDeg: 10 })
    let cur = ZERO_STATE
    for (let i = 0; i < 6; i++) cur = chaseStep(cur, target, { ...s, headMaxDeg: 10 }, 1 / 60)
    const ratio = (c: number, t: number): number => (t === 0 ? 1 : c / t)
    expect(ratio(cur.gaze.yaw, target.gaze.yaw)).toBeGreaterThan(ratio(cur.head.yaw, target.head.yaw))
    expect(ratio(cur.head.yaw, target.head.yaw)).toBeGreaterThan(ratio(cur.body.yaw, target.body.yaw))
  })
})

describe('ChaseDriver', () => {
  it('OFF なら、常に正面', () => {
    const d = new ChaseDriver()
    expect(d.update(0.1, { x: 500, y: 0 }, { x: 0, y: 0 })).toEqual(ZERO_STATE)
    expect(d.active).toBe(false)
  })
  it('ON でカーソルが右なら、頭が右へ向く。OFF にすると、すぐ正面へ戻る', () => {
    const d = new ChaseDriver()
    d.setSettings(defaults)
    let st = ZERO_STATE
    for (let i = 0; i < 120; i++) st = d.update(1 / 60, { x: 600, y: 200 }, { x: 200, y: 200 })
    expect(st.head.yaw).toBeGreaterThan(5)
    d.setSettings(null)
    expect(d.current).toEqual(ZERO_STATE)
  })
  it('反応距離の外では、正面へ戻っていく', () => {
    const d = new ChaseDriver()
    d.setSettings(on({ reactDistance: 100, cascade: false }))
    for (let i = 0; i < 120; i++) d.update(1 / 60, { x: 280, y: 200 }, { x: 200, y: 200 })
    const near = d.current.head.yaw
    expect(near).toBeGreaterThan(1)
    for (let i = 0; i < 300; i++) d.update(1 / 60, { x: 900, y: 200 }, { x: 200, y: 200 })
    expect(Math.abs(d.current.head.yaw)).toBeLessThan(0.1)
  })
  it('カーソルがまだ届いていなくても、落ちない(正面)', () => {
    const d = new ChaseDriver()
    d.setSettings(defaults)
    expect(d.update(0.1, null, { x: 0, y: 0 })).toEqual(ZERO_STATE)
  })
})
