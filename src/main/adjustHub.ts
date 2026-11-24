import type { BrowserWindow } from 'electron'
import {
  clampValue,
  composeLayers,
  defaultValues,
  nonDefaultValues,
  normalizePresetName,
  presetToValues,
  pushLayer,
  readDefaultPreset,
  readPresets,
  readOrientation,
  removeLayers,
  type AdjustLayer,
  type AdjustSnapshot,
  type LayerMode,
  type Presets
} from '../shared/adjust'
import { clampPitch, wrapDeg, type Orientation } from '../shared/character/yaw'
import { IPC } from '../shared/ipc'
import type { ProfileStore } from './profileStore'

/**
 * キャラ調整の中継役。モデルを持つキャラウィンドウと、操作するパネルの間を取り持ち、
 * 最新のスナップショットを保持して、変更のたびにモデルごとのプロファイルへ保存する。
 */
export class AdjustHub {
  private snapshot: AdjustSnapshot | null = null
  /** 名前つきのセット(このモデルの分)。名前 → 項目の値 */
  private presets: Presets = {}
  /** 「標準」に決めたセット(このモデルの分)。無ければ null */
  private defaultPreset: string | null = null
  /** キャラの向き(左右・上下。度)。このモデルの分 */
  private orientation: Orientation = { yaw: 0, pitch: 0 }
  private saveTimer: NodeJS.Timeout | null = null
  /** 手で調整した値(基準値。保存する)。snapshot.values は、これにレイヤーを重ねた、いま見えている値 */
  private base: Record<string, number> = {}
  /** 重ねて適用しているセット(古い順。保存しない)と、それぞれを外すタイマー */
  private layers: AdjustLayer[] = []
  private readonly layerTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly profiles: ProfileStore,
    private readonly character: () => BrowserWindow | undefined,
    private readonly panel: () => BrowserWindow | undefined
  ) {}

  getSnapshot(): AdjustSnapshot | null {
    return this.snapshot
  }

  /** キャラウィンドウが、読み込んだモデルの項目一覧と現在値を届ける(null=モデルなし) */
  publish(snapshot: AdjustSnapshot | null): void {
    this.flush()
    this.clearLayers()
    this.snapshot = snapshot
    this.base = snapshot ? { ...snapshot.values } : {}
    // 保存済みのセットを読み込んで、名前をスナップショットに入れる
    const profile = snapshot ? this.profiles.read(snapshot.modelHash) : null
    this.presets = snapshot ? readPresets(profile) : {}
    this.orientation = readOrientation(profile)
    this.defaultPreset = snapshot ? readDefaultPreset(profile) : null
    if (snapshot) {
      snapshot.presets = Object.keys(this.presets)
      snapshot.defaultPreset = this.defaultPreset
    }
    this.syncLayersInfo()
    this.notifyPanel()
  }

  set(key: string, value: number): void {
    const s = this.snapshot
    const item = s?.items.find((i) => i.key === key)
    if (!s || !item) return
    const v = clampValue(item, value)
    this.base[key] = v // 手で調整した値は基準値。重ねているセットは、そのまま残る
    if (this.layers.length === 0) {
      s.values[key] = v
      this.character()?.webContents.send(IPC.adjustApply, { key, value: v })
    } else {
      this.applyComposed() // レイヤーが大きい値を持つ項目は、見た目が変わらないことがある
    }
    this.scheduleSave()
  }

  /** キャラの向き(左右・上下。度)を保存する(キャラウィンドウから。描画は向こうで済んでいる) */
  setOrientation(yaw: number, pitch: number): void {
    if (!this.snapshot) return
    this.orientation = { yaw: wrapDeg(yaw), pitch: clampPitch(pitch) }
    this.scheduleSave()
  }

  /** 保存している向き(度) */
  getOrientation(): Orientation {
    return { ...this.orientation }
  }

  /** いま重ねている表情・衣装セット(コピー。緊急リセットの「元に戻す」のため) */
  snapshotLayers(): AdjustLayer[] {
    return this.layers.map((l) => ({ ...l, values: { ...l.values } }))
  }

  /** 記録した表情・衣装セットの重なりへ戻す(自動で外れるタイマーは、戻さない) */
  restoreLayers(layers: AdjustLayer[]): void {
    this.clearLayers()
    this.layers = layers.map((l) => ({ ...l, values: { ...l.values } }))
    this.applyComposed()
  }

  reset(): void {
    const s = this.snapshot
    if (!s) return
    this.clearLayers() // 重ねているセットも外す
    this.base = defaultValues(s.items)
    s.values = { ...this.base }
    this.syncLayersInfo()
    this.character()?.webContents.send(IPC.adjustResetAll)
    this.notifyPanel()
    this.scheduleSave()
  }

  // --- 名前をつけて保存(プリセット) ---
  /** いまの調整を、名前をつけて保存する(同じ名前なら上書き) */
  savePreset(rawName: string): { ok: boolean; message: string } {
    const s = this.snapshot
    const name = normalizePresetName(rawName)
    if (!s) return { ok: false, message: 'モデルが読み込まれていません' }
    if (!name) return { ok: false, message: '名前は、1〜40文字で入力してください' }
    const existed = name in this.presets
    this.presets[name] = nonDefaultValues(s.items, s.values)
    this.afterPresetsChanged()
    return { ok: true, message: existed ? `「${name}」を上書きしました` : `「${name}」として保存しました` }
  }

  /** 保存したセットを「標準」に決める(null で解除)。見た目は変えない。「標準に戻す」で、このセットに戻る */
  setDefaultPreset(name: string | null): { ok: boolean; message: string } {
    if (!this.snapshot) return { ok: false, message: 'モデルが読み込まれていません' }
    if (name !== null && !(name in this.presets)) return { ok: false, message: 'セットが見つかりません' }
    this.defaultPreset = name
    this.afterPresetsChanged()
    return { ok: true, message: name === null ? '標準の設定を解除しました' : `「${name}」を標準にしました` }
  }

  /**
   * 標準の表情・衣装に戻す: 重ねているセットをすべて外し、標準のセットがあれば、それを基準値にする
   * (標準を決めていなければ、重ねたセットを外すだけで、基準値はそのまま)。
   */
  resetLook(): void {
    const s = this.snapshot
    if (!s) return
    this.clearLayers()
    const preset = this.defaultPreset !== null ? this.presets[this.defaultPreset] : undefined
    if (preset) {
      this.base = presetToValues(s.items, preset)
      this.scheduleSave()
    }
    this.applyComposed()
  }

  deletePreset(name: string): { ok: boolean; message: string } {
    if (!(name in this.presets)) return { ok: false, message: 'セットが見つかりません' }
    delete this.presets[name]
    if (this.defaultPreset === name) this.defaultPreset = null
    this.afterPresetsChanged()
    return { ok: true, message: `「${name}」を削除しました` }
  }

  /**
   * 保存したセットを適用する。
   * - パネルの「呼び出す」(transient=false): 状態まるごと(セットに無い項目は既定値)が基準値になり、モデルのプロファイルに保存される。重ねていたセットは外れる。
   * - 一時適用(transient=true。ルール・パネルの「重ねる」): 基準値は変えず、レイヤーとして重ねる(保存しない)。
   *   mode=overlay(既定): セットで変えた項目だけを重ねる。mode=replace: 状態まるごと置き換える(外すと元に戻る)。
   *   同じセットをもう一度適用すると、いちばん上に移り、タイマーも作り直す。revertAfterSec 秒後に外す(0 なら、外すまで続く)。
   */
  applyPreset(
    name: string,
    opts: { transient?: boolean; revertAfterSec?: number; mode?: LayerMode; source?: string | null } = {}
  ): { ok: boolean; message: string } {
    const s = this.snapshot
    const preset = this.presets[name]
    if (!s) return { ok: false, message: 'モデルが読み込まれていません' }
    if (!preset) return { ok: false, message: `セット「${name}」は、このモデルにありません` }
    if (!opts.transient) {
      this.clearLayers()
      this.base = presetToValues(s.items, preset)
      this.applyComposed()
      this.scheduleSave()
      return { ok: true, message: `「${name}」を適用しました` }
    }
    const mode: LayerMode = opts.mode === 'replace' ? 'replace' : 'overlay'
    const values = mode === 'replace' ? presetToValues(s.items, preset) : { ...preset }
    this.clearLayerTimer(name)
    this.layers = pushLayer(this.layers, { id: name, source: opts.source ?? null, mode, values })
    const sec = opts.revertAfterSec ?? 0
    if (sec > 0) this.layerTimers.set(name, setTimeout(() => this.revert({ name }), sec * 1000))
    this.applyComposed()
    return { ok: true, message: `「${name}」を${mode === 'replace' ? '置き換えて' : '重ねて'}適用しました` }
  }

  /**
   * 重ねているセットを外す。name を指定すればそのセット、source を指定すればその Mod が重ねたもの、どちらも無ければすべて。
   * 外したあとは、残りのレイヤーと基準値から、見た目を作り直す(重ねていなければ、何も起きない)。
   */
  revert(filter: { name?: string; source?: string } = {}): void {
    if (this.layers.length === 0) return
    const kept = removeLayers(this.layers, filter)
    for (const l of this.layers) if (!kept.includes(l)) this.clearLayerTimer(l.id)
    this.layers = kept
    this.applyComposed()
  }

  private clearLayerTimer(id: string): void {
    const t = this.layerTimers.get(id)
    if (t) clearTimeout(t)
    this.layerTimers.delete(id)
  }

  private clearLayers(): void {
    for (const t of this.layerTimers.values()) clearTimeout(t)
    this.layerTimers.clear()
    this.layers = []
  }

  /** 基準値にレイヤーを重ねた値を、キャラとパネルに知らせる */
  private applyComposed(): void {
    const s = this.snapshot
    if (!s) return
    s.values = composeLayers(s.items, this.base, this.layers)
    this.syncLayersInfo()
    this.character()?.webContents.send(IPC.adjustApplyAll, s.values)
    this.notifyPanel()
  }

  private syncLayersInfo(): void {
    if (this.snapshot) this.snapshot.layers = this.layers.map((l) => ({ id: l.id, mode: l.mode }))
  }

  private afterPresetsChanged(): void {
    if (this.snapshot) {
      this.snapshot.presets = Object.keys(this.presets)
      this.snapshot.defaultPreset = this.defaultPreset
    }
    this.notifyPanel()
    this.saveNow()
  }

  flush(): void {
    if (!this.saveTimer) return
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.saveNow()
  }

  private notifyPanel(): void {
    this.panel()?.webContents.send(IPC.adjustSnapshot, this.snapshot)
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
    }, 400)
  }

  private saveNow(): void {
    const s = this.snapshot
    if (!s) return
    // 保存するのは、手で調整した基準値だけ(重ねているセットは保存しない)
    this.profiles.write(s.modelHash, nonDefaultValues(s.items, this.base), this.presets, this.orientation, this.defaultPreset)
  }
}
