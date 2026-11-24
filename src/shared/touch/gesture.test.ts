import { describe, expect, it } from 'vitest'
import { GestureRecognizer, HOLD_START_MS, reversals, STROKE_END_GRACE_MS, type GestureEvent, type GestureSample } from './gesture'

const s = (t: number, x: number, y = 100, part: string | null = 'head', side: string | null = 'center'): GestureSample => ({ t, x, y, part, side })

/** 横に往復する動き(振幅 amp px、周期 period ms)を、dt ms おきに、dur ms 分作る */
function sweep(g: GestureRecognizer, from: number, dur: number, opts: { amp?: number; period?: number; dt?: number; part?: string | null } = {}): GestureEvent[] {
  const { amp = 40, period = 500, dt = 16, part = 'head' } = opts
  const out: GestureEvent[] = []
  for (let t = from; t <= from + dur; t += dt) out.push(...g.hover(s(t, 200 + amp * Math.sin((2 * Math.PI * (t - from)) / period), 100, part)))
  return out
}

describe('reversals(往復の数)', () => {
  it('振れ幅が小さい手ぶれは数えない。大きく往復すると数える', () => {
    expect(reversals([0, 5, 0, 5, 0, 5])).toBe(0)
    expect(reversals([0, 30, 0, 30, 0])).toBe(3)
    expect(reversals([0, 10, 20, 30])).toBe(0) // 一方向
    expect(reversals([])).toBe(0)
  })
})

describe('GestureRecognizer: なでる', () => {
  it('同じ部位の上で往復すると、stroke が出て、秒数が伸びる。止めてしばらくすると strokeEnd(同じ session)', () => {
    const g = new GestureRecognizer()
    const ev = sweep(g, 0, 3000)
    const strokes = ev.filter((e) => e.type === 'stroke')
    expect(strokes.length).toBeGreaterThanOrEqual(3)
    expect(strokes[0].part).toBe('head')
    expect(strokes.at(-1)!.sec).toBeGreaterThan(strokes[0].sec)
    expect(new Set(strokes.map((e) => e.session)).size).toBe(1)
    // 止める
    expect(g.tick(3000 + STROKE_END_GRACE_MS - 10).filter((e) => e.type === 'strokeEnd')).toEqual([])
    const end = g.tick(3000 + STROKE_END_GRACE_MS + 50)
    expect(end).toHaveLength(1)
    expect(end[0]).toMatchObject({ type: 'strokeEnd', part: 'head', session: strokes[0].session })
    expect(end[0].sec).toBeGreaterThan(2)
  })
  it('ゆっくり置いているだけ・一方向に通り過ぎる・細かい手ぶれ・速すぎる動きは、なでるではない', () => {
    const run = (feed: (g: GestureRecognizer) => GestureEvent[]): GestureEvent[] => feed(new GestureRecognizer()).filter((e) => e.type === 'stroke')
    // 一方向に通り過ぎる
    expect(run((g) => { const o: GestureEvent[] = []; for (let t = 0; t < 2000; t += 16) o.push(...g.hover(s(t, 200 + t * 0.2))); return o })).toEqual([])
    // 細かい手ぶれ
    expect(run((g) => { const o: GestureEvent[] = []; for (let t = 0; t < 2000; t += 16) o.push(...g.hover(s(t, 200 + (Math.floor(t / 100) % 2) * 3))); return o })).toEqual([])
    // 速すぎる(振幅×周期)
    expect(run((g) => sweep(g, 0, 1500, { amp: 40, period: 30, dt: 4 }))).toEqual([])
    // ほとんど動かない
    expect(run((g) => { const o: GestureEvent[] = []; for (let t = 0; t < 3000; t += 16) o.push(...g.hover(s(t, 200, 100))); return o })).toEqual([])
  })
  it('部位が変わったら、前のなでは終わり(strokeEnd)、新しい部位で数え直す。体の外へ出ても終わり', () => {
    const g = new GestureRecognizer()
    const a = sweep(g, 0, 2000, { part: 'head' })
    expect(a.some((e) => e.type === 'stroke')).toBe(true)
    const b = g.hover(s(2016, 200, 100, 'hand', 'left'))
    expect(b.map((e) => e.type)).toEqual(['strokeEnd'])
    expect(b[0].part).toBe('head')
    const c = sweep(g, 2100, 2000, { part: 'hand' })
    expect(c.find((e) => e.type === 'stroke')).toMatchObject({ part: 'hand' })
    const out = g.hover(s(4200, 200, 100, null))
    expect(out.map((e) => e.type)).toEqual(['strokeEnd'])
  })
  it('なで直すと、別の session になる。cancel で打ち切ると strokeEnd が出る', () => {
    const g = new GestureRecognizer()
    const first = sweep(g, 0, 2000).find((e) => e.type === 'stroke')!
    g.tick(2000 + STROKE_END_GRACE_MS + 50)
    const second = sweep(g, 4000, 2000).find((e) => e.type === 'stroke')!
    expect(second.session).not.toBe(first.session)
    expect(g.cancel(6100).map((e) => e.type)).toEqual(['strokeEnd'])
    expect(g.cancel(6200)).toEqual([])
  })
})

describe('GestureRecognizer: 長押し', () => {
  it('動かさずに押し続けると、HOLD_START_MS のあと hold が出て、一定間隔で続く(同じ session)。離すと止まる', () => {
    const g = new GestureRecognizer()
    g.down(s(0, 200, 100, 'hand', 'left'))
    expect(g.tick(HOLD_START_MS - 50)).toEqual([])
    const e1 = g.tick(HOLD_START_MS + 10)
    expect(e1).toEqual([{ type: 'hold', part: 'hand', side: 'left', sec: expect.closeTo(0.61, 2), session: expect.any(Number) }])
    expect(g.tick(HOLD_START_MS + 100)).toEqual([]) // 間隔(500ms)が空くまで出ない
    const e2 = g.tick(HOLD_START_MS + 520)
    expect(e2[0].session).toBe(e1[0].session)
    expect(e2[0].sec).toBeGreaterThan(e1[0].sec)
    g.up()
    expect(g.tick(HOLD_START_MS + 2000)).toEqual([])
  })
  it('押したまま動かしたら(ドラッグ)、長押しではない。体の外で押しても、長押しではない', () => {
    const g = new GestureRecognizer()
    g.down(s(0, 200, 100, 'head'))
    g.dragMove(s(100, 230, 100))
    expect(g.tick(1500)).toEqual([])
    g.down(s(2000, 200, 100, null))
    expect(g.tick(4000)).toEqual([])
  })
  it('少しの手ぶれ(HOLD_MOVE_PX 以内)では、長押しのまま', () => {
    const g = new GestureRecognizer()
    g.down(s(0, 200, 100, 'head'))
    g.dragMove(s(100, 205, 103))
    expect(g.tick(HOLD_START_MS + 20)).toHaveLength(1)
  })
})
