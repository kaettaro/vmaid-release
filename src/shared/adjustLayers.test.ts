import { describe, expect, it } from 'vitest'
import { composeLayers, defaultValues, presetToValues, pushLayer, removeLayers, type AdjustItem, type AdjustLayer } from './adjust'

const items: AdjustItem[] = [
  { key: 'morph:face#CatEar', group: 'morph', label: '猫耳', kind: 'slider', defaultValue: 0 },
  { key: 'morph:face#HeartEye', group: 'morph', label: 'ハート目', kind: 'slider', defaultValue: 0 },
  { key: 'mat:Coat', group: 'visibility', label: '上着', kind: 'toggle', defaultValue: 1 },
  { key: 'mat:Dress', group: 'visibility', label: 'ドレス', kind: 'toggle', defaultValue: 1 }
]
const base = defaultValues(items)
const layer = (id: string, values: Record<string, number>, mode: AdjustLayer['mode'] = 'overlay', source: string | null = null): AdjustLayer => ({ id, source, mode, values })

describe('調整の差分レイヤー', () => {
  it('レイヤーなしなら、基準値のまま', () => {
    expect(composeLayers(items, { 'morph:face#CatEar': 0.4 }, [])).toEqual({ ...base, 'morph:face#CatEar': 0.4 })
  })

  it('猫耳 + ハート目 + 衣装(別々のセット)を、重ねて同時に効かせる', () => {
    const out = composeLayers(items, base, [layer('猫耳', { 'morph:face#CatEar': 1 }), layer('ハート目', { 'morph:face#HeartEye': 1 }), layer('ドレス', { 'mat:Coat': 0 })])
    expect(out).toEqual({ 'morph:face#CatEar': 1, 'morph:face#HeartEye': 1, 'mat:Coat': 0, 'mat:Dress': 1 })
  })

  it('同じモーフは大きいほうが勝つ(順番によらない)', () => {
    const a = composeLayers(items, base, [layer('a', { 'morph:face#CatEar': 0.8 }), layer('b', { 'morph:face#CatEar': 0.3 })])
    const b = composeLayers(items, base, [layer('b', { 'morph:face#CatEar': 0.3 }), layer('a', { 'morph:face#CatEar': 0.8 })])
    expect(a['morph:face#CatEar']).toBe(0.8)
    expect(b['morph:face#CatEar']).toBe(0.8)
  })

  it('基準値のほうが大きければ、基準値が残る', () => {
    expect(composeLayers(items, { 'morph:face#CatEar': 0.9 }, [layer('a', { 'morph:face#CatEar': 0.3 })])['morph:face#CatEar']).toBe(0.9)
  })

  it('表示は、後から重ねたものが勝つ', () => {
    const out = composeLayers(items, base, [layer('a', { 'mat:Coat': 0 }), layer('b', { 'mat:Coat': 1 })])
    expect(out['mat:Coat']).toBe(1)
  })

  it('置き換え(replace)は、それまでのレイヤーを見えなくする。外すと元に戻る', () => {
    const cat = layer('猫耳', { 'morph:face#CatEar': 1 })
    const full = layer('衣装', presetToValues(items, { 'mat:Coat': 0 }), 'replace')
    expect(composeLayers(items, base, [cat, full])['morph:face#CatEar']).toBe(0)
    expect(composeLayers(items, base, [cat])['morph:face#CatEar']).toBe(1)
  })

  it('存在しない項目と、範囲外の値は無視・丸める', () => {
    const out = composeLayers(items, base, [layer('x', { 'morph:face#None': 1, 'morph:face#CatEar': 5 })])
    expect(out['morph:face#CatEar']).toBe(1)
    expect('morph:face#None' in out).toBe(false)
  })

  it('pushLayer: 同じ id は1つだけで、いちばん上に移る', () => {
    const l = pushLayer(pushLayer([], layer('a', {})), layer('b', {}))
    expect(pushLayer(l, layer('a', {})).map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('removeLayers: 名前・Mod・すべて', () => {
    const l = [layer('a', {}, 'overlay', 'mod-x'), layer('b', {}, 'overlay', 'mod-y'), layer('c', {}, 'overlay', null)]
    expect(removeLayers(l, { name: 'b' }).map((x) => x.id)).toEqual(['a', 'c'])
    expect(removeLayers(l, { source: 'mod-x' }).map((x) => x.id)).toEqual(['b', 'c'])
    expect(removeLayers(l, {})).toEqual([])
  })
})
