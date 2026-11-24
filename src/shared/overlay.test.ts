import { describe, expect, it } from 'vitest'
import { BUILTIN_EFFECT_NAMES, builtinEffect, characterOverlayBounds, expandRect, OVERLAY_DEFAULTS, OVERLAY_MAX_SEC, parseEffectYaml, sanitizeOverlayRequest, toPayload, warpEffectSpec } from './overlay'

describe('sanitizeOverlayRequest', () => {
  it('正しい指示は、そのまま通る(色は小文字にそろう)', () => {
    expect(sanitizeOverlayRequest({ effect: 'pink-fog', intensity: 0.3, color: '#FF00AA', durationSec: 10, scope: 'character' })).toEqual({
      effect: 'pink-fog',
      intensity: 0.3,
      color: '#ff00aa',
      durationSec: 10,
      scope: 'character'
    })
  })
  it('省略した項目は既定値で補う(色は空=効果の主な色、範囲は画面全体)', () => {
    expect(sanitizeOverlayRequest({ effect: 'spiral' })).toEqual(OVERLAY_DEFAULTS)
  })
  it('範囲外の数値は丸め、不正な色は空に、知らない範囲は画面全体にする', () => {
    const r = sanitizeOverlayRequest({ effect: 'fade', intensity: 9, color: 'red; background:url(x)', durationSec: 99999, scope: 'galaxy' })
    expect(r).toEqual({ effect: 'fade', intensity: 1, color: '', durationSec: OVERLAY_MAX_SEC, scope: 'screen' })
    expect(sanitizeOverlayRequest({ effect: 'fade', intensity: -1, durationSec: -5 })).toMatchObject({ intensity: 0, durationSec: 0 })
  })
  it('効果の名前の形が不正・形の違う入力は null', () => {
    expect(sanitizeOverlayRequest({ effect: '../etc' })).toBeNull()
    expect(sanitizeOverlayRequest({ effect: 'A B' })).toBeNull()
    expect(sanitizeOverlayRequest({ effect: '' })).toBeNull()
    expect(sanitizeOverlayRequest(null)).toBeNull()
    expect(sanitizeOverlayRequest('spiral')).toBeNull()
  })
})

describe('効果の定義(YAML)', () => {
  it('組み込みの効果は、すべて検証に通る(渦巻き・ピンクの霧など)', () => {
    expect(BUILTIN_EFFECT_NAMES).toEqual(expect.arrayContaining(['spiral', 'pink-fog', 'hearts', 'rings', 'pulse', 'vignette', 'fade']))
    for (const n of BUILTIN_EFFECT_NAMES) expect(builtinEffect(n), n).not.toBeNull()
  })
  it('省略した項目は既定値で補う', () => {
    const r = parseEffectYaml('layers:\n  - { type: spiral }\n')
    expect(r.errors).toEqual([])
    expect(r.spec).toMatchObject({ color: '#b388ff', layers: [{ type: 'spiral', color: 'main', arms: 2, speed: 0.08 }] })
  })
  it('範囲外・知らない種類・空のレイヤーは、場所つきのエラーになる', () => {
    expect(parseEffectYaml('layers:\n  - { type: pulse, hz: 5 }\n').errors.join()).toContain('layers.0.hz')
    expect(parseEffectYaml('layers:\n  - { type: strobe }\n').spec).toBeNull()
    expect(parseEffectYaml('layers: []\n').errors.join()).toContain('1つ以上')
    expect(parseEffectYaml('layers:\n  - { type: fill, color: red }\n').errors.join()).toContain('色')
    expect(parseEffectYaml('layers: [').spec).toBeNull()
  })
  it('レイヤーは 6 個まで、点滅につながる速さ(spiral の回転・pulse の周波数)には上限がある', () => {
    const many = `layers:\n${'  - { type: fill }\n'.repeat(7)}`
    expect(parseEffectYaml(many).spec).toBeNull()
    expect(parseEffectYaml('layers:\n  - { type: spiral, speed: 2 }\n').spec).toBeNull()
  })
  it('toPayload: 色の指定が無ければ、効果の主な色を使う', () => {
    const spec = builtinEffect('pink-fog')!
    expect(toPayload({ ...OVERLAY_DEFAULTS, effect: 'pink-fog' }, spec).color).toBe('#ff8ac8')
    expect(toPayload({ ...OVERLAY_DEFAULTS, effect: 'pink-fog', color: '#112233' }, spec).color).toBe('#112233')
  })
})

describe('characterOverlayBounds', () => {
  it('キャラのウィンドウを、左右に 80%・上下に 30% ずつ広げる', () => {
    expect(characterOverlayBounds({ x: 1000, y: 400, width: 400, height: 600 })).toEqual({ x: 680, y: 220, width: 1040, height: 960 })
  })
})

describe('ワープの演出', () => {
  const fx = { shape: 'heart', colors: ['#ff5fa2', '#ffd166'], count: 50, size: 24, durationMs: 4000, mode: 'burst', speed: 0.4, gravity: 0.2 }
  it('設定から、粒のレイヤー 1 枚の効果を作る(色・形・動き・時間が入る)', () => {
    const spec = warpEffectSpec(fx)
    expect(spec.layers).toHaveLength(1)
    expect(spec.layers[0]).toMatchObject({ type: 'particles', shape: 'heart', emit: 'burst', count: 50, colors: ['#ff5fa2', '#ffd166'], lifeSec: 4 })
  })
  it('不正な値でも、粒の効果は作れる(壊れた設定で落ちない)', () => {
    const spec = warpEffectSpec({ ...fx, shape: 'nope', count: 9999, colors: [] })
    expect(spec.layers[0]?.type).toBe('particles')
  })
  it('矩形を広げる(窓の大きさの割合だけ、四方へ)', () => {
    expect(expandRect({ x: 100, y: 100, width: 400, height: 600 }, 0.3)).toEqual({ x: -20, y: -80, width: 640, height: 960 })
  })
})
