import { describe, expect, it } from 'vitest'
import { BeautifyPatchSchema, BeautifySchema, exclusiveOff, kelvinToRgb, lightPosition, presetValues, resolveBeautify, RealSchema } from './beautify'

describe('設定の整え方', () => {
  it('空でも既定値が入る', () => {
    const s = BeautifySchema.parse({})
    expect(s.real.tonemap).toBe('aces')
    expect(s.real.shadow).toBe(true)
    expect(s.toon.outline).toBe(1)
  })
  it('範囲外・不正な値は、範囲内か既定へ戻る', () => {
    const r = RealSchema.parse({ keyIntensity: 99, exposure: -5, tonemap: 'x', bloom: 'a', keyAzimuth: Infinity })
    expect(r.keyIntensity).toBe(3)
    expect(r.exposure).toBe(0.4)
    expect(r.tonemap).toBe('aces')
    expect(r.bloom).toBe(0.2)
  })
  it('パッチは、知らない項目名を受け付けない', () => {
    expect(BeautifyPatchSchema.safeParse({ real: { bloom: 0.5 } }).success).toBe(true)
    expect(BeautifyPatchSchema.safeParse({ other: {} }).success).toBe(false)
  })
})

describe('プリセット', () => {
  it('プリセットは全項目が埋まり、名前が入る', () => {
    const p = presetValues('real', 'cinematic')
    expect(p.preset).toBe('cinematic')
    expect(p).toMatchObject({ keyTemp: 4400 })
    expect(presetValues('toon', 'nothing').preset).toBe('anime')
  })
})

describe('どちらを使うか', () => {
  const base = BeautifySchema.parse({})
  it('両方 OFF なら null、片方 ON ならそれ、両方 ON ならトゥーン', () => {
    expect(resolveBeautify({ ...base, realEnabled: false, toonEnabled: false })).toBeNull()
    expect(resolveBeautify({ ...base, realEnabled: true, toonEnabled: false })?.mode).toBe('real')
    expect(resolveBeautify({ ...base, realEnabled: true, toonEnabled: true })?.mode).toBe('toon')
  })
  it('片方を ON にするとき、もう片方を OFF にする', () => {
    expect(exclusiveOff('beautify-real')).toBe('beautify-toon')
    expect(exclusiveOff('beautify-toon')).toBe('beautify-real')
    expect(exclusiveOff('music')).toBeNull()
  })
})

describe('光の計算', () => {
  it('色温度: 低いと暖かく(赤が強い)、高いと青い', () => {
    const warm = kelvinToRgb(3000)
    const cool = kelvinToRgb(9000)
    expect(warm[0]).toBeGreaterThan(warm[2])
    expect(cool[2]).toBeGreaterThan(cool[0])
    expect(kelvinToRgb(6600)).toEqual([1, expect.closeTo(1, 1), 1])
  })
  it('光の向き: 正面・真上・右', () => {
    expect(lightPosition(0, 0)[2]).toBeCloseTo(1)
    expect(lightPosition(0, 90)[1]).toBeCloseTo(1)
    expect(lightPosition(90, 0)[0]).toBeCloseTo(1)
  })
})
