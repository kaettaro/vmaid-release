import * as THREE from 'three'
import { VRMHumanBoneList, type VRM } from '@pixiv/three-vrm'
import { createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation'
import { BlinkController } from '@shared/character/blink'
import { AudioMouth } from '@shared/character/audioMouth'
import { MouthController } from '@shared/character/mouth'
import { PoseBlender } from '@shared/character/poseBlender'
import { clampSeek, type PlaybackInfo } from '@shared/motions/playback'
import { TALK_MOTION } from '@shared/motions/builtin'
import {
  initialState,
  transition,
  type CharEffect,
  type CharEvent,
  type CharState
} from '@shared/character/stateMachine'

const FADE_SEC = 0.25

/** 単発モーションの再生オプション */
export interface OneShotOptions {
  durationSec?: number
  queue?: boolean
  /** 再生中・喋り中のモーションを、すぐ止めて、これを始める(設定画面の「試し再生」用。ふだんは、再生中の要求は破棄される) */
  interrupt?: boolean
}

/**
 * キャラの動き全体の制御。状態遷移は shared の純粋な状態機械に任せ、
 * ここはその結果(effects)を AnimationMixer に反映するだけ。
 * まばたきはモーションと独立に blink 表情だけを書き換える。
 */
export class CharacterController {
  private readonly mixer: THREE.AnimationMixer
  private readonly blink: BlinkController
  private readonly mouth: MouthController
  private readonly audioMouth = new AudioMouth()
  /** 音声合成の再生状況(口の動きに使う)。level は再生中の音量(取れなければ null)、speaking は OS の音声で喋っている間 true */
  speechSource: (() => { level: number | null; speaking: boolean }) | null = null
  private state: CharState = initialState
  private actions = new Map<string, THREE.AnimationAction>()
  private idleName: string | null = null
  private oneShot: THREE.AnimationAction | null = null
  private readonly trackNames = new WeakMap<THREE.AnimationClip, Set<string>>()
  /** 再生中の単発モーションの名前(終了通知に使う) */
  private oneShotName: string | null = null
  /** 単発モーションが実際に始まったとき(音楽を同時に始めるため)。破棄された要求では呼ばれない */
  onOneShotStart: ((name: string) => void) | null = null
  /** 単発モーションが終わった・止められたとき(音楽を同時に止めるため) */
  onOneShotEnd: ((name: string) => void) | null = null
  /** 自動まばたきの現在値(0〜1)。表情への反映は調整レイヤー側(基準値との合成)で行う */
  autoBlink = 0
  /** 喋り中の口の開き(0〜)。喋っていなければ0 */
  autoMouth = 0
  /** この時刻(ms)まで、モーションはそのままで口だけ動かす(ルールの say。状態機械の speaking には入らない) */
  private lipUntil = 0
  private speaking: THREE.AnimationAction | null = null
  /** 再生中のモーションが終わるのを待っている、連続再生の続き(ルールの playMotion の queue) */
  private queued: Array<{ clip: string; opts: OneShotOptions }> = []
  /** 次に始める単発モーションのオプション(状態機械の効果に、オプションは載らないので、ここに置く) */
  private nextOpts: OneShotOptions = {}
  /** ループ再生の残り秒数(durationSec 指定のとき)。null なら、1回再生 */
  private loopRemaining: number | null = null
  /** モーションの切り替えを、いまの姿勢からなめらかに移す(標準機能) */
  private readonly blender = new PoseBlender()
  private readonly blendNodes: THREE.Object3D[]
  /** モーションの入れ替え中は、覚えた姿勢(入れ替え前の見た目)を、覚え直さない */
  private keepBlend = false

  constructor(
    private readonly vrm: VRM,
    private readonly rng: () => number = Math.random
  ) {
    this.mixer = new THREE.AnimationMixer(vrm.scene)
    this.blendNodes = VRMHumanBoneList.map((n) => vrm.humanoid.getNormalizedBoneNode(n)).filter((n): n is THREE.Object3D => n !== null)
    this.blink = new BlinkController(rng)
    this.mouth = new MouthController(rng)
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.oneShot) {
        this.dispatch({ type: 'oneShotEnded' })
        this.drainQueue()
      }
    })
  }

  /**
   * 読み込み済みのモーションを入れ替える。再生中のものは止めて待機状態に戻す。
   * idle は待機に使う名前: まだ読み込んでいなくてよい(addMotion で読み込まれた時点で、待機が始まる)
   */
  setMotions(animations: Map<string, VRMAnimation>, idle: string | null): void {
    this.blender.begin(this.blendNodes) // 入れ替える前の見た目の姿勢から、新しい待機へなめらかに移す
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.vrm.scene)
    this.actions.clear()
    this.oneShot = null
    this.notifyOneShotEnd()
    this.speaking = null
    this.queued = []
    this.loopRemaining = null
    this.state = initialState
    for (const [name, anim] of animations) {
      this.actions.set(name, this.mixer.clipAction(createVRMAnimationClip(anim, this.vrm)))
    }
    this.idleName = idle
    this.keepBlend = true
    this.apply({ type: 'playIdle' })
    this.keepBlend = false
  }

  /** モーションを1件、あとから読み込む。待機に使う名前で、いま待機状態なら、そのまま待機を始める */
  addMotion(name: string, anim: VRMAnimation): void {
    if (this.actions.has(name)) return
    this.actions.set(name, this.mixer.clipAction(createVRMAnimationClip(anim, this.vrm)))
    if (name === this.idleName && this.state.kind === 'idle') this.apply({ type: 'playIdle' })
  }

  /** 読み込み済みか(再生できるか) */
  isLoaded(name: string): boolean {
    return this.actions.has(name)
  }

  /**
   * 読み込み済みのモーションを1件、メモリから外す(使っていないものを、上限を超えたときに捨てる)。
   * 再生中・待機・喋り中・連続再生の待ち行列に入っているものは外さない。外したら true
   */
  unloadMotion(name: string): boolean {
    const action = this.actions.get(name)
    if (!action) return false
    if (name === this.idleName || action === this.oneShot || action === this.speaking || this.queued.some((q) => q.clip === name)) return false
    action.stop()
    this.mixer.uncacheAction(action.getClip(), this.vrm.scene)
    this.mixer.uncacheClip(action.getClip())
    this.actions.delete(name)
    return true
  }

  /** 喋り始め・終わり(会話の返答のストリーミングに合わせて呼ぶ) */
  speakStart(): void {
    this.dispatch({ type: 'speakStart' })
  }

  speakEnd(): void {
    this.dispatch({ type: 'speakEnd' })
    this.drainQueue()
  }

  /**
   * モーションを変えずに、口だけを指定の時間動かす。
   * ルールの say 用: 喋り中の状態(talk モーションへの切り替え)に入ると、同じルールの playMotion(ダンス等)が
   * 「喋り中の単発モーションは破棄」の仕様で捨てられてしまうため、セリフを言いながら踊れるようにする。
   */
  lipSync(durationMs: number): void {
    this.lipUntil = performance.now() + durationMs
  }

  hasMotion(name: string): boolean {
    return this.actions.has(name)
  }

  /**
   * 単発モーションの再生要求(ルールエンジンからも使う)。
   * - queue: 再生中なら、終わってから続ける(連続再生。待ち行列は最大5つ)。指定しないと、再生中の要求は破棄される
   * - durationSec: ループするモーションを、この秒数だけ再生する
   */
  playOneShot(clip: string, opts: OneShotOptions = {}): void {
    if (!this.actions.has(clip)) return
    if (opts.interrupt && this.state.kind !== 'idle') {
      // いまのモーション(または喋り中)を、すぐ終わらせて、待機に戻してから、これを始める(連続再生の待ちも捨てる)
      this.queued.length = 0
      this.loopRemaining = null
      this.dispatch({ type: this.state.kind === 'speaking' ? 'speakEnd' : 'oneShotEnded' })
    }
    if (opts.queue && this.state.kind !== 'idle') {
      if (this.queued.length < 5) this.queued.push({ clip, opts })
      return
    }
    this.nextOpts = opts
    this.dispatch({ type: 'oneShot', clip })
    this.nextOpts = {} // 破棄された要求のオプションを、次に持ち越さない
  }

  /** 再生中の単発モーションの状態(無ければ null) */
  playback(): PlaybackInfo | null {
    const a = this.oneShot
    if (!a || this.oneShotName === null) return null
    return { name: this.oneShotName, time: a.time, duration: a.getClip().duration, looping: this.loopRemaining !== null, paused: a.paused }
  }

  /** 再生中の単発モーションが持つトラックの名前(表情のトラックの検出用。無ければ null) */
  activeTrackNames(): ReadonlySet<string> | null {
    const clip = this.oneShot?.getClip()
    if (!clip) return null
    let names = this.trackNames.get(clip)
    if (!names) this.trackNames.set(clip, (names = new Set(clip.tracks.map((t) => t.name))))
    return names
  }

  seek(sec: number): void {
    const a = this.oneShot
    if (a) a.time = clampSeek(sec, a.getClip().duration)
  }

  setPaused(paused: boolean): void {
    if (this.oneShot) this.oneShot.paused = paused
  }

  /** 再生中の単発モーションを、すぐ止めて、待機に戻る(連続再生の待ちも捨てる)。喋り中・待機中は、何もしない */
  stopOneShot(): void {
    this.queued.length = 0
    if (this.state.kind !== 'oneShot') return
    this.loopRemaining = null
    this.dispatch({ type: 'oneShotEnded' })
  }

  private notifyOneShotEnd(): void {
    const name = this.oneShotName
    if (name === null) return
    this.oneShotName = null
    this.onOneShotEnd?.(name)
  }

  /** 待っている続きがあれば、次のモーションを始める(待機に戻ったとき) */
  private drainQueue(): void {
    if (this.state.kind !== 'idle') return
    const next = this.queued.shift()
    if (next) this.playOneShot(next.clip, { ...next.opts, queue: false })
  }

  dispatch(event: CharEvent): void {
    const t = transition(this.state, event)
    this.state = t.state
    t.effects.forEach((e) => this.apply(e))
  }

  private apply(effect: CharEffect): void {
    // モーションが切り替わるたびに、いまの姿勢を覚えて、新しい姿勢へなめらかに移す
    if (!this.keepBlend) this.blender.begin(this.blendNodes)
    switch (effect.type) {
      case 'playIdle': {
        const idle = this.idleName ? this.actions.get(this.idleName) : undefined
        if (idle) idle.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(FADE_SEC).play()
        this.oneShot?.fadeOut(FADE_SEC)
        this.oneShot = null
        this.notifyOneShotEnd()
        this.speaking?.fadeOut(FADE_SEC)
        this.speaking = null
        break
      }
      case 'playSpeaking': {
        const talk = this.actions.get(TALK_MOTION)
        if (talk) {
          talk.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(FADE_SEC).play()
          if (this.idleName) this.actions.get(this.idleName)?.fadeOut(FADE_SEC)
          this.speaking = talk
        }
        break
      }
      case 'playOneShot': {
        const action = this.actions.get(effect.clip)
        if (!action) break
        const loopSec = this.nextOpts.durationSec
        this.nextOpts = {}
        if (loopSec && loopSec > 0) {
          action.reset().setLoop(THREE.LoopRepeat, Infinity) // 指定の秒数だけくり返す(終わりは update で判定)
          this.loopRemaining = loopSec
        } else {
          action.reset().setLoop(THREE.LoopOnce, 1)
          this.loopRemaining = null
        }
        action.clampWhenFinished = true
        action.fadeIn(FADE_SEC).play()
        if (this.idleName) this.actions.get(this.idleName)?.fadeOut(FADE_SEC)
        this.oneShot = action
        this.oneShotName = effect.clip
        this.onOneShotStart?.(effect.clip)
        break
      }
      case 'stopOneShot':
        this.oneShot?.fadeOut(FADE_SEC)
        this.oneShot = null
        this.notifyOneShotEnd()
        break
    }
  }

  /** vrm.update() より前に毎フレーム呼ぶ */
  update(dt: number): void {
    this.mixer.update(dt)
    this.blender.apply(dt)
    if (this.loopRemaining !== null) {
      this.loopRemaining -= dt
      if (this.loopRemaining <= 0) {
        // ループ再生の時間が来た。フェードアウトして、待機に戻る(続きがあれば、次へ)
        this.loopRemaining = null
        this.oneShot?.fadeOut(FADE_SEC)
        this.dispatch({ type: 'oneShotEnded' })
        this.drainQueue()
      }
    }
    this.autoBlink = this.blink.update(dt)
    const speech = this.speechSource?.()
    if (speech && speech.level !== null) {
      // 音声の音量に合わせて口を開閉する(リップシンク)。乱数の口パクは止めて、閉じておく
      this.autoMouth = this.audioMouth.update(speech.level, dt)
      this.mouth.update(dt, false)
    } else {
      this.audioMouth.update(0, dt)
      this.autoMouth = this.mouth.update(dt, this.state.kind === 'speaking' || performance.now() < this.lipUntil || speech?.speaking === true)
    }
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.vrm.scene)
  }
}
