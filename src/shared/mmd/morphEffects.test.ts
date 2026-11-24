import { describe, expect, it } from 'vitest'
import { applyMaterialMorphs, clampState, effectiveWeights, MATERIAL_ADD, MATERIAL_MUL, MORPH_GROUP, MORPH_MATERIAL, MORPH_UV, touchedMaterials, uvOffsets, type MaterialMorphElement, type MaterialState, type MorphDef } from './morphEffects'

const state = (alpha = 1): MaterialState => ({
  diffuse: [0.8, 0.6, 0.4, alpha],
  specular: [0, 0, 0],
  shininess: 5,
  ambient: [0.5, 0.5, 0.5],
  textureMul: [1, 1, 1, 1],
  textureAdd: [0, 0, 0, 0],
  sphereMul: [1, 1, 1, 1],
  sphereAdd: [0, 0, 0, 0],
  toonMul: [1, 1, 1, 1],
  toonAdd: [0, 0, 0, 0]
})
const el = (index: number, type: number, over: Partial<MaterialMorphElement> = {}): MaterialMorphElement => ({
  index,
  type,
  diffuse: type === MATERIAL_MUL ? [1, 1, 1, 1] : [0, 0, 0, 0],
  specular: type === MATERIAL_MUL ? [1, 1, 1] : [0, 0, 0],
  shininess: type === MATERIAL_MUL ? 1 : 0,
  ambient: type === MATERIAL_MUL ? [1, 1, 1] : [0, 0, 0],
  textureColor: type === MATERIAL_MUL ? [1, 1, 1, 1] : [0, 0, 0, 0],
  sphereTextureColor: type === MATERIAL_MUL ? [1, 1, 1, 1] : [0, 0, 0, 0],
  toonTextureColor: type === MATERIAL_MUL ? [1, 1, 1, 1] : [0, 0, 0, 0],
  ...over
})
const mat = (...elements: MaterialMorphElement[]): MorphDef => ({ type: MORPH_MATERIAL, elements })
const group = (indices: number[], ratios: number[]): MorphDef => ({ type: MORPH_GROUP, indices, ratios })

describe('モーフの実効の重み(グループの展開)', () => {
  it('グループは、重み × 割合で、子へ展開する。グループ自身は 0', () => {
    const defs: MorphDef[] = [group([1, 2], [0.5, 1]), mat(), mat()]
    const eff = effectiveWeights(defs, [0.8, 0, 0.1])
    expect(eff[0]).toBe(0)
    expect(eff[1]).toBeCloseTo(0.4)
    expect(eff[2]).toBeCloseTo(0.1 + 0.8) // 自分の重みと、グループ経由の分が合わさる
  })

  it('入れ子のグループも展開する。自分を指す循環・深すぎる入れ子は、無視して、止まる', () => {
    const defs: MorphDef[] = [group([1], [1]), group([2], [0.5]), mat()]
    expect(effectiveWeights(defs, [1, 0, 0])[2]).toBeCloseTo(0.5)
    const loop: MorphDef[] = [group([1], [1]), group([0, 2], [1, 1]), mat()]
    expect(effectiveWeights(loop, [1, 0, 0])[2]).toBeCloseTo(1)
    const bad: MorphDef[] = [group([99, -1], [1, 1])]
    expect(Array.from(effectiveWeights(bad, [1]))).toEqual([0])
  })
})

describe('材質モーフ(服消し)', () => {
  it('加算: 不透明度に −1 を足すと、消える(丸めは、合算のあと)', () => {
    const defs = [mat(el(0, MATERIAL_ADD, { diffuse: [0, 0, 0, -1] }))]
    const s = applyMaterialMorphs(state(), 0, defs, [1])
    expect(s.diffuse[3]).toBe(0)
    expect(applyMaterialMorphs(state(), 0, defs, [0.5]).diffuse[3]).toBeCloseTo(0.5)
    expect(applyMaterialMorphs(state(), 1, defs, [1]).diffuse[3]).toBe(1) // 別の材質には効かない
  })

  it('合算: 「ドレスオフ」の +1 と「ブラオフ」の −1 が同時に効くと、元に戻る。範囲外の値のまま持つ', () => {
    const defs = [mat(el(0, MATERIAL_ADD, { diffuse: [0, 0, 0, 1] })), mat(el(0, MATERIAL_ADD, { diffuse: [0, 0, 0, -1] }))]
    expect(applyMaterialMorphs(state(0), 0, defs, [1, 1]).diffuse[3]).toBe(0)
    expect(applyMaterialMorphs(state(0), 0, defs, [1, 0]).diffuse[3]).toBe(1)
    expect(applyMaterialMorphs(state(0), 0, defs, [0, 1]).diffuse[3]).toBe(-1) // 丸める前
    expect(clampState(applyMaterialMorphs(state(0), 0, defs, [0, 1])).diffuse[3]).toBe(0)
    // 基準が 0 の材質(初めは見えない)に +1 で、現れる
    expect(clampState(applyMaterialMorphs(state(0), 0, [defs[0]!], [1])).diffuse[3]).toBe(1)
  })

  it('乗算: 重みに応じて、1 と値の間。加算と同時なら、基準 × 積 + 和', () => {
    const defs = [mat(el(0, MATERIAL_MUL, { diffuse: [0.5, 1, 1, 1] })), mat(el(0, MATERIAL_ADD, { diffuse: [0.1, 0, 0, 0] }))]
    expect(applyMaterialMorphs(state(), 0, defs, [1, 0]).diffuse[0]).toBeCloseTo(0.4)
    expect(applyMaterialMorphs(state(), 0, defs, [0.5, 0]).diffuse[0]).toBeCloseTo(0.8 * 0.75)
    expect(applyMaterialMorphs(state(), 0, defs, [1, 1]).diffuse[0]).toBeCloseTo(0.8 * 0.5 + 0.1)
  })

  it('テクスチャ・トゥーンの色の加算・乗算も、重ねる。全材質(-1)の要素は、どの材質にも効く', () => {
    const defs = [mat(el(-1, MATERIAL_ADD, { textureColor: [0.2, 0.2, 0.2, 0], toonTextureColor: [0, 0, 0, 0.3] }))]
    const s = applyMaterialMorphs(state(), 5, defs, [1])
    expect(s.textureAdd[0]).toBeCloseTo(0.2)
    expect(s.toonAdd[3]).toBeCloseTo(0.3)
    expect(touchedMaterials(defs, 3)).toEqual(new Set([0, 1, 2]))
    expect(touchedMaterials([mat(el(1, MATERIAL_ADD), el(9, MATERIAL_ADD))], 3)).toEqual(new Set([1]))
  })

  it('効くモーフが無ければ、基準のまま(コピー)', () => {
    const b = state()
    const s = applyMaterialMorphs(b, 0, [mat(el(0, MATERIAL_ADD, { diffuse: [0, 0, 0, -1] }))], [0])
    expect(s).toEqual(b)
    expect(s).not.toBe(b)
  })
})

describe('UV モーフ(ハート目・ぐるぐる目)', () => {
  it('頂点ごとの offset を、重みを掛けて足す。重み 0 のモーフ・追加 UV は、無視', () => {
    const uv = (v: number[], off: number[]): MorphDef => ({ type: MORPH_UV, indices: v, offsets: off })
    const defs = [uv([3, 4], [0.5, 0, 0, 0, -0.5, 0.25, 0, 0]), uv([3], [0.1, 0.1, 0, 0]), { type: 4, indices: [3], offsets: [9, 9, 0, 0] }]
    const m = uvOffsets(defs, [1, 0.5, 1])
    expect(m.get(3)![0]).toBeCloseTo(0.55)
    expect(m.get(3)![1]).toBeCloseTo(0.05)
    expect(m.get(4)).toEqual([-0.5, 0.25])
    expect(uvOffsets(defs, [0, 0, 0]).size).toBe(0)
  })

  it('グループ経由(「ハート目」= 頂点モーフ + UV モーフ)でも、UV モーフに重みが届く', () => {
    const defs: MorphDef[] = [group([1, 2], [1, 1]), { type: 1 }, { type: MORPH_UV, indices: [0], offsets: [0.5, 0, 0, 0] }]
    expect(uvOffsets(defs, effectiveWeights(defs, [1, 0, 0])).get(0)).toEqual([0.5, 0])
  })
})
