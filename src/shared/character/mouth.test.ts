import { describe, expect, it } from 'vitest'
import { defaultMouthOptions, MouthController } from './mouth'

describe('MouthController', () => {
  it('喋っていなければ閉じたまま', () => {
    const m = new MouthController(() => 0.5)
    for (let i = 0; i < 60; i++) expect(m.update(1 / 60, false)).toBe(0)
  })
  it('喋っている間は開閉し、常に 0〜maxOpen に収まる', () => {
    const m = new MouthController(Math.random)
    let max = 0
    let min = 1
    for (let i = 0; i < 600; i++) {
      const v = m.update(1 / 60, true)
      max = Math.max(max, v)
      min = Math.min(min, v)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(defaultMouthOptions.maxOpen)
    }
    expect(max).toBeGreaterThan(0.2) // 実際に開く
    expect(min).toBeLessThan(0.2) // 閉じる瞬間もある
  })
  it('喋り終わると口が閉じていく', () => {
    const m = new MouthController(() => 0.9)
    for (let i = 0; i < 30; i++) m.update(1 / 60, true)
    for (let i = 0; i < 60; i++) m.update(1 / 60, false)
    expect(m.update(1 / 60, false)).toBeLessThan(0.01)
  })
  it('dt が巨大でも発散しない', () => {
    const m = new MouthController(() => 0.9)
    expect(m.update(100, true)).toBeLessThanOrEqual(defaultMouthOptions.maxOpen)
  })
})
