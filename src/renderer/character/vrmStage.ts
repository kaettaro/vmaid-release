import * as THREE from 'three'
import { ChaseDriver, type ChaseSettings } from '@shared/chase'
import { applyHeadChase } from './chaseBones'
import type { PlaybackInfo } from '@shared/motions/playback'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, type VRMAnimation } from '@pixiv/three-vrm-animation'
import type { ModelFile, MotionState } from '@shared/ipc'
import type { PropSpec } from '@shared/packs/manifest'
import type { ResolvedBeautify } from '@shared/beautify'
import type { PropPayload } from '@shared/props/formats'
import { TALK_MOTION } from '@shared/motions/builtin'
import { sanitizeProfile, type AdjustSnapshot } from '@shared/adjust'
import { classifyTouch, touchBonesOf, type CustomTouchPart, type Point2, type TouchResult } from '@shared/touch/parts'
import { clampPitch, stepPitch, stepYaw, wrapDeg, type Orientation } from '@shared/character/yaw'
import { createFootLockState, resetFootLock, stepFootLock } from '@shared/character/footLock'
import { applyHipsPivot, createHipsPivotState, resetHipsPivot, restoreHipsPivot } from '@shared/character/hipsPivot'
import { stepGroundLift } from '@shared/character/groundLift'
import { AdjustLayer } from './adjustLayer'
import { BeautifyRig } from './beautifyRig'
import { CharacterController } from './characterController'
import { PropLayer } from './propLayer'
import type { CharacterStage } from './stage'

const FOV = 30
/** これ未満のアルファは「キャラがいない」とみなしてクリックを下のアプリに通す */
const HIT_ALPHA_THRESHOLD = 10
/** ポインタが止まっていても、モーションで体が動くので一定フレームごとに判定し直す */
const HIT_RECHECK_FRAMES = 6
/** ウィンドウ上部に空ける、吹き出し用の余白(高さに対する割合)と、足元の余白 */
const HEADROOM = 0.2
const FOOT_MARGIN = 0.04
/** 1フレームで進める時間の上限(秒) */
const MAX_FRAME_SEC = 1 / 20
/** 読み込み済みのモーションの上限(これを超えたら、使っていない古いものから捨てる) */
const MAX_LOADED_MOTIONS = 64

/** Three.js + three-vrm の描画と、ピクセル単位の当たり判定 */
export class VrmStage implements CharacterStage {
  readonly kind = 'vrm' as const
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 2 / 3, 0.1, 50)
  private readonly timer = new THREE.Timer()
  private vrm: VRM | null = null
  private character: CharacterController | null = null
  private readonly expressionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 表情の上書きを出した Mod の id(自分のルールなら null)。Mod の OFF・解除で、その Mod の分を元に戻す */
  private readonly expressionSources = new Map<string, string | null>()
  /** 追加オブジェクト層(Mod の小道具) */
  private readonly props = new PropLayer(
    (name) => this.vrm?.humanoid.getNormalizedBoneNode(name as never) ?? null,
    () => 1
  )
  private adjust: AdjustLayer | null = null
  /** 読み込み済み(解析済み)のモーション。挿入順が古い順(使うたびに末尾へ)。多くなりすぎたら、古いものから捨てる */
  private animations = new Map<string, VRMAnimation>()
  /** 使えるモーションの名前(内蔵・パック・登録)。中身は、再生するときに motionLoader で1件ずつ読む */
  private motionNames = new Set<string>()
  /** タグ → そのタグが付いたモーションの名前(登録順)。ルールの playMotion の tag を解決する */
  private motionsByTag = new Map<string, string[]>()
  private readonly loadingMotions = new Map<string, Promise<boolean>>()
  private motionGeneration = 0
  private readonly motionParser = (() => {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
    return loader
  })()
  private idleMotion: string | null = null
  private bounds: THREE.Box3 | null = null
  /** 足の接地補正。有効なときだけ tick で計算し、モデルを水平にずらす */
  private footLock = false
  private readonly footLockState = createFootLockState()
  /** 立ち姿のときの足首の高さ(モデルのローカル座標)。これ付近の足を「床に着いている」とみなす */
  private restAnkleY = 0
  /** 立ち姿での「hips ボーン → 左右の股関節の中点」(親の座標系)。hips が股関節から離れたモデルの補正に使う */
  private readonly hipsPivot = new THREE.Vector3()
  /** hips の補正の状態(元の位置と、書き込んだ位置)。毎フレーム足し込まず、元の位置から計算し直すために持つ */
  private readonly hipsPivotState = createHipsPivotState()
  private readonly footOffset = new THREE.Vector3()
  /** 関節が床の下に入ったぶん、モデル全体を持ち上げている量(メートル)。位置・向きの変更には使わず、描画の位置にだけ足す */
  private groundLift = 0
  /** 床の下に入っていないか調べる関節(モデルが持っているものだけ) */
  private groundBones: THREE.Object3D[] = []
  /** 頭ボーン(首のつけ根)から頭頂までの高さ(基準姿勢)。逆さのポーズで頭頂が床に入らないように、判定に加える */
  private headNode: THREE.Object3D | null = null
  private headTopY = 0
  private readonly tmpVec = new THREE.Vector3()
  private pointer: { x: number; y: number } | null = null
  private pointerDirty = false
  /** キャラの向き(度。0=正面、正=画面の右向き)。target へ current がなめらかに追従する */
  private yawTarget = 0
  private fitLocked = false
  private yawCurrent = 0
  /** 上下の傾き(度。正=頭が手前に倒れる)。yaw と同じく、target へ current が追従する */
  private pitchTarget = 0
  private pitchCurrent = 0
  /** 最後にカメラを合わせたときの向き(変わったときだけ合わせ直す) */
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

  /** 音声合成の再生状況(リップシンク用)。キャラを読み込み直しても引き継ぐ */
  speechSource: (() => { level: number | null; speaking: boolean }) | null = null

  /** 当たり判定の結果が変わったとき(ポインタが無い間は呼ばれない) */
  onHitChange: (hit: boolean) => void = () => {}

  /** 頭のてっぺんの、ウィンドウ内の高さ(css px。上端=0)が変わったとき。返答の吹き出しを頭の上に付けるのに使う */
  onLayout: (headTopPx: number | null) => void = () => {}

  /** モーション1件の VRMA の中身を取ってくる(main へ問い合わせる)。無ければ null */
  motionLoader: (name: string) => Promise<Uint8Array | null> = async () => null

  /** モーションを読み込めなかったとき */
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
    // 透過ウィンドウなので alpha: true。アルファでの当たり判定に premultipliedAlpha を使う
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(window.devicePixelRatio)

    const light = new THREE.DirectionalLight(0xffffff, Math.PI)
    light.position.set(1, 1.5, 2).normalize()
    const ambient = new THREE.AmbientLight(0xffffff, 0.4)
    this.scene.add(light, ambient)
    this.beautify = new BeautifyRig(this.renderer, this.scene, [light, ambient], { directional: Math.PI, ambient: 0.4 })

    this.resize()
    window.addEventListener('resize', this.resize)
    this.rafId = requestAnimationFrame(this.tick)
  }

  /** キャラの向き(左右 yaw・上下 pitch。度)を変える。instant なら追従せずに即座に向ける(ドラッグ中・モデルの読み込み直後) */
  setOrientation(o: Orientation, instant = false): void {
    this.yawTarget = wrapDeg(o.yaw)
    this.pitchTarget = clampPitch(o.pitch)
    if (instant) {
      this.yawCurrent = this.yawTarget
      this.pitchCurrent = this.pitchTarget
    }
  }

  /**
   * カメラのフィットの再計算を止める・再開する。歩いている間(体を歩く向きへ一時的に回す間)は止める:
   * 回すたびにフィットが変わると、キャラが窓の中で上下・伸び縮みして、歩くたびに上へ動いて見えるため。
   */
  setFitLocked(locked: boolean): void {
    this.fitLocked = locked
  }

  getOrientation(): Orientation {
    return { yaw: this.yawTarget, pitch: this.pitchTarget }
  }

  /**
   * モデルの基準の向き(VRM 0.x は後ろ向きなので π)に、ユーザーの向きを足して適用する。
   * 上下の傾きは、足元ではなく体の中心(外形の中心)を軸にして、画面の横方向の軸で回す(倒れ込むように見えない)。
   * rotation は XYZ 順 = Rx(pitch)·Ry(yaw): 左右に向けたあとで、画面基準で上下に傾ける。
   */
  private applyOrientation(): void {
    const vrm = this.vrm
    if (!vrm) return
    const base = vrm.meta.metaVersion === '0' ? Math.PI : 0
    const pitch = THREE.MathUtils.degToRad(this.pitchCurrent)
    vrm.scene.rotation.set(pitch, base + THREE.MathUtils.degToRad(this.yawCurrent + this.chaseBodyYaw), 0)
    // 中心 c を軸にするため、位置を c - Rx(pitch)·c にずらす(pitch=0 のときは 0)
    const c = this.bounds?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3()
    const rotated = c.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
    vrm.scene.position.copy(c).sub(rotated).add(this.footOffset)
    vrm.scene.position.y += this.groundLift
  }

  /**
   * 関節が床より下に入っていたら、そのぶんモデル全体を持ち上げる(横になる・座る・膝をつくポーズで、体が窓の下にめり込んで見切れるのを防ぐ)。
   * 計算は shared/character/groundLift.ts。上下に傾けているとき(pitch)は、床の向きが変わるので何もしない。
   */
  private updateGroundLift(vrm: VRM, dt: number): void {
    // 床へのめり込み補正も、機能 Mod「足の接地補正」の一部(OFF なら何もせず、持ち上げも戻す)
    if (!this.footLock || this.groundBones.length === 0 || Math.abs(this.pitchCurrent) > 0.5) {
      this.groundLift = 0
      return
    }
    vrm.scene.updateMatrixWorld(true)
    let minY = Infinity
    for (const bone of this.groundBones) {
      bone.getWorldPosition(this.tmpVec)
      if (this.tmpVec.y < minY) minY = this.tmpVec.y
    }
    if (this.headNode) {
      this.tmpVec.set(0, this.headTopY, 0)
      this.headNode.localToWorld(this.tmpVec)
      if (this.tmpVec.y < minY) minY = this.tmpVec.y
    }
    // 世界座標の高さには、いまの持ち上げが含まれている。持ち上げる前の高さに直してから、新しい量を決める
    this.groundLift = stepGroundLift(this.groundLift, minY - this.groundLift, dt)
  }

  /** 足首(正規化ボーン)の位置を、モデルのローカル座標で返す。無いボーンなら null */
  private footPosition(vrm: VRM, bone: 'leftFoot' | 'rightFoot'): { x: number; y: number; z: number } | null {
    const node = vrm.humanoid.getNormalizedBoneNode(bone)
    if (!node) return null
    node.getWorldPosition(this.tmpVec)
    vrm.scene.worldToLocal(this.tmpVec)
    return { x: this.tmpVec.x, y: this.tmpVec.y, z: this.tmpVec.z }
  }

  /** 足の接地補正を1フレーム進め、モデルをずらす量(footOffset。親座標系)を更新する */
  private updateFootLock(vrm: VRM, dt: number): void {
    if (!this.footLock) {
      this.restoreHipsPivotPosition(vrm)
      if (this.footOffset.lengthSq() > 0) this.clearFootLock()
      return
    }
    this.compensateHipsPivot(vrm)
    vrm.scene.updateMatrixWorld(true)
    const left = this.footPosition(vrm, 'leftFoot')
    const right = this.footPosition(vrm, 'rightFoot')
    if (!left || !right) return
    stepFootLock(this.footLockState, left, right, this.restAnkleY, dt)
    // ローカル座標のずらし量を、親座標系へ(向きを変えていても、足が世界に留まるように)
    this.footOffset.set(this.footLockState.offsetX, 0, this.footLockState.offsetZ).applyQuaternion(vrm.scene.quaternion)
  }

  private clearFootLock(): void {
    resetFootLock(this.footLockState)
    resetHipsPivot(this.hipsPivotState)
    this.footOffset.set(0, 0, 0)
  }

  /** 床の下に入っていないか調べる関節を、モデルから集める */
  private collectGroundBones(vrm: VRM): void {
    const names = [
      'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'
    ] as const
    this.groundBones = names.flatMap((n) => {
      const node = vrm.humanoid.getNormalizedBoneNode(n)
      return node ? [node] : []
    })
    this.groundLift = 0
    // 頭頂: 外形の最上部から、頭ボーンの高さを引いた長さ(髪・角を含む。判定は少し安全側になる)
    this.headNode = vrm.humanoid.getNormalizedBoneNode('head')
    if (this.headNode) {
      vrm.scene.updateMatrixWorld(true)
      const top = new THREE.Box3().setFromObject(vrm.scene).max.y
      this.headNode.getWorldPosition(this.tmpVec)
      this.headTopY = Math.max(0, top - this.tmpVec.y)
    }
  }

  /** 立ち姿(T ポーズ等)の足首の高さを記録する。読み込み直後の vrm.update(0) の後に呼ぶ */
  private measureRestAnkle(vrm: VRM): void {
    vrm.scene.updateMatrixWorld(true)
    const l = this.footPosition(vrm, 'leftFoot')
    const r = this.footPosition(vrm, 'rightFoot')
    this.restAnkleY = l && r ? Math.min(l.y, r.y) : 0

    const hips = this.bonePosition(vrm, 'hips')
    const ul = this.bonePosition(vrm, 'leftUpperLeg')
    const ur = this.bonePosition(vrm, 'rightUpperLeg')
    if (hips && ul && ur) {
      this.hipsPivot.set((ul.x + ur.x) / 2 - hips.x, (ul.y + ur.y) / 2 - hips.y, (ul.z + ur.z) / 2 - hips.z)
    } else {
      this.hipsPivot.set(0, 0, 0)
    }
  }

  private bonePosition(vrm: VRM, bone: 'hips' | 'leftUpperLeg' | 'rightUpperLeg'): { x: number; y: number; z: number } | null {
    const node = vrm.humanoid.getNormalizedBoneNode(bone)
    if (!node) return null
    node.getWorldPosition(this.tmpVec)
    vrm.scene.worldToLocal(this.tmpVec)
    return { x: this.tmpVec.x, y: this.tmpVec.y, z: this.tmpVec.z }
  }

  /**
   * hips の回転で股関節がずれないよう、hips の位置を補正する。
   * PMX から変換したモデルは、hips ボーンが股関節から離れていることがあり(本モデルでは約0.2m下)、
   * 腰を回すたびに股関節が大きく振られて、足先が床の上を左右に滑る。元の MMD の足は IK で床に固定されている。
   * 股関節の位置(回転の影響を除いたもの)が動かないように、hips の位置を打ち消す。
   */
  private compensateHipsPivot(vrm: VRM): void {
    if (this.hipsPivot.lengthSq() === 0) return
    const hips = vrm.humanoid.getNormalizedBoneNode('hips')
    if (!hips) return
    // 元の位置に対して計算し直す(足し込まない)。AnimationMixer は、値が変わらないトラックの位置を毎フレームは書き直さないため、
    // 足し込むと補正が累積して、腰が動かないモーションでモデルが飛んでいく
    const q = hips.quaternion
    const out = applyHipsPivot(
      this.hipsPivotState,
      [hips.position.x, hips.position.y, hips.position.z],
      [q.x, q.y, q.z, q.w],
      [this.hipsPivot.x, this.hipsPivot.y, this.hipsPivot.z]
    )
    hips.position.set(out[0], out[1], out[2])
  }

  /** 補正をやめたとき、書き込んだままの hips の位置を元に戻す(アニメーションが書き直していなければ、戻す必要がある) */
  private restoreHipsPivotPosition(vrm: VRM): void {
    const hips = vrm.humanoid.getNormalizedBoneNode('hips')
    if (!hips) return
    const back = restoreHipsPivot(this.hipsPivotState, [hips.position.x, hips.position.y, hips.position.z])
    if (back) hips.position.set(back[0], back[1], back[2])
  }

  get hasModel(): boolean {
    return this.vrm !== null
  }

  get isHit(): boolean {
    return this.hit
  }

  /**
   * 読み込んだモデルから調整項目を列挙し、保存済みの調整値を反映して、パネルに渡すスナップショットを返す。
   * 読み込み後に別のモデルへ切り替わっていたら null。
   */
  setupAdjust(vrm: VRM, file: { name: string; hash: string }, rawProfile: unknown): AdjustSnapshot | null {
    if (vrm !== this.vrm) return null
    const layer = new AdjustLayer(vrm)
    layer.setAll(sanitizeProfile(layer.items, rawProfile))
    this.adjust = layer
    return layer.snapshot(file.hash, file.name)
  }

  adjustSet(key: string, value: number): void {
    this.adjust?.set(key, value)
  }

  adjustResetAll(): void {
    this.adjust?.resetAll()
  }

  /** 値をまとめて入れ替える(セットの適用・元に戻す) */
  adjustSetAll(values: Record<string, number>): void {
    this.adjust?.setAll(values)
  }

  /**
   * クリックした位置(ウィンドウ内のpx)が、体のどの部位か。VRMの人体ボーンを画面へ投影して、最も近い骨で決める。
   * モデルを読み込んでいない・体から遠いときは null。
   */
  setTouchParts(parts: readonly CustomTouchPart[]): void {
    this.touchParts = parts
  }

  touchAt(clientX: number, clientY: number): TouchResult | null {
    const vrm = this.vrm
    if (!vrm) return null
    const rect = this.canvas.getBoundingClientRect()
    const project = (v: THREE.Vector3): Point2 => {
      const p = v.clone().project(this.camera)
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height }
    }
    // 腕・手の骨を、画面の位置にする
    const bones: Record<string, Point2 | undefined> = {}
    // (脚の骨は、後ろ向きのときの左右の判定に使う)
    for (const name of [
      'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
      'leftUpperLeg', 'rightUpperLeg', 'leftFoot', 'rightFoot',
      ...touchBonesOf(this.touchParts) // Mod が宣言した部位の骨
    ]) {
      const node = vrm.humanoid.getNormalizedBoneNode(name as never)
      if (node) bones[name] = project(node.getWorldPosition(new THREE.Vector3()))
    }
    // 体の範囲: モデルの外形(バウンディングボックス)から、頭のてっぺん・足元・中心を、画面の位置にする。
    // ボーンでなく外形を使うので、モデルによって骨がずれていても、頭〜足の高さは正しく取れる
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const cx = (box.min.x + box.max.x) / 2
    const cz = (box.min.z + box.max.z) / 2
    const top = project(new THREE.Vector3(cx, box.max.y, cz))
    const bottom = project(new THREE.Vector3(cx, box.min.y, cz))
    return classifyTouch({ x: clientX, y: clientY }, bones, { top: top.y, bottom: bottom.y, centerX: top.x }, this.touchParts)
  }

  /** 使えるモーションか(ルールがタグから選ぶときに使う。読み込み済みかは問わない) */
  hasMotion(name: string): boolean {
    return this.motionNames.has(name)
  }

  /** そのタグが付いた、使えるモーションの名前(登録順) */
  motionsWithTag(tag: string): string[] {
    return this.motionsByTag.get(tag) ?? []
  }

  /**
   * 単発モーションの再生要求(ルールの playMotion)。喋り中・再生中は破棄される(状態機械の仕様)。
   * 読み込んでいなければ、先に読み込む(初回だけ少し遅れる)
   */
  playMotion(name: string, opts?: { durationSec?: number; queue?: boolean; interrupt?: boolean }): void {
    if (!this.motionNames.has(name)) return
    if (this.character?.isLoaded(name)) {
      this.touchMotion(name)
      this.character.playOneShot(name, opts)
      return
    }
    void this.ensureMotion(name).then((ok) => {
      if (ok) this.character?.playOneShot(name, opts)
    })
  }

  /** 読み込み済みのモーションを、「最近使った」として末尾へ回す */
  private touchMotion(name: string): void {
    const anim = this.animations.get(name)
    if (!anim) return
    this.animations.delete(name)
    this.animations.set(name, anim)
  }

  /** モーションを読み込んで、キャラに登録する。読み込めたら true(すでに読み込み済みでも true) */
  private ensureMotion(name: string): Promise<boolean> {
    if (this.character?.isLoaded(name)) return Promise.resolve(true)
    const pending = this.loadingMotions.get(name)
    if (pending) return pending
    const generation = this.motionGeneration
    const task = (async (): Promise<boolean> => {
      try {
        let anim = this.animations.get(name)
        if (!anim) {
          const data = await this.motionLoader(name)
          if (!data) throw new Error('中身を取得できません')
          const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
          const gltf = await this.motionParser.parseAsync(buffer, '')
          anim = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0]
          if (!anim) throw new Error('VRMA として読めません')
        }
        if (generation !== this.motionGeneration) return false // 読み込み中に、一覧が入れ替わった
        this.animations.set(name, anim)
        this.character?.addMotion(name, anim)
        this.evictMotions()
        return true
      } catch (e) {
        console.warn(`VRMAを読めませんでした: ${name}`, e)
        this.onMotionError(name)
        return false
      } finally {
        this.loadingMotions.delete(name)
      }
    })()
    this.loadingMotions.set(name, task)
    return task
  }

  /** 読み込み済みが多すぎたら、使っていない古いものから捨てる(数千件を全部メモリに置かない) */
  private evictMotions(): void {
    for (const name of [...this.animations.keys()]) {
      if (this.animations.size <= MAX_LOADED_MOTIONS) break
      if (this.character?.unloadMotion(name)) this.animations.delete(name)
    }
  }

  /** 表情を一時的に上書きし、指定秒数のあと元(基準値)に戻す(ルールの setExpression) */
  setExpression(name: string, value: number, durationSec: number, source: string | null = null): void {
    this.adjust?.setExpressionOverride(name, value)
    this.expressionSources.set(name, source)
    const prev = this.expressionTimers.get(name)
    if (prev) clearTimeout(prev)
    this.expressionTimers.set(
      name,
      setTimeout(() => {
        this.adjust?.setExpressionOverride(name, null)
        this.expressionTimers.delete(name)
        this.expressionSources.delete(name)
      }, durationSec * 1000)
    )
  }

  async showProp(id: string, payload: PropPayload, spec: PropSpec, durationSec: number, source: string | null): Promise<void> {
    if (!this.vrm) return
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
    for (const [name, source] of [...this.expressionSources]) {
      if (!all && (source === null || keep.has(source))) continue
      const t = this.expressionTimers.get(name)
      if (t) clearTimeout(t)
      this.expressionTimers.delete(name)
      this.expressionSources.delete(name)
      this.adjust?.setExpressionOverride(name, null)
    }
  }

  /** モーションは変えずに、口だけを動かす(ルールの say) */
  lipSync(durationMs: number): void {
    this.character?.lipSync(durationMs)
  }

  /** 返答の喋り始め・終わり(喋り中モーションと口パク) */
  speakStart(): void {
    this.character?.speakStart()
  }

  speakEnd(): void {
    this.character?.speakEnd()
  }

  /**
   * 使えるモーションの名前の一覧と、待機・足ロックの設定を受け取る。
   * 中身は読まない(再生するときに、1件ずつ読む)。一覧が変わったので、読み込み済みはいったん捨てて、待機と喋り中だけ先に読む
   */
  setMotions(state: MotionState): void {
    this.motionGeneration++
    this.loadingMotions.clear()
    // VMD は、MMD のモデルで再生する。VRM のモデルでは、MMD 対応が ON のときだけ(変換して)一覧に入れる
    const vmd = new Set(state.vmd)
    const names = state.vmdToVrm ? [...state.names] : state.names.filter((n) => !vmd.has(n))
    this.motionNames = new Set(names)
    this.motionsByTag = new Map()
    for (const name of names) {
      for (const tag of state.tags[name] ?? []) {
        const list = this.motionsByTag.get(tag)
        if (list) list.push(name)
        else this.motionsByTag.set(tag, [name])
      }
    }
    this.animations = new Map()
    this.idleMotion = state.idle
    this.footLock = state.footLock
    this.clearFootLock()
    this.character?.setMotions(this.animations, this.idleMotion)
    this.preloadBasicMotions()
  }

  /** 待機と喋り中のモーションを先に読み込む(すぐ使うので) */
  private preloadBasicMotions(): void {
    for (const name of [this.idleMotion, TALK_MOTION]) {
      if (name && this.motionNames.has(name)) void this.ensureMotion(name)
    }
  }

  stopMotion(): void {
    this.character?.stopOneShot()
  }

  getPlayback(): PlaybackInfo | null {
    return this.character?.playback() ?? null
  }

  seek(sec: number): void {
    this.character?.seek(sec)
  }

  setPaused(paused: boolean): void {
    this.character?.setPaused(paused)
  }

  /** null でポインタがウィンドウ外 */

  setChase(settings: ChaseSettings | null): void {
    this.chase.setSettings(settings)
    if (!settings && this.vrm?.lookAt) {
      this.vrm.lookAt.yaw = 0
      this.vrm.lookAt.pitch = 0
    }
  }

  setChaseCursor(point: { x: number; y: number } | null): void {
    this.chaseCursor = point
  }

  /** 頭の、ウィンドウ内の位置(css px)。追いかけの、向きの基準 */
  private headClientPoint(): { x: number; y: number } | null {
    const head = this.vrm?.humanoid.getNormalizedBoneNode('head')
    if (!head) return null
    const v = head.getWorldPosition(new THREE.Vector3()).project(this.camera)
    const rect = this.canvas.getBoundingClientRect()
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height }
  }

  setPointer(clientX: number | null, clientY: number | null): void {
    this.pointer = clientX === null || clientY === null ? null : { x: clientX, y: clientY }
    this.pointerDirty = true
  }

  /** モデルファイル(VRM)を読み込んで表示し、表情・衣装パネル用の項目を返す */
  async loadFile(file: ModelFile, rawProfile: unknown): Promise<AdjustSnapshot | null> {
    if (file.kind !== 'vrm') throw new Error('VRM 以外のモデルは、このステージでは読み込めません')
    const vrm = await this.load(file.data)
    return this.setupAdjust(vrm, file, rawProfile)
  }

  async load(data: Uint8Array): Promise<VRM> {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    // 呼び出し元のバッファを共有しないよう、必要範囲だけをコピーして渡す
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    const t0 = performance.now()
    const gltf = await loader.parseAsync(buffer, '')
    const t1 = performance.now()
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) throw new Error('VRMとして読み込めませんでした(VRM拡張が見つかりません)')

    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    VRMUtils.rotateVRM0(vrm) // VRM 0.x は後ろ向きなので正面に回す(1.0には影響しない)
    vrm.scene.traverse((o) => (o.frustumCulled = false))
    lowerArms(vrm)
    // VRMAの視線トラック用。自前で用意しないとクリップ生成のたびに警告が出る
    if (vrm.lookAt) {
      const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt)
      proxy.name = 'VRMLookAtQuaternionProxy'
      vrm.scene.add(proxy)
    }

    this.props.clear() // 前のモデルに付けていた小道具は、モデルと一緒に捨てる
    if (this.vrm) {
      this.character?.dispose()
      this.scene.remove(this.vrm.scene)
      VRMUtils.deepDispose(this.vrm.scene)
    }
    this.vrm = vrm
    this.yawTarget = 0 // 新しいモデルは正面から(保存済みの向きは、呼び出し側が setOrientation で復元する)
    this.yawCurrent = 0
    this.pitchTarget = 0
    this.pitchCurrent = 0
    this.fittedYaw = 0
    this.fittedPitch = 0
    this.adjust = null // 新しいモデルの項目は setupAdjust で作り直す
    this.character = new CharacterController(vrm)
    this.character.onOneShotStart = (n) => this.onMotionStart(n)
    this.character.onOneShotEnd = (n) => this.onMotionEnd(n)
    this.character.setMotions(this.animations, this.idleMotion)
    this.preloadBasicMotions()
    this.scene.add(vrm.scene)
    vrm.update(0)
    this.clearFootLock()
    this.collectGroundBones(vrm)
    this.measureRestAnkle(vrm)
    this.bounds = new THREE.Box3().setFromObject(vrm.scene)
    this.beautify.setRoot(vrm.scene)
    this.fitCamera()
    // 初回描画のシェーダーコンパイルが重いので、読み込み完了前に済ませてUIが止まる時間を把握する
    const t2 = performance.now()
    await this.renderer.compileAsync(this.scene, this.camera)
    console.info(
      `VRM読み込み時間: パース ${Math.round(t1 - t0)}ms / 後処理 ${Math.round(t2 - t1)}ms / シェーダー ${Math.round(performance.now() - t2)}ms`
    )
    return vrm
  }

  /**
   * カメラが収めるべき範囲。ふだんはモデルの外形(正面・まっすぐ)。向きを変えているときは、それに、
   * 回したあとの外形を足した範囲にする(回しても、足元・頭・横幅が窓から出ない。窓の大きさ・位置は変えない)
   */
  private fitBox(): THREE.Box3 | null {
    if (!this.bounds) return null
    const vrm = this.vrm
    if (!vrm || (Math.abs(this.yawCurrent) < 0.01 && Math.abs(this.pitchCurrent) < 0.01)) return this.bounds
    vrm.scene.updateMatrixWorld(true)
    return this.bounds.clone().union(new THREE.Box3().setFromObject(vrm.scene))
  }

  /** 全身(横幅も含む)がウィンドウに収まる距離にカメラを置く */
  private fitCamera(): void {
    const box = this.fitBox()
    if (!box) return
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const distW = size.x / this.camera.aspect / 2 / halfTan
    // 全身 + 頭上に吹き出し用の余白(HEADROOM)が収まる距離。足元は少し余白を残して下に寄せる
    const fitHeight = size.y / (1 - HEADROOM - FOOT_MARGIN)
    const dist = Math.max(fitHeight / 2 / halfTan, distW * 1.08) + size.z / 2
    const visibleH = dist * 2 * halfTan
    const target = new THREE.Vector3(center.x, box.min.y + visibleH / 2 - visibleH * FOOT_MARGIN, center.z)
    this.camera.position.set(target.x, target.y, target.z + dist)
    this.camera.lookAt(target)
    // 頭のてっぺん(範囲の上端の中心)を、画面の高さ(css px)にして知らせる
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
    // 長く止まった直後(シェーダーコンパイル・ウィンドウ操作・非表示からの復帰)の巨大な dt は、
    // スプリングボーン(髪・服の揺れ)を乱して形が崩れるので上限を設ける
    const dt = Math.min(this.timer.getDelta(), MAX_FRAME_SEC)
    // モーション → 表情(自動まばたきを基準値と合成) → vrm.update → モーフ の順
    if (this.character) this.character.speechSource = this.speechSource
    this.character?.update(dt)
    const blink = this.character?.autoBlink ?? 0
    const mouth = this.character?.autoMouth ?? 0
    if (this.adjust) this.adjust.beforeUpdate({ blink, mouth }, this.character?.activeTrackNames())
    else this.vrm?.expressionManager?.setValue('blink', blink)
    this.yawCurrent = stepYaw(this.yawCurrent, this.yawTarget, dt)
    this.pitchCurrent = stepPitch(this.pitchCurrent, this.pitchTarget, dt)
    const chase = this.chase.active || this.chaseBodyYaw !== 0 ? this.chase.update(dt, this.chaseCursor, this.headClientPoint()) : null
    this.chaseBodyYaw = chase?.body.yaw ?? 0
    if (this.vrm) {
      this.updateFootLock(this.vrm, dt)
      this.updateGroundLift(this.vrm, dt)
    }
    this.applyOrientation()
    // 向きが変わったら、回したあとの姿が見切れないようにカメラを合わせ直す
    if (!this.fitLocked && (Math.abs(this.yawCurrent - this.fittedYaw) > 0.01 || Math.abs(this.pitchCurrent - this.fittedPitch) > 0.01)) {
      this.fittedYaw = this.yawCurrent
      this.fittedPitch = this.pitchCurrent
      this.fitCamera()
    }
    // 追いかけ: 視線(目)と、頭・首の向きを、モーションの上に足す(頭・首は、vrm.update のあとで元に戻す)
    let undoChase: (() => void) | null = null
    if (chase && this.vrm) {
      if (this.vrm.lookAt) {
        this.vrm.lookAt.yaw = chase.gaze.yaw
        this.vrm.lookAt.pitch = -chase.gaze.pitch // 視線の pitch は、下が正
      }
      // VRM 0.x は、骨の軸が VRM 1.0 と、Y 軸まわりに 180 度ずれている(左右の回転は同じで、上下だけ逆になる)
      const headAim = this.vrm.meta.metaVersion === '0' ? { yaw: chase.head.yaw, pitch: -chase.head.pitch } : chase.head
      undoChase = applyHeadChase(this.vrm.humanoid.getNormalizedBoneNode('neck'), this.vrm.humanoid.getNormalizedBoneNode('head'), headAim)
    }
    this.vrm?.update(dt)
    undoChase?.()
    this.props.update(dt)
    this.adjust?.afterUpdate()
    this.beautify.render(this.camera)

    // 描画直後でないとバッファが読めないので、同じフレーム内で1ピクセルだけ読む
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
    this.props.clear()
    this.beautify.dispose()
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene)
    this.renderer.dispose()
  }
}

/**
 * T字ポーズのままだと不自然なので腕を下ろす。待機モーションが無いとき・モーション停止後の姿勢になる。
 * VRM 0.x の正規化ボーンは VRM 1.0 と左右(X/Z)が反転した軸系なので、符号を切り替える。
 */
function lowerArms(vrm: VRM): void {
  const sign = vrm.meta.metaVersion === '0' ? 1 : -1
  const set = (name: 'leftUpperArm' | 'rightUpperArm', z: number): void => {
    const node = vrm.humanoid.getNormalizedBoneNode(name)
    if (node) node.rotation.z = z
  }
  set('leftUpperArm', 1.2 * sign)
  set('rightUpperArm', -1.2 * sign)
}
