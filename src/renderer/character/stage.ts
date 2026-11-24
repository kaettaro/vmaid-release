import type { AdjustSnapshot } from '@shared/adjust'
import type { ModelFile, MotionState } from '@shared/ipc'
import type { Orientation } from '@shared/character/yaw'
import type { PropSpec } from '@shared/packs/manifest'
import type { PropPayload } from '@shared/props/formats'
import type { CustomTouchPart, TouchResult } from '@shared/touch/parts'
import type { ResolvedBeautify } from '@shared/beautify'
import type { ChaseSettings } from '@shared/chase'
import type { PlaybackInfo } from '@shared/motions/playback'

/**
 * キャラを描く「ステージ」の共通の形(VRM 用の VrmStage と、MMD 対応 Mod の MmdStage)。
 * App は、読み込むモデルの種類に合わせて、ステージを入れ替える。
 */
export interface CharacterStage {
  readonly kind: 'vrm' | 'mmd'
  readonly hasModel: boolean
  readonly isHit: boolean

  /** 音声合成の再生状況(リップシンク用) */
  speechSource: (() => { level: number | null; speaking: boolean }) | null
  /** 当たり判定の結果が変わったとき */
  onHitChange: (hit: boolean) => void
  /** 頭のてっぺんの、ウィンドウ内の高さ(css px)が変わったとき */
  onLayout: (headTopPx: number | null) => void
  /** モーション1件の中身を取ってくる(main へ問い合わせる)。無ければ null */
  motionLoader: (name: string) => Promise<Uint8Array | null>
  /** モーションを読み込めなかったとき */
  onMotionError: (name: string) => void
  /** 単発モーションが実際に始まった・終わったとき(音楽を同時に始める・止めるため)。破棄された要求では呼ばれない */
  onMotionStart: (name: string) => void
  onMotionEnd: (name: string) => void

  /** モデルを読み込んで表示する。モデルごとの調整値(profile)を反映して、表情・衣装パネル用の項目を返す */
  loadFile(file: ModelFile, rawProfile: unknown): Promise<AdjustSnapshot | null>

  setOrientation(o: Orientation, instant?: boolean): void
  getOrientation(): Orientation
  /** カメラのフィットの再計算を止める・再開する(歩いている間、体を一時的に回しても、窓の中でキャラが上下しないように) */
  setFitLocked(locked: boolean): void
  setPointer(clientX: number | null, clientY: number | null): void
  touchAt(clientX: number, clientY: number): TouchResult | null
  /** Mod が宣言した触れ合いの部位(有効なものだけ)。touchAt が、本体の部位より先に判定する */
  setTouchParts(parts: readonly CustomTouchPart[]): void

  adjustSet(key: string, value: number): void
  adjustResetAll(): void
  adjustSetAll(values: Record<string, number>): void

  hasMotion(name: string): boolean
  motionsWithTag(tag: string): string[]
  playMotion(name: string, opts?: { durationSec?: number; queue?: boolean; interrupt?: boolean }): void
  setMotions(state: MotionState): void
  /** 再生中の単発モーションを止めて、待機に戻す(再生していなければ、何もしない) */
  stopMotion(): void
  /** 再生中の単発モーションの状態(再生していなければ null)。再生ウィンドウの、進み具合の表示用 */
  getPlayback(): PlaybackInfo | null
  /** 再生中の単発モーションの位置を、sec 秒へ動かす(BGM は動かない) */
  seek(sec: number): void
  /** 再生中の単発モーションを、一時停止・再開する */
  setPaused(paused: boolean): void
  /** source は、出したルールの Mod の id(自分のルールなら省略)。Mod を OFF にしたとき、その Mod の表情を解除するのに使う */
  setExpression(name: string, value: number, durationSec: number, source?: string | null): void
  /** Mod の小道具(glb)を、骨に付けて表示する。durationSec が 0 なら、hideProp まで */
  showProp(id: string, payload: PropPayload, spec: PropSpec, durationSec: number, source: string | null): Promise<void>
  hideProp(id: string): void
  /** keep に含まれない Mod が出した効果(小道具・表情の上書き)を、すべて解除する(自分のルールのものは、残す)。keep を空にすると、Mod の効果をすべて解除する */
  releaseSources(keep: ReadonlySet<string>, all?: boolean): void
  /** 出している小道具を、すべて消す */
  clearProps(): void
  /** 美化(機能 Mod「美化(リアル)」「美化(トゥーン)」)の描画を、切り替える。null なら、元の描画に戻す */
  setBeautify(spec: ResolvedBeautify): void
  /** 追いかけ(機能 Mod)の設定。null なら OFF(すぐ正面へ戻る) */
  setChase(settings: ChaseSettings | null): void
  /** カーソルの位置(キャラウィンドウの中のピクセル)。まだ届いていない・取れないときは null */
  setChaseCursor(point: { x: number; y: number } | null): void
  lipSync(durationMs: number): void
  speakStart(): void
  speakEnd(): void

  dispose(): void
}
