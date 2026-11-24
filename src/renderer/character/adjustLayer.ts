import * as THREE from 'three'
import { VRMExpressionMorphTargetBind, type VRM } from '@pixiv/three-vrm'
import {
  clampValue,
  composeExpression,
  composeWithMotion,
  defaultValues,
  expressionLabel,
  type AdjustItem,
  type AdjustSnapshot
} from '@shared/adjust'

/** モーフ1項目の適用先。同じモーフが複数メッシュ(プリミティブ)に付いている場合はまとめて動かす */
interface MorphTarget {
  meshes: THREE.Mesh[]
  index: number
  /** 表情(ブレンドシェイプ)でも使われているモーフ。表情側が毎フレーム 0 に戻して加算するため、後から足す */
  boundByExpression: boolean
}

const OUTLINE_SUFFIX = / \(Outline\)$/

const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true

/**
 * キャラ調整(SPEC 3.4)のモデル側の実体。
 * モデルが持つ表情・モーフ・メッシュ/マテリアルを自動で列挙し(モデル個別の特例は持たない)、
 * スライダー/トグルの値を「基準値」として保持して毎フレーム反映する。
 */
export class AdjustLayer {
  readonly items: AdjustItem[] = []
  private values: Record<string, number>
  private readonly exprNames: string[] = []
  private readonly morphs = new Map<string, MorphTarget>()
  private readonly visibility = new Map<string, Array<(visible: boolean) => void>>()
  private readonly itemByKey = new Map<string, AdjustItem>()
  /** 一度でも書き込んだ(0に戻す必要がある)項目 */
  private readonly dirtyExpr = new Set<string>()
  private readonly dirtyMorph = new Set<string>()
  /** ルールの setExpression 用の一時上書き(M6)。基準値より優先し、解除すると基準値に戻る */
  private readonly overrides = new Map<string, number>()

  constructor(private readonly vrm: VRM) {
    this.enumerateExpressions()
    this.enumerateMorphs()
    this.enumerateVisibility()
    this.items.forEach((i) => this.itemByKey.set(i.key, i))
    this.values = defaultValues(this.items)
  }

  // --- 列挙 ---
  private add(item: AdjustItem): void {
    this.items.push(item)
  }

  private enumerateExpressions(): void {
    for (const e of this.vrm.expressionManager?.expressions ?? []) {
      if (this.exprNames.includes(e.expressionName)) continue
      this.exprNames.push(e.expressionName)
      this.add({
        key: `expr:${e.expressionName}`,
        group: 'expression',
        label: expressionLabel(e.expressionName),
        kind: 'slider',
        defaultValue: 0
      })
    }
  }

  /** プリミティブが複数あるメッシュは three が Group にまとめるので、Group を1つの持ち主として扱う */
  private ownerOf(mesh: THREE.Mesh): THREE.Object3D {
    const p = mesh.parent
    return p && p.type === 'Group' && p.children.filter(isMesh).length > 1 ? p : mesh
  }

  private enumerateMorphs(): void {
    // 表情が使っているモーフ: mesh → index → 表情名
    const usedBy = new Map<THREE.Mesh, Map<number, Set<string>>>()
    for (const e of this.vrm.expressionManager?.expressions ?? []) {
      for (const bind of e.binds) {
        if (!(bind instanceof VRMExpressionMorphTargetBind)) continue
        for (const mesh of bind.primitives) {
          const byIndex = usedBy.get(mesh) ?? new Map<number, Set<string>>()
          const names = byIndex.get(bind.index) ?? new Set<string>()
          names.add(e.expressionName)
          byIndex.set(bind.index, names.add(e.expressionName))
          usedBy.set(mesh, byIndex)
        }
      }
    }

    const owners = new Map<THREE.Object3D, THREE.Mesh[]>()
    this.vrm.scene.traverse((o) => {
      if (isMesh(o) && o.morphTargetInfluences && o.morphTargetInfluences.length > 0) {
        const owner = this.ownerOf(o)
        owners.set(owner, [...(owners.get(owner) ?? []), o])
      }
    })

    for (const [owner, meshes] of owners) {
      const ownerName = owner.name || 'mesh'
      const dict = meshes[0].morphTargetDictionary ?? {}
      const nameByIndex = new Map(Object.entries(dict).map(([name, i]) => [i, name]))
      for (let i = 0; i < meshes[0].morphTargetInfluences!.length; i++) {
        // モデルがモーフ名を持たない場合(three が "0","1"… と番号を名前にする)は「モーフ N」と表示する
        const rawName = nameByIndex.get(i)
        const named = rawName !== undefined && !/^\d+$/.test(rawName)
        const name = named ? rawName : `#${i}`
        let key = `morph:${ownerName}#${name}`
        for (let n = 2; this.morphs.has(key); n++) key = `morph:${ownerName}#${name}~${n}`
        const exprs = new Set<string>()
        meshes.forEach((m) => usedBy.get(m)?.get(i)?.forEach((x) => exprs.add(x)))
        this.morphs.set(key, { meshes, index: i, boundByExpression: exprs.size > 0 })
        this.add({
          key,
          group: 'morph',
          label: `${ownerName} / ${named ? name : `モーフ ${i}`}`,
          hint: exprs.size > 0 ? `表情「${[...exprs].join(', ')}」でも使われています` : undefined,
          kind: 'slider',
          defaultValue: 0
        })
      }
    }
  }

  private enumerateVisibility(): void {
    const addVis = (key: string, label: string, apply: (visible: boolean) => void): void => {
      const existing = this.visibility.get(key)
      if (existing) {
        existing.push(apply)
        return
      }
      this.visibility.set(key, [apply])
      this.add({ key, group: 'visibility', label, kind: 'toggle', defaultValue: 1 })
    }
    const seenOwners = new Set<THREE.Object3D>()
    const materials: THREE.Material[] = []
    this.vrm.scene.traverse((o) => {
      if (!isMesh(o)) return
      const owner = this.ownerOf(o)
      if (!seenOwners.has(owner) && owner.name) {
        seenOwners.add(owner)
        addVis(`mesh:${owner.name}`, `メッシュ ${owner.name}`, (v) => (owner.visible = v))
      }
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.push(m)
    })
    for (const m of new Set(materials)) {
      if (!m.name) continue
      const base = m.name.replace(OUTLINE_SUFFIX, '') // 輪郭用マテリアルは本体と一緒に切り替える
      addVis(`mat:${base}`, `マテリアル ${base}`, (v) => (m.visible = v))
    }
  }

  // --- 値の操作 ---
  snapshot(modelHash: string, modelName: string): AdjustSnapshot {
    return { modelHash, modelName, items: this.items, values: { ...this.values }, presets: [] }
  }

  set(key: string, value: number): void {
    const item = this.itemByKey.get(key)
    if (!item) return
    const v = clampValue(item, value)
    this.values[key] = v
    this.visibility.get(key)?.forEach((apply) => apply(v >= 0.5))
  }

  setAll(values: Record<string, number>): void {
    for (const [k, v] of Object.entries(values)) this.set(k, v)
  }

  resetAll(): void {
    this.setAll(defaultValues(this.items))
  }

  /** ルールの setExpression 用。null で解除 */
  setExpressionOverride(name: string, value: number | null): void {
    if (value === null) this.overrides.delete(name)
    else this.overrides.set(name, value)
  }

  // --- 毎フレームの反映 ---
  /**
   * vrm.update() の前。表情を反映する。auto は自動まばたき・口パクの値(0〜1)。
   * motionTracks は、いま再生中のモーションが持つトラックの名前(表情のトラックがあれば、その値と大きいほうを採る)
   */
  beforeUpdate(auto: { blink: number; mouth: number }, motionTracks?: ReadonlySet<string> | null): void {
    const em = this.vrm.expressionManager
    if (!em) return
    for (const name of this.exprNames) {
      const base = this.values[`expr:${name}`] ?? 0
      const override = this.overrides.get(name)
      // 自動まばたきは blink、口パクは aa にだけ効かせる。基準値・上書きとの合成は composeExpression に従う
      const autoValue = name === 'blink' ? auto.blink : name === 'aa' ? auto.mouth : undefined
      let v = composeExpression(base, override, autoValue)
      const trackName = motionTracks ? em.getExpressionTrackName(name) : null
      if (trackName && motionTracks?.has(trackName)) v = composeWithMotion(v, override, em.getValue(name) ?? 0) // ミキサーが、このフレームに書いた値
      if (v > 0 || override !== undefined || name === 'blink') {
        em.setValue(name, v)
        this.dirtyExpr.add(name)
      } else if (this.dirtyExpr.delete(name)) {
        em.setValue(name, 0) // スライダーを0に戻した直後の1回だけ
      }
    }
  }

  /** vrm.update() の後。モーフを反映する(表情が先に0へ戻して加算しているので、その上に載せる) */
  afterUpdate(): void {
    for (const [key, target] of this.morphs) {
      const v = this.values[key] ?? 0
      const wasDirty = this.dirtyMorph.has(key)
      if (v <= 0 && !wasDirty) continue
      for (const mesh of target.meshes) {
        const inf = mesh.morphTargetInfluences!
        if (target.boundByExpression) inf[target.index] = Math.min(1, inf[target.index] + v)
        else inf[target.index] = v
      }
      if (v > 0) this.dirtyMorph.add(key)
      else this.dirtyMorph.delete(key)
    }
  }
}
