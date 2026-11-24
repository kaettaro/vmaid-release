import { describe, expect, it } from 'vitest'
import { rectWorks, currentWorkArea, easeInOut, facingYaw, MoveSchema, nextRoamDelayMs, pickAutoMode, pickTarget, positionAt, positionRange, walkDurationMs, warpAt, type PickContext } from './move'

const WORK1 = { x: 0, y: 0, width: 1920, height: 1040 }
const WORK2 = { x: 1920, y: 0, width: 1280, height: 1000 }
const win = { x: 100, y: 440, width: 400, height: 600 }
const ctx = (over: Partial<PickContext> = {}): PickContext => ({
  window: win,
  works: [WORK1],
  cursor: { x: 1000, y: 500 },
  rng: () => 0.5,
  settings: { area: 'all', margin: 20, freeVertical: false },
  ...over
})

describe('設定の読み込み', () => {
  it('何も無いとき・壊れているときは、既定(自動は OFF・歩行タグ・待機タグ)。範囲外は丸める', () => {
    const s = MoveSchema.parse({})
    expect(s).toMatchObject({ autoRoam: false, walkTag: '歩行', warpTag: '待機', area: 'all', freeVertical: false })
    const bad = MoveSchema.parse({ speed: 99999, margin: -5, warpChance: 7, area: 'x', walkTag: 'a'.repeat(100) })
    expect(bad.speed).toBe(1200)
    expect(bad.margin).toBe(0)
    expect(bad.warpChance).toBe(1)
    expect(bad.area).toBe('all')
    expect(bad.walkTag).toHaveLength(30)
  })
})

describe('動ける範囲と、移動先の選び方', () => {
  it('作業領域の内側(余白つき)に、ウィンドウが収まる範囲。収まらない大きさなら、中央に寄せる', () => {
    expect(positionRange(WORK1, { width: 400, height: 600 }, 20)).toEqual({ minX: 20, maxX: 1500, minY: 20, maxY: 420 })
    const tiny = positionRange({ x: 0, y: 0, width: 300, height: 300 }, { width: 400, height: 600 }, 20)
    expect(tiny.minX).toBe(tiny.maxX)
    expect(tiny.minX).toBe(-50)
  })

  it('左端・右端・中央は、範囲の端と中央。高さは、そのまま(余白で、上へ押し込まない)', () => {
    expect(pickTarget('left', ctx())).toEqual({ x: 20, y: 440 })
    expect(pickTarget('right', ctx())).toEqual({ x: 1500, y: 440 })
    expect(pickTarget('center', ctx())).toEqual({ x: 760, y: 440 })
  })

  it('ランダムは、必ず範囲に収まる(乱数の両端でも)。上下に動く設定なら、高さも変わる', () => {
    for (const r of [0, 0.5, 0.999999]) {
      const p = pickTarget('random', ctx({ rng: () => r, settings: { area: 'all', margin: 20, freeVertical: true } }))!
      expect(p.x).toBeGreaterThanOrEqual(20)
      expect(p.x).toBeLessThanOrEqual(1500)
      expect(p.y).toBeGreaterThanOrEqual(20)
      expect(p.y).toBeLessThanOrEqual(420)
    }
    expect(pickTarget('random', ctx({ rng: () => 0, settings: { area: 'all', margin: 20, freeVertical: true } }))!.y).toBe(20)
  })

  it('カーソルの近く: ウィンドウの中央が、カーソルの横に来る(範囲には収める)', () => {
    expect(pickTarget('cursor', ctx({ cursor: { x: 1000, y: 500 } }))!.x).toBe(800)
    expect(pickTarget('cursor', ctx({ cursor: { x: 5, y: 500 } }))!.x).toBe(20)
    expect(pickTarget('cursor', ctx({ cursor: { x: 1919, y: 500 } }))!.x).toBe(1500)
  })

  it('複数の画面: 「すべて」なら、幅に比例して画面を選ぶ。「いまの画面だけ」なら、動かない。作業領域が無ければ null', () => {
    const two = [WORK1, WORK2]
    const second = pickTarget('random', ctx({ works: two, rng: () => 0.9 }))!
    expect(second.x).toBeGreaterThanOrEqual(1920 + 20) // 0.9 × 3200 = 2880 → 2 つ目の画面
    const same = pickTarget('random', ctx({ works: two, rng: () => 0.9, settings: { area: 'current', margin: 20, freeVertical: false } }))!
    expect(same.x).toBeLessThanOrEqual(1500)
    expect(pickTarget('random', ctx({ works: [] }))).toBeNull()
    // カーソルが 2 つ目の画面にあれば、そこへ(足元は、その画面の下)
    const c = pickTarget('cursor', ctx({ works: two, cursor: { x: 2500, y: 300 } }))!
    expect(c.x).toBe(2300)
    expect(c.y).toBe(380) // WORK2 の maxY = 1000 - 600 - 20
  })

  it('いまの作業領域: いちばん重なっている画面', () => {
    expect(currentWorkArea({ x: 1800, y: 100, width: 400, height: 600 }, [WORK1, WORK2])).toBe(WORK2)
    expect(currentWorkArea({ x: 100, y: 100, width: 400, height: 600 }, [WORK1, WORK2])).toBe(WORK1)
  })
})

describe('歩く・ワープする', () => {
  it('歩く時間: 距離 ÷ 速さ。短すぎる移動は、下限(0.4 秒)', () => {
    expect(walkDurationMs({ x: 0, y: 0 }, { x: 440, y: 0 }, 220)).toBe(2000)
    expect(walkDurationMs({ x: 0, y: 0 }, { x: 10, y: 0 }, 220)).toBe(400)
  })

  it('なめらかな動き: 始めと終わりが、ゆっくり。途中の位置は、直線上', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.1)).toBeLessThan(0.1)
    expect(positionAt({ x: 0, y: 0 }, { x: 100, y: 50 }, 500, 1000)).toEqual({ x: 50, y: 25 })
    expect(positionAt({ x: 0, y: 0 }, { x: 100, y: 50 }, 2000, 1000)).toEqual({ x: 100, y: 50 })
  })

  it('歩く向き: 右へ歩けば右向き(正)、左へなら左向き。ほとんど縦の移動は、正面', () => {
    expect(facingYaw({ x: 0, y: 0 }, { x: 300, y: 0 })).toBe(70)
    expect(facingYaw({ x: 300, y: 0 }, { x: 0, y: 0 })).toBe(-70)
    expect(facingYaw({ x: 0, y: 0 }, { x: 20, y: 400 })).toBe(0)
    expect(facingYaw({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(0)
  })

  it('ワープの段階: 消える → 移る → 現れる → 終わり。不透明度は、1 → 0 → 1', () => {
    expect(warpAt(0, 300)).toEqual({ phase: 'out', opacity: 1 })
    expect(warpAt(150, 300).opacity).toBeCloseTo(0.5, 5)
    expect(warpAt(310, 300)).toEqual({ phase: 'jump', opacity: 0 })
    expect(warpAt(330 + 150, 300).phase).toBe('in')
    expect(warpAt(330 + 150, 300).opacity).toBeCloseTo(0.5, 5)
    expect(warpAt(10_000, 300)).toEqual({ phase: 'done', opacity: 1 })
  })

  it('自動の移動: 待ち時間は、最短〜最長の間(逆に書いても同じ)。方式は、ワープの割合で決まる', () => {
    expect(nextRoamDelayMs({ roamMinSec: 10, roamMaxSec: 20 }, () => 0)).toBe(10_000)
    expect(nextRoamDelayMs({ roamMinSec: 10, roamMaxSec: 20 }, () => 1)).toBe(20_000)
    expect(nextRoamDelayMs({ roamMinSec: 20, roamMaxSec: 10 }, () => 0.5)).toBe(15_000)
    expect(pickAutoMode(0.2, () => 0.1)).toBe('warp')
    expect(pickAutoMode(0.2, () => 0.5)).toBe('walk')
    expect(pickAutoMode(0, () => 0)).toBe('walk')
  })
})

describe('上下に動かないとき、高さは変わらない(歩きながら、斜め上へずれない)', () => {
  it('窓の下端が、作業領域の下端ぎりぎり(余白の外)でも、高さは、そのまま', () => {
    const low = { x: 100, y: 1040 - 600 + 15, width: 400, height: 600 } // 下端が、作業領域の下端を 15px はみ出す位置
    for (const kind of ['random', 'left', 'right', 'center', 'cursor'] as const) {
      expect(pickTarget(kind, ctx({ window: low }))!.y, kind).toBe(low.y)
    }
  })

  it('別の画面へ移るときは、移動先の画面の中に収める。上下に動く設定でも、収める', () => {
    const two = [WORK1, WORK2]
    expect(pickTarget('cursor', ctx({ works: two, cursor: { x: 2500, y: 300 } }))!.y).toBe(380)
    expect(pickTarget('random', ctx({ rng: () => 0, settings: { area: 'all', margin: 20, freeVertical: true } }))!.y).toBe(20)
  })
})

describe('移動範囲(画面上で決めた矩形)', () => {
  const area = { x: 200, y: 300, width: 1200, height: 700 }

  it('矩形と作業領域の重なりだけを使う。重ならない矩形は、捨てる', () => {
    expect(rectWorks([area], [WORK1])).toEqual([area])
    expect(rectWorks([{ x: 1800, y: 100, width: 400, height: 300 }], [WORK1, WORK2])).toEqual([
      { x: 1800, y: 100, width: 120, height: 300 },
      { x: 1920, y: 100, width: 280, height: 300 }
    ])
    expect(rectWorks([{ x: 5000, y: 0, width: 100, height: 100 }], [WORK1, WORK2])).toEqual([])
  })

  it('矩形の中に、窓が収まる位置を選ぶ(余白なし)。高さも、矩形の中へ収める', () => {
    const works = rectWorks([area], [WORK1])
    for (const r of [0, 0.5, 0.999]) {
      const p = pickTarget('random', ctx({ works, constrained: true, rng: () => r }))!
      expect(p.x).toBeGreaterThanOrEqual(200)
      expect(p.x + 400).toBeLessThanOrEqual(1400)
      expect(p.y).toBeGreaterThanOrEqual(300)
      expect(p.y + 600).toBeLessThanOrEqual(1000)
    }
    expect(pickTarget('left', ctx({ works, constrained: true }))!.x).toBe(200)
    expect(pickTarget('right', ctx({ works, constrained: true }))!.x).toBe(1000)
  })

  it('矩形が窓より小さいときは、中央に寄せる', () => {
    const small = rectWorks([{ x: 500, y: 900, width: 300, height: 100 }], [WORK1])
    const p = pickTarget('random', ctx({ works: small, constrained: true }))!
    expect(p).toEqual({ x: 450, y: 650 }) // 矩形の中心(650, 950)が、窓の中心(450+200, 650+300)に来る
  })

  it('設定: 矩形は、壊れた項目・小さすぎるものを捨てて、8 個まで。ワープの演出は、色・数を丸める', () => {
    const s = MoveSchema.parse({
      rects: [{ x: 1, y: 2, width: 300, height: 200 }, { x: 'a' }, { x: 0, y: 0, width: 5, height: 500 }, ...Array.from({ length: 20 }, () => ({ x: 0, y: 0, width: 100, height: 100 }))],
      areaMode: 'rects',
      warpFx: { colors: ['red', '#FF00AA', '#00ff00'], count: 999, shape: 'ない', durationMs: 1, mode: 'burst' }
    })
    expect(s.rects).toHaveLength(8)
    expect(s.rects[0]).toEqual({ x: 1, y: 2, width: 300, height: 200 })
    expect(s.areaMode).toBe('rects')
    expect(s.warpFx.colors).toEqual(['#ff00aa', '#00ff00'])
    expect(s.warpFx.count).toBe(80)
    expect(s.warpFx.shape).toBe('star')
    expect(s.warpFx.durationMs).toBe(300)
    expect(MoveSchema.parse({}).warpFx).toMatchObject({ enabled: true, where: 'both', mode: 'burst' })
    expect(MoveSchema.parse({ areaMode: 'x', rects: 'x' })).toMatchObject({ areaMode: 'display', rects: [] })
  })
})
