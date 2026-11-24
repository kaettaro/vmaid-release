import * as THREE from 'three'
import { MToonMaterial } from '@pixiv/three-vrm'
import { kelvinToRgb, lightPosition, type RealParams, type ResolvedBeautify, type ToonParams } from '@shared/beautify'
import { PostFx, type PostParams } from './postFx'

/** ステージの既定のライトの明るさ(1.0 = 美化しないときと同じ明るさ)。VRM と MMD で、基準が違う */
export interface LightBaseline {
  directional: number
  ambient: number
}

interface MToonSnapshot {
  shift: number
  toony: number
  rimColor: THREE.Color
  rimMix: number
  rimFresnel: number
  rimLift: number
  outlineWidth: number
}

/**
 * 美化(機能 Mod「美化(リアル)」「美化(トゥーン)」)の描画側。ステージ(VRM / MMD)が持つ、ライト・材質・描画を差し替える。
 * - OFF(null)にすると、変えたものを、すべて元に戻す。
 * - 透過ウィンドウのクリック判定(描画直後にアルファを読む)を壊さないよう、アルファは変えない(postFx.ts)。
 * - 材質の調整(陰影・縁の光・輪郭線)は、VRM の MToon だけ。MMD の材質は、ライトと後処理だけで整える。
 */
export class BeautifyRig {
  private spec: ResolvedBeautify = null
  private root: THREE.Object3D | null = null
  private post: PostFx | null = null
  private readonly group = new THREE.Group()
  private readonly key = new THREE.DirectionalLight(0xffffff, 1)
  private readonly fill = new THREE.DirectionalLight(0xffffff, 0)
  private readonly rim = new THREE.DirectionalLight(0xffffff, 0)
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0)
  private readonly keyTarget = new THREE.Object3D()
  private readonly mtoon = new Map<MToonMaterial, MToonSnapshot>()
  private readonly shadowFlags = new Map<THREE.Mesh, { cast: boolean; receive: boolean }>()
  private postParams: PostParams | null = null
  /** 各光源の向き(モデルの中心から光源への単位ベクトル)。位置は、モデルの大きさに合わせて fitShadow で決める */
  private readonly dirs = { key: new THREE.Vector3(0, 0, 1), fill: new THREE.Vector3(0, 0, 1), rim: new THREE.Vector3(0, 0, 1) }

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly baseLights: readonly THREE.Light[],
    private readonly baseline: LightBaseline
  ) {
    this.group.visible = false
    this.key.target = this.keyTarget
    this.fill.target = this.keyTarget
    this.rim.target = this.keyTarget
    this.group.add(this.key, this.fill, this.rim, this.ambient, this.keyTarget)
    this.scene.add(this.group)
    this.baseIntensity = new Map(baseLights.map((l) => [l, l.intensity]))
  }

  private readonly baseIntensity: Map<THREE.Light, number>

  get active(): boolean {
    return this.spec !== null
  }

  /** モデルが変わった(読み込み直し)。材質・影の設定を、新しいモデルに合わせ直す */
  setRoot(root: THREE.Object3D | null): void {
    this.restoreMaterials()
    this.root = root
    if (this.spec) this.applyMaterials()
    this.fitShadow()
  }

  apply(spec: ResolvedBeautify): void {
    this.spec = spec
    if (!spec) {
      this.restoreAll()
      return
    }
    this.group.visible = true
    for (const l of this.baseLights) l.intensity = 0 // 既定のライトは消して、美化のライトに置き換える
    if (spec.mode === 'real') this.applyReal(spec.p)
    else this.applyToon(spec.p)
    this.applyMaterials()
    this.fitShadow()
  }

  private applyReal(p: RealParams): void {
    const { directional: d, ambient: a } = this.baseline
    const [kr, kg, kb] = kelvinToRgb(p.keyTemp)
    this.key.color.setRGB(kr, kg, kb)
    this.key.intensity = d * p.keyIntensity
    this.dirs.key.set(...lightPosition(p.keyAzimuth, p.keyElevation))
    // 補助光は、主光と反対側から、少し冷たい色で影を起こす
    this.fill.color.setRGB(0.8, 0.88, 1)
    this.fill.intensity = d * p.fillIntensity
    this.dirs.fill.set(...lightPosition(-p.keyAzimuth - 30, 10))
    // 輪郭光は、背後の上から、主光と同じ側の縁を光らせる
    this.rim.color.setRGB(kr, kg, kb)
    this.rim.intensity = d * p.rimIntensity
    this.dirs.rim.set(...lightPosition(180 - p.keyAzimuth * 0.6, 35))
    this.ambient.color.setRGB(1, 1, 1)
    this.ambient.intensity = a * p.ambient
    this.key.castShadow = p.shadow
    this.key.shadow.intensity = p.shadowStrength
    this.renderer.shadowMap.enabled = p.shadow
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.postParams = { exposure: p.exposure, tonemap: p.tonemap, saturation: p.saturation, bloom: p.bloom, bloomThreshold: p.bloomThreshold, bloomRadius: p.bloomRadius }
  }

  private applyToon(p: ToonParams): void {
    const { directional: d, ambient: a } = this.baseline
    this.key.color.setRGB(1, 1, 1)
    this.key.intensity = d * p.lightIntensity
    this.dirs.key.set(...lightPosition(p.lightAzimuth, p.lightElevation))
    this.fill.intensity = 0
    this.rim.intensity = 0
    this.ambient.color.setRGB(1, 1, 1)
    this.ambient.intensity = a * p.ambient
    this.key.castShadow = false
    this.renderer.shadowMap.enabled = false
    this.postParams = { exposure: 1, tonemap: 'none', saturation: p.saturation, bloom: 0, bloomThreshold: 1, bloomRadius: 0 }
  }

  private forEachMaterial(fn: (m: THREE.Material, mesh: THREE.Mesh) => void): void {
    this.root?.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) fn(m, mesh)
    })
  }

  private applyMaterials(): void {
    const spec = this.spec
    if (!spec || !this.root) return
    const wantShadow = spec.mode === 'real' && spec.p.shadow
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      if (!this.shadowFlags.has(mesh)) this.shadowFlags.set(mesh, { cast: mesh.castShadow, receive: mesh.receiveShadow })
      mesh.castShadow = wantShadow
      mesh.receiveShadow = wantShadow
    })
    this.forEachMaterial((m) => {
      if (!(m instanceof MToonMaterial)) return
      if (!this.mtoon.has(m)) {
        this.mtoon.set(m, {
          shift: m.shadingShiftFactor,
          toony: m.shadingToonyFactor,
          rimColor: m.parametricRimColorFactor.clone(),
          rimMix: m.rimLightingMixFactor,
          rimFresnel: m.parametricRimFresnelPowerFactor,
          rimLift: m.parametricRimLiftFactor,
          outlineWidth: m.outlineWidthFactor
        })
      }
      const o = this.mtoon.get(m)!
      if (spec.mode === 'real') {
        // リアル寄り: 陰影の境目をなめらかにする
        m.shadingToonyFactor = o.toony * (1 - 0.85 * spec.p.softShading)
        m.shadingShiftFactor = o.shift - 0.12 * spec.p.softShading
      } else {
        const t = spec.p
        m.shadingToonyFactor = Math.max(0.05, t.shadeEdge)
        m.shadingShiftFactor = o.shift - t.shadeShift * 0.5
        // 縁の光(リムライト)
        m.parametricRimColorFactor = new THREE.Color(t.rim * 0.7, t.rim * 0.7, t.rim * 0.7)
        m.parametricRimFresnelPowerFactor = 4
        m.parametricRimLiftFactor = 0
        m.rimLightingMixFactor = 1
        m.outlineWidthFactor = o.outlineWidth * t.outline
      }
      m.needsUpdate = true
    })
    // 影の ON/OFF が変わると、シェーダーを作り直す必要がある
    this.forEachMaterial((m) => (m.needsUpdate = true))
  }

  /** 影のカメラを、モデルの大きさに合わせる(踊って動いても収まるよう、余裕をもたせる) */
  private fitShadow(): void {
    const box = this.root ? new THREE.Box3().setFromObject(this.root) : null
    const hasBox = !!box && !box.isEmpty()
    const c = hasBox ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 1, 0)
    const r = hasBox ? Math.max(0.1, box.getSize(new THREE.Vector3()).length() * 0.5 * 1.25) : 1.5
    this.keyTarget.position.copy(c)
    const cam = this.key.shadow.camera
    cam.left = -r
    cam.right = r
    cam.top = r
    cam.bottom = -r
    cam.near = 0.01
    cam.far = r * 6
    cam.updateProjectionMatrix()
    this.key.shadow.mapSize.set(2048, 2048)
    this.key.shadow.bias = -0.0004
    this.key.shadow.normalBias = r * 0.012
    // 光源の位置は、モデルの中心から、向きに距離をかけたところ(すべて、中心を向く)
    this.key.position.copy(c).addScaledVector(this.dirs.key, r * 3)
    this.fill.position.copy(c).addScaledVector(this.dirs.fill, r * 3)
    this.rim.position.copy(c).addScaledVector(this.dirs.rim, r * 3)
  }

  private restoreMaterials(): void {
    for (const [m, o] of this.mtoon) {
      m.shadingShiftFactor = o.shift
      m.shadingToonyFactor = o.toony
      m.parametricRimColorFactor = o.rimColor
      m.rimLightingMixFactor = o.rimMix
      m.parametricRimFresnelPowerFactor = o.rimFresnel
      m.parametricRimLiftFactor = o.rimLift
      m.outlineWidthFactor = o.outlineWidth
      m.needsUpdate = true
    }
    this.mtoon.clear()
    for (const [mesh, f] of this.shadowFlags) {
      mesh.castShadow = f.cast
      mesh.receiveShadow = f.receive
    }
    this.shadowFlags.clear()
  }

  private restoreAll(): void {
    this.restoreMaterials()
    this.group.visible = false
    for (const [l, i] of this.baseIntensity) l.intensity = i
    this.renderer.shadowMap.enabled = false
    this.key.castShadow = false
    this.postParams = null
    this.forEachMaterial((m) => (m.needsUpdate = true))
  }

  /** 毎フレームの描画。後処理が要らないときは、ふつうに描く(重くしない) */
  render(camera: THREE.Camera): void {
    const p = this.postParams
    const needsPost = !!p && (p.bloom > 0.001 || p.tonemap !== 'none' || Math.abs(p.exposure - 1) > 0.001 || Math.abs(p.saturation - 1) > 0.001)
    if (!needsPost || !p) {
      this.renderer.render(this.scene, camera)
      return
    }
    this.post ??= new PostFx(this.renderer)
    this.post.render(this.scene, camera, p)
  }

  dispose(): void {
    this.apply(null)
    this.scene.remove(this.group)
    this.key.shadow.dispose()
    this.post?.dispose()
    this.post = null
  }
}
