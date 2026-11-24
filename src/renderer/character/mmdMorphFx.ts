import * as THREE from 'three'
import type { PmxObject } from '@moeru/three-mmd'
import { applyMaterialMorphs, clampState, effectiveWeights, hasNonVertexMorphs, touchedMaterials, uvOffsets, type MaterialState, type MorphDef } from '@shared/mmd/morphEffects'

/**
 * PMX の、頂点モーフ以外のモーフ(材質モーフ・UV モーフ)の適用。
 * @moeru/three-mmd は、頂点モーフ(と、頂点モーフだけのグループ)しか、モーフターゲットにしない。
 * 服消し(材質の不透明度を下げる)・ハート目(目のテクスチャの位置をずらす)は、ここで動かす。
 * 毎フレーム、mesh.morphTargetInfluences(モーション・調整・表情の結果)を読み、グループを展開して、効く重みを出し、材質・UV へ反映する。
 * 重みが前のフレームと同じなら、何もしない。
 */

/** three-mmd の材質(MMDToonMaterial)のうち、ここで使う部分 */
interface MorphableMaterial extends THREE.Material {
  descriptor?: { diffuse: THREE.Color; specular: THREE.Color; ambient: THREE.Color; opacity: number; shininess: number }
  applyMMDMaterialState?: (state: unknown) => void
}

const v4 = (a: readonly number[]): THREE.Vector4 => new THREE.Vector4(a[0], a[1], a[2], a[3])
const toSrgb = (c: THREE.Color): [number, number, number] => {
  const o = { r: 0, g: 0, b: 0 }
  c.getRGB(o as THREE.Color, THREE.SRGBColorSpace)
  return [o.r, o.g, o.b]
}
const fromSrgb = (rgb: readonly number[]): THREE.Color => new THREE.Color().setRGB(rgb[0]!, rgb[1]!, rgb[2]!, THREE.SRGBColorSpace)

export class MmdMorphFx {
  private readonly defs: MorphDef[]
  private readonly mats: MorphableMaterial[]
  private readonly bases = new Map<number, MaterialState>()
  private readonly uv: THREE.BufferAttribute | null
  private readonly uvBase: Float32Array | null
  private dirtyUv = new Set<number>()
  private last: Float32Array | null = null
  /** 材質の状態が、基準から変わっているか(全部のモーフが 0 に戻ったとき、基準へ戻すため) */
  private modified = false

  /** 対象が無い(材質モーフも UV モーフも持たない)モデルでは、作らない */
  static create(mesh: THREE.SkinnedMesh, pmx: PmxObject): MmdMorphFx | null {
    const defs = pmx.morphs as unknown as MorphDef[]
    return hasNonVertexMorphs(defs) ? new MmdMorphFx(mesh, defs) : null
  }

  private constructor(mesh: THREE.SkinnedMesh, defs: MorphDef[]) {
    this.defs = defs
    this.mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MorphableMaterial[]
    for (const i of touchedMaterials(defs, this.mats.length)) {
      const d = this.mats[i]?.descriptor
      if (!d || !this.mats[i]?.applyMMDMaterialState) continue
      this.bases.set(i, {
        diffuse: [...toSrgb(d.diffuse), d.opacity],
        specular: toSrgb(d.specular),
        shininess: d.shininess,
        ambient: toSrgb(d.ambient),
        textureMul: [1, 1, 1, 1],
        textureAdd: [0, 0, 0, 0],
        sphereMul: [1, 1, 1, 1],
        sphereAdd: [0, 0, 0, 0],
        toonMul: [1, 1, 1, 1],
        toonAdd: [0, 0, 0, 0]
      })
    }
    const hasUv = defs.some((d) => d.type === 3)
    const uv = hasUv ? (mesh.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined) : undefined
    this.uv = uv ?? null
    this.uvBase = uv ? new Float32Array(uv.array as Float32Array) : null
  }

  /** 材質モーフ・UV モーフを、いまの重みで反映する(毎フレーム) */
  update(influences: ArrayLike<number>): void {
    const eff = effectiveWeights(this.defs, influences)
    if (this.last && this.last.length === eff.length && this.last.every((v, i) => v === eff[i])) return
    this.last = eff
    this.applyMaterials(eff)
    this.applyUv(eff)
  }

  private applyMaterials(eff: Float32Array): void {
    const any = eff.some((w, i) => w !== 0 && this.defs[i]?.type === 8)
    if (!any && !this.modified) return
    this.modified = any
    for (const [i, base] of this.bases) {
      const m = this.mats[i]!
      const s = clampState(applyMaterialMorphs(base, i, this.defs, eff))
      m.applyMMDMaterialState!({
        diffuse: fromSrgb(s.diffuse),
        specular: fromSrgb(s.specular),
        ambient: fromSrgb(s.ambient),
        opacity: s.diffuse[3],
        shininess: s.shininess,
        edgeAlpha: 0,
        edgeColor: new THREE.Color(0),
        edgeWidth: 0,
        textureMultiplicativeColor: v4(s.textureMul),
        textureAdditiveColor: v4(s.textureAdd),
        sphereTextureMultiplicativeColor: v4(s.sphereMul),
        sphereTextureAdditiveColor: v4(s.sphereAdd),
        toonTextureMultiplicativeColor: v4(s.toonMul),
        toonTextureAdditiveColor: v4(s.toonAdd)
      })
    }
  }

  private applyUv(eff: Float32Array): void {
    const uv = this.uv
    const base = this.uvBase
    if (!uv || !base) return
    const offsets = uvOffsets(this.defs, eff)
    if (offsets.size === 0 && this.dirtyUv.size === 0) return
    const arr = uv.array as Float32Array
    for (const v of this.dirtyUv) {
      arr[v * 2] = base[v * 2]!
      arr[v * 2 + 1] = base[v * 2 + 1]!
    }
    this.dirtyUv = new Set(offsets.keys())
    for (const [v, [du, dv]] of offsets) {
      arr[v * 2] = base[v * 2]! + du
      arr[v * 2 + 1] = base[v * 2 + 1]! + dv
    }
    uv.needsUpdate = true
  }

  /** モデルを外すとき: UV を元に戻す(材質は、モデルごと破棄される) */
  dispose(): void {
    if (this.uv && this.uvBase) {
      ;(this.uv.array as Float32Array).set(this.uvBase)
      this.uv.needsUpdate = true
    }
  }
}
