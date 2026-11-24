// MMD(PMX)のモーフのうち、頂点モーフ以外(材質モーフ・UV モーフ)の計算。Electron・three.js に依存しない純粋ロジック。
// 服消し(材質モーフで、材質の不透明度を下げる)・ハート目やぐるぐる目(UV モーフで、目のテクスチャの位置をずらす)を動かすために使う。
// 頂点モーフと、頂点モーフだけを含むグループは、@moeru/three-mmd がモーフターゲットにしてくれる。足りないのは、それ以外の種類。

/** PmxObject.Morph.Type の値 */
export const MORPH_GROUP = 0
export const MORPH_UV = 3
export const MORPH_UV_ADDITIONAL_LAST = 7
export const MORPH_MATERIAL = 8
/** 材質モーフの演算(PmxObject.Morph.MaterialMorph.Type) */
export const MATERIAL_MUL = 0
export const MATERIAL_ADD = 1

type Vec = readonly number[]

export interface MaterialMorphElement {
  /** 材質の番号。-1 は、すべての材質 */
  index: number
  /** 0 = 乗算 / 1 = 加算 */
  type: number
  diffuse: Vec
  specular: Vec
  shininess: number
  ambient: Vec
  textureColor: Vec
  sphereTextureColor: Vec
  toonTextureColor: Vec
}

/** モーフ 1 つ分の、計算に要る部分(PmxObject.Morph の写し) */
export interface MorphDef {
  type: number
  /** グループ: 子のモーフの番号と割合 / UV: 頂点の番号 */
  indices?: ArrayLike<number>
  ratios?: ArrayLike<number>
  /** UV: 頂点ごとの 4 つ組(u, v, 追加 UV の 3, 4) */
  offsets?: ArrayLike<number>
  elements?: ReadonlyArray<MaterialMorphElement>
}

const MAX_GROUP_DEPTH = 4

/**
 * 各モーフの、実際に効く重み。グループは、子へ(重み × 割合で)展開する。グループ自身は 0 になる(効くのは子)。
 * 入れ子は 4 段まで。自分自身を指す循環は無視する。
 */
export function effectiveWeights(defs: ReadonlyArray<MorphDef>, influences: ArrayLike<number>): Float32Array {
  const eff = new Float32Array(defs.length)
  const add = (i: number, w: number, depth: number, trail: ReadonlySet<number>): void => {
    const d = defs[i]
    if (!d || w === 0) return
    if (d.type === MORPH_GROUP) {
      if (depth >= MAX_GROUP_DEPTH || trail.has(i)) return
      const next = new Set(trail).add(i)
      const n = d.indices?.length ?? 0
      for (let k = 0; k < n; k++) add(d.indices![k]!, w * (d.ratios?.[k] ?? 1), depth + 1, next)
    } else eff[i] += w
  }
  for (let i = 0; i < defs.length; i++) {
    const w = influences[i] ?? 0
    if (w !== 0) add(i, w, 0, new Set())
  }
  return eff
}

/** 材質の見た目の状態(three-mmd の MMDMaterialEvaluatedState の、数値版。色は sRGB の 0〜1) */
export interface MaterialState {
  diffuse: [number, number, number, number]
  specular: [number, number, number]
  shininess: number
  ambient: [number, number, number]
  textureMul: [number, number, number, number]
  textureAdd: [number, number, number, number]
  sphereMul: [number, number, number, number]
  sphereAdd: [number, number, number, number]
  toonMul: [number, number, number, number]
  toonAdd: [number, number, number, number]
}

export const cloneState = (s: MaterialState): MaterialState => ({
  diffuse: [...s.diffuse],
  specular: [...s.specular],
  shininess: s.shininess,
  ambient: [...s.ambient],
  textureMul: [...s.textureMul],
  textureAdd: [...s.textureAdd],
  sphereMul: [...s.sphereMul],
  sphereAdd: [...s.sphereAdd],
  toonMul: [...s.toonMul],
  toonAdd: [...s.toonAdd]
})

/** この材質に効く(重みが 0 でない)材質モーフの要素を集めて、計算する材質の番号の集合を返す */
export function touchedMaterials(defs: ReadonlyArray<MorphDef>, materialCount: number): Set<number> {
  const out = new Set<number>()
  for (const d of defs) {
    if (d.type !== MORPH_MATERIAL) continue
    for (const e of d.elements ?? []) {
      if (e.index === -1) for (let i = 0; i < materialCount; i++) out.add(i)
      else if (e.index >= 0 && e.index < materialCount) out.add(e.index)
    }
  }
  return out
}

const lerp1 = (offset: number, w: number): number => 1 + (offset - 1) * w

/**
 * 材質モーフを重ねる。MMD の意味: 最終 = 基準 × (乗算の積) + (加算の和)。
 * 乗算は、重み w のとき、1 と値の間(1 + (値 − 1) × w)。加算は、値 × w。
 * 複数のモーフが同時に効くと、合算される(例: 「ドレスオフ」で +1、「ブラオフ」で −1 なら、元に戻る)。
 * 不透明度は、合算が終わってから、0〜1 に丸める(途中で丸めると、−1 と +1 が打ち消し合わない)。色は、呼ぶ側が丸める。
 */
export function applyMaterialMorphs(base: MaterialState, materialIndex: number, defs: ReadonlyArray<MorphDef>, eff: ArrayLike<number>): MaterialState {
  const s = cloneState(base)
  const mulD: number[] = [1, 1, 1, 1]
  const addD: number[] = [0, 0, 0, 0]
  const mulS: number[] = [1, 1, 1]
  const addS: number[] = [0, 0, 0]
  let mulShin = 1
  let addShin = 0
  const mulA: number[] = [1, 1, 1]
  const addA: number[] = [0, 0, 0]
  const texMul = [1, 1, 1, 1]
  const texAdd = [0, 0, 0, 0]
  const sphMul = [1, 1, 1, 1]
  const sphAdd = [0, 0, 0, 0]
  const toonMul = [1, 1, 1, 1]
  const toonAdd = [0, 0, 0, 0]
  let touched = false
  for (let m = 0; m < defs.length; m++) {
    const d = defs[m]!
    const w = eff[m] ?? 0
    if (d.type !== MORPH_MATERIAL || w === 0) continue
    for (const e of d.elements ?? []) {
      if (e.index !== -1 && e.index !== materialIndex) continue
      touched = true
      if (e.type === MATERIAL_MUL) {
        for (let i = 0; i < 4; i++) mulD[i]! *= lerp1(e.diffuse[i] ?? 1, w)
        for (let i = 0; i < 3; i++) mulS[i]! *= lerp1(e.specular[i] ?? 1, w)
        mulShin *= lerp1(e.shininess, w)
        for (let i = 0; i < 3; i++) mulA[i]! *= lerp1(e.ambient[i] ?? 1, w)
        for (let i = 0; i < 4; i++) {
          texMul[i]! *= lerp1(e.textureColor[i] ?? 1, w)
          sphMul[i]! *= lerp1(e.sphereTextureColor[i] ?? 1, w)
          toonMul[i]! *= lerp1(e.toonTextureColor[i] ?? 1, w)
        }
      } else {
        for (let i = 0; i < 4; i++) addD[i]! += (e.diffuse[i] ?? 0) * w
        for (let i = 0; i < 3; i++) addS[i]! += (e.specular[i] ?? 0) * w
        addShin += e.shininess * w
        for (let i = 0; i < 3; i++) addA[i]! += (e.ambient[i] ?? 0) * w
        for (let i = 0; i < 4; i++) {
          texAdd[i]! += (e.textureColor[i] ?? 0) * w
          sphAdd[i]! += (e.sphereTextureColor[i] ?? 0) * w
          toonAdd[i]! += (e.toonTextureColor[i] ?? 0) * w
        }
      }
    }
  }
  if (!touched) return s
  for (let i = 0; i < 4; i++) s.diffuse[i] = base.diffuse[i]! * mulD[i]! + addD[i]!
  for (let i = 0; i < 3; i++) s.specular[i] = base.specular[i]! * mulS[i]! + addS[i]!
  s.shininess = base.shininess * mulShin + addShin
  for (let i = 0; i < 3; i++) s.ambient[i] = base.ambient[i]! * mulA[i]! + addA[i]!
  for (let i = 0; i < 4; i++) {
    s.textureMul[i] = base.textureMul[i]! * texMul[i]!
    s.textureAdd[i] = base.textureAdd[i]! + texAdd[i]!
    s.sphereMul[i] = base.sphereMul[i]! * sphMul[i]!
    s.sphereAdd[i] = base.sphereAdd[i]! + sphAdd[i]!
    s.toonMul[i] = base.toonMul[i]! * toonMul[i]!
    s.toonAdd[i] = base.toonAdd[i]! + toonAdd[i]!
  }
  return s
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** 描画に渡す前の丸め(不透明度・色を 0〜1 へ、光沢は 0 以上へ) */
export function clampState(s: MaterialState): MaterialState {
  const c = cloneState(s)
  for (let i = 0; i < 4; i++) c.diffuse[i] = clamp01(c.diffuse[i]!)
  for (let i = 0; i < 3; i++) {
    c.specular[i] = clamp01(c.specular[i]!)
    c.ambient[i] = clamp01(c.ambient[i]!)
  }
  c.shininess = Math.max(0, c.shininess)
  return c
}

/** UV モーフの、頂点ごとの offset の和(u, v)。重みが 0 でないモーフだけ。追加 UV(4〜7)は、描画に使わないので、無視 */
export function uvOffsets(defs: ReadonlyArray<MorphDef>, eff: ArrayLike<number>): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>()
  for (let m = 0; m < defs.length; m++) {
    const d = defs[m]!
    const w = eff[m] ?? 0
    if (d.type !== MORPH_UV || w === 0 || !d.indices || !d.offsets) continue
    for (let k = 0; k < d.indices.length; k++) {
      const v = d.indices[k]!
      const cur = out.get(v) ?? [0, 0]
      cur[0] += d.offsets[k * 4]! * w
      cur[1] += d.offsets[k * 4 + 1]! * w
      out.set(v, cur)
    }
  }
  return out
}

/** UV モーフ・材質モーフが、ひとつでもあるか(無ければ、毎フレームの計算を全部省く) */
export const hasNonVertexMorphs = (defs: ReadonlyArray<MorphDef>): boolean => defs.some((d) => d.type === MORPH_UV || d.type === MORPH_MATERIAL || d.type === MORPH_GROUP)
