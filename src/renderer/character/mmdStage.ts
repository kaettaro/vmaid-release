import * as THREE from 'three'
import { ChaseDriver, type ChaseSettings } from '@shared/chase'
import { applyEyeChase, applyHeadChase } from './chaseBones'
import { clampSeek, type PlaybackInfo } from '@shared/motions/playback'
import { fixToonTextures } from './mmdToon'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMAnimationLoaderPlugin, type VRMAnimation } from '@pixiv/three-vrm-animation'
import { vrmaToMmd } from '@shared/motions/vrmaToMmd'
import { DEFAULT_GROUND_LIFT, stepGroundLift, type GroundLiftParams } from '@shared/character/groundLift'
import { MmdMorphFx } from './mmdMorphFx'
import { MMDLoader, VMDLoader, buildAnimation, type MMD } from '@moeru/three-mmd'
import { MMDAmmoPlugin } from '@moeru/three-mmd-physics-ammo'
import { sanitizeProfile, type AdjustItem, type AdjustSnapshot } from '@shared/adjust'
import type { ModelFile, MotionState } from '@shared/ipc'
import { clampPitch, stepPitch, stepYaw, wrapDeg, type Orientation } from '@shared/character/yaw'
import { classifyTouch, touchBonesOf, type CustomTouchPart, type Point2, type TouchResult } from '@shared/touch/parts'
import { HUMANOID_TO_MMD, TOUCH_BONE_MMD, isVmd, morphCandidates } from '@shared/mmd/names'
import type { PropSpec } from '@shared/packs/manifest'
import type { PropPayload } from '@shared/props/formats'
import { BUILTIN_MOTION_DEFS } from '@shared/motions/builtin'
import { armRestFromBones, buildMmdBuiltinClip, type ArmRest } from '@shared/motions/mmdBuiltin'
import { PoseBlender } from '@shared/character/poseBlender'
import { PropLayer } from './propLayer'
import { BeautifyRig } from './beautifyRig'
import type { ResolvedBeautify } from '@shared/beautify'
import type { CharacterStage } from './stage'

// MMD 対応 Mod のステージ。PMX を @moeru/three-mmd で読み込み、VMD のモーションを再生し、Bullet 物理(ammo)を動かす。
// このファイルは、動的 import で、MMD 対応 Mod が ON で PMX を読むときだけ読み込まれる(ammo の WebAssembly も、ここから)。
// 足の接地補正は、MMD では使わない(VRM 用)。

const FOV = 30
const HIT_ALPHA_THRESHOLD = 10
const HIT_RECHECK_FRAMES = 6
const HEADROOM = 0.2
const FOOT_MARGIN = 0.04
/** VRMA の再生中、関節が、窓の下端(-1)よりこの高さ(正規化デバイス座標)より下に出ないように、モデルを持ち上げる(体の厚みの分の余裕) */
const VIEW_BOTTOM_NDC = -0.88
const MAX_FRAME_SEC = 1 / 20
/** 読み込み済みの VMD のクリップの上限(大きいので、少なめ) */
const MAX_LOADED_CLIPS = 12
/** MMD のボーン名(日本語)と、触れ合いの判定で使う部位の骨 */
const TOUCH_BONES: Record<string, string> = {
  leftUpperArm: '左腕',
  leftLowerArm: '左ひじ',
  leftHand: '左手首',
  rightUpperArm: '右腕',
  rightLowerArm: '右ひじ',
  rightHand: '右手首',
  leftUpperLeg: '左足',
  rightUpperLeg: '右足',
  leftFoot: '左足首',
  rightFoot: '右足首'
}

/** クリップが動かす骨の名前(トラック名 `.bones[名前].quaternion` / `.position` から) */
function boneNamesOf(clip: THREE.AnimationClip): Set<string> {
  const out = new Set<string>()
  for (const t of clip.tracks) {
    const m = /^\.bones\[(.+)\]\.(?:quaternion|position)$/.exec(t.name)
    if (m) out.add(m[1])
  }
  return out
}

export class MmdStage implements CharacterStage {
  readonly kind = 'mmd' as const
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 2 / 3, 0.1, 1000)
  private readonly timer = new THREE.Timer()
  private mmd: MMD | null = null
  private mixer: THREE.AnimationMixer | null = null
  private bounds: THREE.Box3 | null = null
  private pointer: { x: number; y: number } | null = null
  private pointerDirty = false
  private yawTarget = 0
  private fitLocked = false
  private yawCurrent = 0
  private pitchTarget = 0
  private pitchCurrent = 0
  private fittedYaw = 0
  private fittedPitch = 0
  private frame = 0
  private hit = false
  private rafId = 0
  /** Mod が宣言した触れ合いの部位 */
  private touchParts: readonly CustomTouchPart[] = []
  /** 追いかけ(機能 Mod): カーソルの方を向く */
  private readonly chase = new ChaseDriver()
  private chaseCursor: { x: number; y: number } | null = null
  /** 追いかけで足す、体の向き(度。保存する向きには混ぜない) */
  private chaseBodyYaw = 0

  // --- モーション(VMD) ---
  private motionNames = new Set<string>()
  /** 登録された VMD の名前(これ以外の内蔵名は、内蔵の手続き生成から、骨のクリップを作る) */
  private vmdNames = new Set<string>()
  /** このモデルの、腕の基準姿勢(A ポーズ補正。内蔵モーション用) */
  private armRest: ArmRest = { left: 0, right: 0 }
  private motionsByTag = new Map<string, string[]>()
  private idleMotion: string | null = null
  /** VMD ではないと分かったモーション(VRMA など。MMD のモデルでは再生できない) */
  private readonly notVmd = new Set<string>()
  private vrmaParser: GLTFLoader | null = null
  /** 再生中のクリップが VRMA 由来(足 IK を切る) */
  private ikOff = false
  private groundBones: THREE.Object3D[] = []
  private groundLift = 0
  private readonly tmpVec = new THREE.Vector3()
  private clips = new Map<string, THREE.AnimationClip>()
  private readonly loadingClips = new Map<string, Promise<THREE.AnimationClip | null>>()
  private motionGeneration = 0
  /** モーションの切り替えを、いまの姿勢からなめらかに移す(標準機能) */
  private readonly blender = new PoseBlender()
  /** 直前のモーションが動かしていた骨の名前(切り替えで、これらも、いまの姿勢から補間する) */
  private lastBoneNames = new Set<string>()
  private oneShot: { action: THREE.AnimationAction; timer: ReturnType<typeof setTimeout> | null; name: string; finish: () => void } | null = null

  // --- 調整(モーフ・材質の表示)と、表情・口・まばたき ---
  private morphIndex = new Map<string, number>()
  /** 頂点モーフ以外のモーフ(材質・UV)の適用。無いモデルでは null */
  private morphFx: MmdMorphFx | null = null
  /** 再生中のモーション(VMD)が、値を決めているモーフ(番号)。それ以外は、調整・表情・まばたき・口が、毎フレーム、値を決める */
  private animatedMorphs = new Set<number>()
  private adjustItems: AdjustItem[] = []
  private adjustValues: Record<string, number> = {}
  private readonly materialByKey = new Map<string, THREE.Material>()
  private readonly overrides = new Map<string, { value: number; timer: ReturnType<typeof setTimeout>; source: string | null }>()
  /** 追加オブジェクト層(Mod の小道具)。MMD の座標は、モデルごとに大きさが違うので、身長を 1.6m として、メートルを換算する */
  private readonly props = new PropLayer(
    (name) => this.mmd?.mesh.skeleton.getBoneByName(HUMANOID_TO_MMD[name] ?? name) ?? null,
    () => (this.bounds ? this.bounds.getSize(new THREE.Vector3()).y / 1.6 : 1)
  )
  private blinkAt = 0
  private blinkPhase = -1
  private speakUntil = 0
  private speaking = false

  speechSource: (() => { level: number | null; speaking: boolean }) | null = null
  onHitChange: (hit: boolean) => void = () => {}
  onLayout: (headTopPx: number | null) => void = () => {}
  motionLoader: (name: string) => Promise<Uint8Array | null> = async () => null
  onMotionError: (name: string) => void = () => {}

  /** 単発モーションが実際に始まった・終わったとき(音楽を同時に始める・止めるため)。再生を破棄された要求では呼ばれない */
  onMotionStart: (name: string) => void = () => {}
  onMotionEnd: (name: string) => void = () => {}

  /** 美化の描画(OFF のときは、ふつうに描く) */
  private readonly beautify: BeautifyRig

  setBeautify(spec: ResolvedBeautify): void {
    this.beautify.apply(spec)
  }

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    const light = new THREE.DirectionalLight(0xffffff, 1.6)
    light.position.set(1, 1.5, 2).normalize()
    const ambient = new THREE.AmbientLight(0xffffff, 0.9)
    this.scene.add(light, ambient)
    this.beautify = new BeautifyRig(this.renderer, this.scene, [light, ambient], { directional: 1.6, ambient: 0.9 })
    this.resize()
    window.addEventListener('resize', this.resize)
    this.rafId = requestAnimationFrame(this.tick)
  }

  get hasModel(): boolean {
    return this.mmd !== null
  }

  get isHit(): boolean {
    return this.hit
  }

  // ------------------------------------------------------------ 読み込み
  async loadFile(file: ModelFile, rawProfile: unknown): Promise<AdjustSnapshot | null> {
    if (file.kind !== 'pmx' || !file.url) throw new Error('PMX 以外のモデルは、このステージでは読み込めません')
    const loader = new MMDLoader()
    loader.register(MMDAmmoPlugin)
    const t0 = performance.now()
    const mmd = await loader.loadAsync(file.url)
    const t1 = performance.now()
    const mesh = mmd.mesh
    mesh.frustumCulled = false
    // 透明度 0 の部分が、奥の描画を隠す(深度の書き込み)のを避ける(ストッキングなどに穴が見える対策)
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      m.alphaTest = Math.max(m.alphaTest, 0.01)
      m.needsUpdate = true
    }
    void fixToonTextures(mats, file.url).then((n) => n > 0 && console.info(`PMX: トゥーンの画像 ${n} 枚を補正しました`))
    this.disposeModel()
    this.mmd = mmd
    this.morphFx = MmdMorphFx.create(mesh, mmd.pmx)
    this.scene.add(mesh)
    this.mixer = new THREE.AnimationMixer(mesh)
    this.yawTarget = this.yawCurrent = this.pitchTarget = this.pitchCurrent = 0
    this.fittedYaw = this.fittedPitch = 0
    mesh.updateMatrixWorld(true)
    this.bounds = new THREE.Box3().setFromObject(mesh)
    this.beautify.setRoot(mesh)
    this.fitCamera()
    this.armRest = this.measureArmRest(mesh)
    this.collectGroundBones(mesh)
    this.startIdle()
    const snapshot = this.setupAdjust(mesh, file, rawProfile)
    const size = this.bounds.getSize(new THREE.Vector3())
    console.info(`PMX: 大きさ ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} / カメラ ${this.camera.position.toArray().map((v) => v.toFixed(1)).join(',')} near ${this.camera.near.toFixed(2)} far ${this.camera.far.toFixed(1)} / 材質 ${mats.length}`)
    const t2 = performance.now()
    await this.renderer.compileAsync(this.scene, this.camera)
    console.info(`PMX読み込み時間: パース+構築 ${Math.round(t1 - t0)}ms / 後処理 ${Math.round(t2 - t1)}ms / シェーダー ${Math.round(performance.now() - t2)}ms`)
    return snapshot
  }

  private disposeModel(): void {
    this.beautify.setRoot(null)
    this.props.clear()
    if (this.oneShot?.timer) clearTimeout(this.oneShot.timer)
    this.endOneShot()
    this.mixer?.stopAllAction()
    this.mixer = null
    this.morphFx?.dispose()
    this.morphFx = null
    if (this.mmd) {
      this.scene.remove(this.mmd.mesh)
      const mesh = this.mmd.mesh
      mesh.geometry.dispose()
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
        m.dispose()
      }
      this.mmd.dispose()
      this.mmd = null
    }
    this.clips = new Map()
  }

  // ------------------------------------------------------------ 調整(モーフ・材質の表示)
  private setupAdjust(mesh: THREE.SkinnedMesh, file: { name: string; hash: string }, rawProfile: unknown): AdjustSnapshot {
    const items: AdjustItem[] = []
    this.morphIndex = new Map()
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {})) {
      this.morphIndex.set(name, index)
      items.push({ key: `morph:${name}`, group: 'morph', label: name, kind: 'slider', defaultValue: 0 })
    }
    this.materialByKey.clear()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const base = m.name || '材質'
      let key = `mat:${base}`
      for (let n = 2; this.materialByKey.has(key); n++) key = `mat:${base}~${n}`
      this.materialByKey.set(key, m)
      items.push({ key, group: 'visibility', label: base, kind: 'toggle', defaultValue: 1 })
    }
    this.adjustItems = items
    this.adjustValues = sanitizeProfile(items, rawProfile)
    this.applyVisibility()
    return { modelHash: file.hash, modelName: file.name, items, values: { ...this.adjustValues }, presets: [] }
  }

  private applyVisibility(): void {
    for (const [key, m] of this.materialByKey) m.visible = (this.adjustValues[key] ?? 1) >= 0.5
  }

  adjustSet(key: string, value: number): void {
    this.adjustValues[key] = value
    if (key.startsWith('mat:')) this.applyVisibility()
  }

  adjustResetAll(): void {
    this.adjustValues = {}
    this.applyVisibility()
  }

  adjustSetAll(values: Record<string, number>): void {
    this.adjustValues = { ...values }
    this.applyVisibility()
  }

  /** モーフの重ねがけ: モーションが決めた値と、調整・表情の上書き・まばたき・口の、最大を取る */
  private applyMorphOverlay(now: number): void {
    const mesh = this.mmd?.mesh
    const inf = mesh?.morphTargetInfluences
    if (!mesh || !inf) return
    // いまの値を、まず、自分が決める分(調整・表情・まばたき・口)の下書きに集める
    const want = new Float32Array(inf.length)
    const put = (index: number | undefined, value: number): void => {
      if (index !== undefined && value > want[index]) want[index] = Math.min(1, value)
    }
    for (const item of this.adjustItems) {
      if (item.group !== 'morph') continue
      const v = this.adjustValues[item.key]
      if (v) put(this.morphIndex.get(item.label), v)
    }
    for (const [name, o] of this.overrides) put(this.resolveMorph(name), o.value)
    // 自動まばたき(3〜6秒おき、0.15秒)
    if (this.blinkAt === 0) this.blinkAt = now + 3000
    if (this.blinkPhase < 0 && now >= this.blinkAt) this.blinkPhase = now
    if (this.blinkPhase >= 0) {
      const t = (now - this.blinkPhase) / 150
      if (t >= 1) {
        this.blinkPhase = -1
        this.blinkAt = now + 3000 + Math.random() * 3000
      } else put(this.resolveMorph('blink'), 1 - Math.abs(2 * t - 1))
    }
    // 口: 声のレベル(あれば)、無ければ、喋っている間は、ゆっくり開閉する
    const sp = this.speechSource?.()
    const level = sp?.level ?? (this.speaking || now < this.speakUntil || sp?.speaking ? 0.35 + 0.3 * Math.sin(now / 90) : 0)
    if (level > 0) put(this.resolveMorph('aa'), Math.max(0, level))
    // モーションが決めているモーフは、大きいほうを取る。それ以外は、毎フレーム、自分の値にする(まばたきなどが、残り続けないように)
    for (let i = 0; i < inf.length; i++) {
      if (this.animatedMorphs.has(i)) {
        if (want[i] > inf[i]) inf[i] = want[i]
      } else inf[i] = want[i]
    }
  }

  /** クリップが値を決めているモーフを控える(トラック名: `….morphTargetInfluences[モーフ名]`) */
  private markAnimated(clip: THREE.AnimationClip | null): void {
    this.animatedMorphs = new Set()
    this.ikOff = clip?.userData.noIk === true
    if (!clip) return
    for (const t of clip.tracks) {
      const m = /morphTargetInfluences\[(.+)\]$/.exec(t.name)
      const i = m ? this.morphIndex.get(m[1]) : undefined
      if (i !== undefined) this.animatedMorphs.add(i)
    }
  }

  /** 表情名(VRM 風: happy など)を、このモデルにあるモーフに対応づける */
  private resolveMorph(name: string): number | undefined {
    if (this.morphIndex.has(name)) return this.morphIndex.get(name)
    for (const c of morphCandidates(name)) {
      const i = this.morphIndex.get(c)
      if (i !== undefined) return i
    }
    return undefined
  }

  setExpression(name: string, value: number, durationSec: number, source: string | null = null): void {
    const prev = this.overrides.get(name)
    if (prev) clearTimeout(prev.timer)
    this.overrides.set(name, {
      value,
      source,
      timer: setTimeout(() => this.overrides.delete(name), durationSec * 1000)
    })
  }

  async showProp(id: string, payload: PropPayload, spec: PropSpec, durationSec: number, source: string | null): Promise<void> {
    if (!this.mmd) return
    await this.props.show(id, payload, spec, durationSec, source)
  }

  hideProp(id: string): void {
    this.props.hide(id)
  }

  clearProps(): void {
    this.props.clear()
  }

  /** keep に含まれない Mod の効果(小道具・表情の上書き)を、元に戻す */
  releaseSources(keep: ReadonlySet<string>, all = false): void {
    this.props.releaseSources(keep, all)
    for (const [name, o] of [...this.overrides]) {
      if (!all && (o.source === null || keep.has(o.source))) continue
      clearTimeout(o.timer)
      this.overrides.delete(name)
    }
  }

  lipSync(durationMs: number): void {
    this.speakUntil = performance.now() + durationMs
  }

  speakStart(): void {
    this.speaking = true
  }

  speakEnd(): void {
    this.speaking = false
  }

  // ------------------------------------------------------------ 触れ合い
  setTouchParts(parts: readonly CustomTouchPart[]): void {
    this.touchParts = parts
  }

  touchAt(clientX: number, clientY: number): TouchResult | null {
    const mesh = this.mmd?.mesh
    if (!mesh) return null
    const rect = this.canvas.getBoundingClientRect()
    const project = (v: THREE.Vector3): Point2 => {
      const p = v.clone().project(this.camera)
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height }
    }
    const bones: Record<string, Point2 | undefined> = {}
    // 本体の部位の骨と、Mod が宣言した部位の骨(MMD のボーン名に直す。無い骨は飛ばす)
    const wanted = [...Object.keys(TOUCH_BONES), ...touchBonesOf(this.touchParts)]
    for (const name of wanted) {
      const mmdName = TOUCH_BONES[name] ?? TOUCH_BONE_MMD[name]
      if (!mmdName) continue
      const b = mesh.skeleton.getBoneByName(mmdName)
      if (b) bones[name] = project(b.getWorldPosition(new THREE.Vector3()))
    }
    const box = new THREE.Box3().setFromObject(mesh)
    const cx = (box.min.x + box.max.x) / 2
    const cz = (box.min.z + box.max.z) / 2
    const top = project(new THREE.Vector3(cx, box.max.y, cz))
    const bottom = project(new THREE.Vector3(cx, box.min.y, cz))
    return classifyTouch({ x: clientX, y: clientY }, bones, { top: top.y, bottom: bottom.y, centerX: top.x }, this.touchParts)
  }

  // ------------------------------------------------------------ モーション(VMD)
  setMotions(state: MotionState): void {
    this.motionGeneration++
    this.loadingClips.clear()
    // MMD のモデルで再生できるのは、登録された VMD・内蔵モーション(骨のクリップを自前で作る)・取り込んだ VRMA(PMX の骨へ変換する)
    this.vmdNames = new Set(state.vmd)
    const names = [...state.names]
    this.motionNames = new Set(names)
    this.motionsByTag = new Map()
    for (const name of names) {
      for (const tag of state.tags[name] ?? []) {
        const list = this.motionsByTag.get(tag)
        if (list) list.push(name)
        else this.motionsByTag.set(tag, [name])
      }
    }
    this.clips = new Map()
    this.idleMotion = state.idle
    if (this.mmd) this.startIdle()
  }

  hasMotion(name: string): boolean {
    return this.motionNames.has(name) && !this.notVmd.has(name)
  }

  motionsWithTag(tag: string): string[] {
    return (this.motionsByTag.get(tag) ?? []).filter((n) => !this.notVmd.has(n))
  }

  /** 待機モーション(VMD のとき)を、ループで流す。VMD でなければ、立ったまま */
  private startIdle(blend = true): void {
    const name = this.idleMotion
    if (!name || !this.motionNames.has(name)) return
    void this.ensureClip(name).then((clip) => {
      if (!clip || !this.mixer || this.oneShot || this.idleMotion !== name) return
      if (blend) this.beginBlend(clip)
      this.mixer.stopAllAction()
      this.markAnimated(clip)
      const action = this.mixer.clipAction(clip)
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.reset().play()
    })
  }

  playMotion(name: string, opts?: { durationSec?: number; queue?: boolean; interrupt?: boolean }): void {
    if (!this.hasMotion(name)) return
    void this.ensureClip(name).then((clip) => {
      const mixer = this.mixer
      if (!clip || !mixer) return
      if (this.oneShot?.timer) clearTimeout(this.oneShot.timer)
      this.endOneShot() // 別のモーションに切り替わる: 前のモーションの曲を止める
      this.beginBlend(clip) // いまの姿勢から、このモーションの最初の姿勢へ、なめらかに移す
      mixer.stopAllAction()
      this.markAnimated(clip)
      const action = mixer.clipAction(clip)
      const loops = opts?.durationSec !== undefined && opts.durationSec > clip.duration
      action.setLoop(loops ? THREE.LoopRepeat : THREE.LoopOnce, loops ? Infinity : 1)
      action.clampWhenFinished = false
      action.reset().play()
      this.mmd?.physics?.reset?.() // 急にポーズが変わるので、髪・服の揺れを、リセットする(飛び散り防止)
      const finish = (): void => {
        if (this.oneShot?.action !== action) return
        mixer.removeEventListener('finished', finish)
        if (this.oneShot.timer) clearTimeout(this.oneShot.timer)
        this.endOneShot()
        // 終わった姿勢から、待機(または立ち姿)へ、なめらかに戻る(pose() で、いきなり初期姿勢にならないように)
        const idleClip = this.idleMotion ? this.clips.get(this.idleMotion) ?? null : null
        this.beginBlend(idleClip)
        action.stop()
        this.markAnimated(null)
        this.mmd?.mesh.pose()
        this.startIdle(false)
      }
      mixer.addEventListener('finished', finish)
      const timer = loops ? setTimeout(finish, (opts?.durationSec ?? 0) * 1000) : null
      this.oneShot = { action, timer, name, finish }
      this.onMotionStart(name)
    })
  }

  /**
   * いまの姿勢を覚えて、次のフレームから、新しい姿勢へなめらかに移す。補間する骨は、直前のモーションと、次のモーション(clip)が動かす骨。
   * 物理で動く髪・服の骨は、モーションが動かさないので、補間しない
   */
  private beginBlend(clip: THREE.AnimationClip | null): void {
    const skeleton = this.mmd?.mesh.skeleton
    if (!skeleton) return
    const names = new Set(this.lastBoneNames)
    if (clip) for (const n of boneNamesOf(clip)) names.add(n)
    const nodes: THREE.Object3D[] = []
    for (const n of names) {
      const bone = skeleton.getBoneByName(n)
      if (bone) nodes.push(bone)
    }
    this.blender.begin(nodes)
    this.lastBoneNames = clip ? boneNamesOf(clip) : new Set()
  }

  /** 単発モーションの記録を外し、終わりを通知する(曲を止める) */
  private endOneShot(): void {
    const cur = this.oneShot
    if (!cur) return
    this.oneShot = null
    this.onMotionEnd(cur.name)
  }

  /** 腕の基準姿勢を、骨の位置から測る(上腕→ひじが、水平からどれだけ下がっているか) */
  private measureArmRest(mesh: THREE.SkinnedMesh): ArmRest {
    const pos = (name: string): { x: number; y: number } | null => {
      const bone = mesh.skeleton.getBoneByName(name)
      if (!bone) return null
      const v = bone.getWorldPosition(new THREE.Vector3())
      return { x: v.x, y: v.y }
    }
    const side = (upper: string, lower: string): number => {
      const a = pos(upper)
      const b = pos(lower)
      return a && b ? armRestFromBones(a, b) : 0
    }
    return { left: side('左腕', '左ひじ'), right: side('右腕', '右ひじ') }
  }

  /** 内蔵モーションの名前から、このモデルの骨のクリップを作る(内蔵でなければ null) */
  private buildBuiltinClip(name: string, mesh: THREE.SkinnedMesh): THREE.AnimationClip | null {
    const def = BUILTIN_MOTION_DEFS.find((d) => d.name === name)
    if (!def) return null
    const boneNames = new Set(mesh.skeleton.bones.map((b) => b.name))
    const built = buildMmdBuiltinClip(def, this.armRest, boneNames)
    const tracks: THREE.KeyframeTrack[] = built.rotations.map((r) => new THREE.QuaternionKeyframeTrack(`.bones[${r.bone}].quaternion`, built.times, r.quats))
    const center = mesh.skeleton.getBoneByName('センター')
    if (built.centerLift && center) {
      // 位置の単位は、モデルごとに違う。身長を 1.6m として、メートルを換算する
      const unit = this.bounds ? this.bounds.getSize(new THREE.Vector3()).y / 1.6 : 1
      const values = built.centerLift.flatMap((dy) => [center.position.x, center.position.y + dy * unit, center.position.z])
      tracks.push(new THREE.VectorKeyframeTrack('.bones[センター].position', built.times, values))
    }
    return new THREE.AnimationClip(name, built.durationSec, tracks)
  }

  /** VRMA を、このモデルの骨のクリップにする(VRM の正規化ボーンの回転を、PMX の骨へ。腕は A ポーズ補正。脚は FK なので、再生中は IK を切る)。VRMA として読めなければ null */
  private async buildVrmaClip(name: string, data: Uint8Array, mesh: THREE.SkinnedMesh): Promise<THREE.AnimationClip | null> {
    if (data.byteLength === 0) return null
    this.vrmaParser ??= (() => {
      const l = new GLTFLoader()
      l.register((parser) => new VRMAnimationLoaderPlugin(parser))
      return l
    })()
    let anim: VRMAnimation | undefined
    try {
      const gltf = await this.vrmaParser.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, '')
      anim = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0]
    } catch {
      return null
    }
    if (!anim) return null
    const rotations = new Map<string, { times: ArrayLike<number>; values: ArrayLike<number> }>()
    for (const [bone, t] of anim.humanoidTracks.rotation) rotations.set(bone, { times: t.times, values: t.values })
    const hipsTrack = anim.humanoidTracks.translation.get('hips')
    // 腰の高さ(床から股関節まで): hips の移動を、このモデルの単位へ換算する。「下半身」は腰の位置で股関節より高いので使わず、足の付け根(左足・右足)を、基準姿勢(再生中の姿勢ではなく)で測る
    const hipsHeight = this.hipJointHeight(mesh)
    const r = vrmaToMmd(
      {
        durationSec: anim.duration,
        rotations,
        hips: hipsTrack ? { times: hipsTrack.times, values: hipsTrack.values } : null,
        restHips: [anim.restHipsPosition.x, anim.restHipsPosition.y, anim.restHipsPosition.z]
      },
      { modelBones: new Set(mesh.skeleton.bones.map((b) => b.name)), armRest: this.armRest, hipsHeight, horizontalLimit: this.groundParams().maxLift * 0.3 }
    )
    const tracks: THREE.KeyframeTrack[] = r.rotations.map((t) => new THREE.QuaternionKeyframeTrack(`.bones[${t.bone}].quaternion`, t.times, t.quats))
    const center = mesh.skeleton.getBoneByName('センター')
    if (r.center && center) {
      const v = r.center.values.map((x, i) => x + [center.position.x, center.position.y, center.position.z][i % 3]!)
      tracks.push(new THREE.VectorKeyframeTrack('.bones[センター].position', r.center.times, v))
    }
    if (tracks.length === 0) return null
    const clip = new THREE.AnimationClip(name, r.durationSec, tracks)
    clip.userData.noIk = true // 脚が FK のトラックなので、IK を切る(IK が、足を元の位置へ戻してしまう)
    return clip
  }

  /** 基準姿勢での、骨の高さ(boneInverses = 基準姿勢のワールド行列の逆行列。再生中の姿勢に左右されない)。無ければ null */
  private restY(mesh: THREE.SkinnedMesh, name: string): number | null {
    const i = mesh.skeleton.bones.findIndex((b) => b.name === name)
    const inv = i >= 0 ? mesh.skeleton.boneInverses[i] : undefined
    return inv ? new THREE.Matrix4().copy(inv).invert().elements[13]! : null
  }

  /** 床から股関節までの高さ(モデルの単位)。足の付け根の高さ − 外形の最下部。測れなければ、身長の 53% */
  private hipJointHeight(mesh: THREE.SkinnedMesh): number {
    const ys = ['左足', '右足'].map((n) => this.restY(mesh, n)).filter((y): y is number => y !== null)
    const floor = this.bounds?.min.y ?? 0
    if (ys.length > 0) return ys.reduce((a, b) => a + b, 0) / ys.length - floor
    return this.bounds ? this.bounds.getSize(new THREE.Vector3()).y * 0.53 : 1
  }

  /**
   * VRMA(足 IK を切った FK の再生)のとき、関節が床より下に入ったぶんだけ、モデル全体を持ち上げる(VRM の groundLift と同じ)。
   * 横になる・座る・かがむポーズは、モデルの体の比率が VRMA と違うので、足・頭が窓の下へ沈んで見切れるため。
   * VMD・内蔵モーションでは何もしない(IK が足を床に付けるので)。
   */
  private updateGroundLift(dt: number): void {
    const mesh = this.mmd?.mesh
    if (!mesh || !this.ikOff || this.groundBones.length === 0 || Math.abs(this.pitchCurrent) > 0.5) {
      this.groundLift = this.groundLift > 1e-4 ? stepGroundLift(this.groundLift, Infinity, dt, this.groundParams()) : 0
      return
    }
    mesh.updateMatrixWorld(true)
    const p = this.groundParams()
    this.camera.updateMatrixWorld()
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    let minY = Infinity
    let needView = 0
    for (const bone of this.groundBones) {
      bone.getWorldPosition(this.tmpVec)
      if (this.tmpVec.y < minY) minY = this.tmpVec.y
      // 窓の下端より下へ出る分(カメラに近づいて大きく・低く映るポーズ: 手前へ四つん這い・寝そべりなど)。持ち上げる前の位置で、画面の高さへ直す
      const depth = this.camera.position.z - this.tmpVec.z
      if (depth > 1e-3) {
        const low = this.tmpVec.clone()
        low.y -= this.groundLift
        const ndc = low.project(this.camera).y
        if (ndc < VIEW_BOTTOM_NDC) needView = Math.max(needView, (VIEW_BOTTOM_NDC - ndc) * depth * tanHalf)
      }
    }
    const needGround = Math.max(0, p.floorJointY - (minY - this.groundLift))
    // どちらか大きいほうだけ持ち上げる(stepGroundLift は、「最低の関節の高さ」から目標を出すので、その形に直して渡す)
    const need = Math.max(needGround, needView)
    this.groundLift = stepGroundLift(this.groundLift, p.floorJointY - need, dt, { ...p, riseSec: 0.1, maxLift: p.maxLift * 2 })
  }

  private groundParams(): GroundLiftParams {
    const unit = this.bounds ? this.bounds.getSize(new THREE.Vector3()).y / 1.6 : 1 // メートル → このモデルの単位
    const floor = this.bounds?.min.y ?? 0
    return { ...DEFAULT_GROUND_LIFT, floorJointY: floor + DEFAULT_GROUND_LIFT.floorJointY * unit, maxLift: DEFAULT_GROUND_LIFT.maxLift * unit }
  }

  /** 床の判定に使う骨を集める(体・腕・脚)。頭は、頭頂まで見たいので、首のつけ根の骨に、頭頂までの高さを足して判定する */
  private collectGroundBones(mesh: THREE.SkinnedMesh): void {
    const names = ['センター', '上半身', '上半身2', '首', '頭', '左肩', '右肩', '左腕', '右腕', '左ひじ', '右ひじ', '左手首', '右手首', '左足', '右足', '左ひざ', '右ひざ', '左足首', '右足首', '左つま先', '右つま先']
    this.groundBones = names.flatMap((n) => {
      const b = mesh.skeleton.getBoneByName(n)
      return b ? [b] : []
    })
    this.groundLift = 0
  }

  /** VMD を読み込んで、このモデル用のクリップにする(読み込み済みは使い回す)。VMD でなければ null(以後、対象外) */
  private ensureClip(name: string): Promise<THREE.AnimationClip | null> {
    const cached = this.clips.get(name)
    if (cached) {
      this.clips.delete(name)
      this.clips.set(name, cached) // 最近使ったものを、末尾へ
      return Promise.resolve(cached)
    }
    const pending = this.loadingClips.get(name)
    if (pending) return pending
    const generation = this.motionGeneration
    const task = (async (): Promise<THREE.AnimationClip | null> => {
      let url: string | null = null
      try {
        const builtinName = BUILTIN_MOTION_DEFS.some((d) => d.name === name) && !this.vmdNames.has(name)
        const data = builtinName ? new Uint8Array() : await this.motionLoader(name)
        if (!data) throw new Error('中身を取得できません')
        const mesh = this.mmd?.mesh
        if (!mesh) return null
        if (!this.vmdNames.has(name) || !isVmd(data)) {
          // 内蔵 → 骨のクリップを自前で作る。それ以外(取り込んだ VRMA)→ PMX の骨へ変換する
          const clip = builtinName ? this.buildBuiltinClip(name, mesh) : await this.buildVrmaClip(name, data, mesh)
          if (!clip) {
            this.notVmd.add(name) // VMD でも VRMA でも内蔵でもない(読めない)
            return null
          }
          if (generation !== this.motionGeneration) return null
          this.clips.set(name, clip)
          return clip
        }
        url = URL.createObjectURL(new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer]))
        const vmd = await new VMDLoader().loadAsync(url)
        const clip = buildAnimation(vmd, mesh)
        if (generation !== this.motionGeneration) return null
        this.clips.set(name, clip)
        for (const old of [...this.clips.keys()]) {
          if (this.clips.size <= MAX_LOADED_CLIPS) break
          this.clips.delete(old)
        }
        return clip
      } catch (e) {
        console.warn(`VMD を読めませんでした: ${name}`, e)
        this.onMotionError(name)
        return null
      } finally {
        if (url) URL.revokeObjectURL(url)
        this.loadingClips.delete(name)
      }
    })()
    this.loadingClips.set(name, task)
    return task
  }

  // ------------------------------------------------------------ 向き・カメラ・描画
  setOrientation(o: Orientation, instant = false): void {
    this.yawTarget = wrapDeg(o.yaw)
    this.pitchTarget = clampPitch(o.pitch)
    if (instant) {
      this.yawCurrent = this.yawTarget
      this.pitchCurrent = this.pitchTarget
    }
  }

  /** カメラのフィットの再計算を止める・再開する(歩いている間、体を一時的に回しても、窓の中でキャラが上下しないように) */
  setFitLocked(locked: boolean): void {
    this.fitLocked = locked
  }

  getOrientation(): Orientation {
    return { yaw: this.yawTarget, pitch: this.pitchTarget }
  }

  stopMotion(): void {
    this.oneShot?.finish()
  }

  getPlayback(): PlaybackInfo | null {
    const o = this.oneShot
    if (!o) return null
    const a = o.action
    return { name: o.name, time: a.time, duration: a.getClip().duration, looping: a.loop === THREE.LoopRepeat, paused: a.paused }
  }

  seek(sec: number): void {
    const a = this.oneShot?.action
    if (a) a.time = clampSeek(sec, a.getClip().duration)
  }

  setPaused(paused: boolean): void {
    const a = this.oneShot?.action
    if (a) a.paused = paused
  }

  setChase(settings: ChaseSettings | null): void {
    this.chase.setSettings(settings)
  }

  setChaseCursor(point: { x: number; y: number } | null): void {
    this.chaseCursor = point
  }

  /** 頭の、ウィンドウ内の位置(css px)。追いかけの、向きの基準 */
  private headClientPoint(): { x: number; y: number } | null {
    const head = this.mmd?.mesh.skeleton.getBoneByName(HUMANOID_TO_MMD['head'])
    if (!head) return null
    const v = head.getWorldPosition(new THREE.Vector3()).project(this.camera)
    const rect = this.canvas.getBoundingClientRect()
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height }
  }

  setPointer(clientX: number | null, clientY: number | null): void {
    this.pointer = clientX === null || clientY === null ? null : { x: clientX, y: clientY }
    this.pointerDirty = true
  }

  private applyOrientation(): void {
    const mesh = this.mmd?.mesh
    if (!mesh) return
    const pitch = THREE.MathUtils.degToRad(this.pitchCurrent)
    mesh.rotation.set(pitch, THREE.MathUtils.degToRad(this.yawCurrent + this.chaseBodyYaw), 0)
    const c = this.bounds?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3()
    const rotated = c.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
    mesh.position.copy(c).sub(rotated)
    mesh.position.y += this.groundLift
  }

  private fitBox(): THREE.Box3 | null {
    if (!this.bounds) return null
    const mesh = this.mmd?.mesh
    if (!mesh || (Math.abs(this.yawCurrent) < 0.01 && Math.abs(this.pitchCurrent) < 0.01)) return this.bounds
    mesh.updateMatrixWorld(true)
    return this.bounds.clone().union(new THREE.Box3().setFromObject(mesh))
  }

  private fitCamera(): void {
    const box = this.fitBox()
    if (!box) return
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const distW = size.x / this.camera.aspect / 2 / halfTan
    const fitHeight = size.y / (1 - HEADROOM - FOOT_MARGIN)
    const dist = Math.max(fitHeight / 2 / halfTan, distW * 1.08) + size.z / 2
    const visibleH = dist * 2 * halfTan
    const target = new THREE.Vector3(center.x, box.min.y + visibleH / 2 - visibleH * FOOT_MARGIN, center.z)
    this.camera.position.set(target.x, target.y, target.z + dist)
    this.camera.lookAt(target)
    // MMD のモデルは、単位が VRM と違う(大きい)ので、モデルの大きさに合わせて、見える範囲を決める
    this.camera.near = Math.max(0.01, dist / 100)
    this.camera.far = dist * 20 + size.z
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
    const top = new THREE.Vector3(center.x, box.max.y, center.z).project(this.camera)
    this.onLayout(((1 - top.y) / 2) * Math.max(1, window.innerHeight))
  }

  private readonly resize = (): void => {
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.fitCamera()
  }

  private readonly tick = (): void => {
    this.rafId = requestAnimationFrame(this.tick)
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), MAX_FRAME_SEC)
    this.yawCurrent = stepYaw(this.yawCurrent, this.yawTarget, dt)
    this.pitchCurrent = stepPitch(this.pitchCurrent, this.pitchTarget, dt)
    if (this.mmd && this.mixer) {
      // モーフは、毎フレーム、モーションが決めた値から作り直される。そのあとで、調整・表情・まばたき・口を重ねる
      try {
        this.mmd.updateWithMixer(dt, this.mixer, this.ikOff ? { ik: false } : {})
      } catch (e) {
        console.warn('MMD の更新に失敗しました', e)
      }
      this.blender.apply(dt)
      this.applyMorphOverlay(performance.now())
      if (this.morphFx && this.mmd.mesh.morphTargetInfluences) this.morphFx.update(this.mmd.mesh.morphTargetInfluences)
    }
    // 追いかけ: 体の向き(applyOrientation で足す)
    const chase = this.chase.active || this.chaseBodyYaw !== 0 ? this.chase.update(dt, this.chaseCursor, this.headClientPoint()) : null
    this.chaseBodyYaw = chase?.body.yaw ?? 0
    this.props.update(dt)
    this.updateGroundLift(dt)
    this.applyOrientation()
    if (!this.fitLocked && (Math.abs(this.yawCurrent - this.fittedYaw) > 0.01 || Math.abs(this.pitchCurrent - this.fittedPitch) > 0.01)) {
      this.fittedYaw = this.yawCurrent
      this.fittedPitch = this.pitchCurrent
      this.fitCamera()
    }
    // 追いかけ: 頭・首・目の向きを、描画の間だけ足す(モーションが毎フレーム書かない骨に、掛け続けないよう、すぐ戻す)
    let undoChase: (() => void) | null = null
    const skeleton = this.mmd?.mesh.skeleton
    if (chase && skeleton) {
      const bone = (name: string): THREE.Object3D | null => skeleton.getBoneByName(name) ?? null
      const undoHead = applyHeadChase(bone('首'), bone('頭'), chase.head)
      const undoEye = applyEyeChase([bone('左目'), bone('右目')], chase.gaze)
      undoChase = () => {
        undoEye()
        undoHead()
      }
      this.mmd?.mesh.updateMatrixWorld(true)
    }
    this.beautify.render(this.camera)
    undoChase?.()
    this.frame++
    if (this.pointer && (this.pointerDirty || this.frame % HIT_RECHECK_FRAMES === 0)) {
      this.pointerDirty = false
      const hit = this.readAlphaAt(this.pointer.x, this.pointer.y) >= HIT_ALPHA_THRESHOLD
      if (hit !== this.hit) {
        this.hit = hit
        this.onHitChange(hit)
      }
    }
  }

  private readAlphaAt(clientX: number, clientY: number): number {
    const gl = this.renderer.getContext()
    const rect = this.canvas.getBoundingClientRect()
    const px = Math.floor(((clientX - rect.left) / rect.width) * this.canvas.width)
    const py = this.canvas.height - 1 - Math.floor(((clientY - rect.top) / rect.height) * this.canvas.height)
    if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) return 0
    const out = new Uint8Array(4)
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
    return out[3]
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    window.removeEventListener('resize', this.resize)
    for (const o of this.overrides.values()) clearTimeout(o.timer)
    this.overrides.clear()
    this.disposeModel()
    this.beautify.dispose()
    this.renderer.dispose()
  }
}
