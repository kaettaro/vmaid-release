import { screen } from 'electron'
import { IPC } from '../shared/ipc'
import { facingYaw, MOVE_ID, type MoveMessage, MovePatchSchema, MoveSchema, nextRoamDelayMs, pickAutoMode, pickTarget, positionAt, rectWorks, walkDurationMs, warpAt, type MoveMode, type MoveTarget, type MoveView, type Point } from '../shared/move'
import { expandRect, warpEffectSpec } from '../shared/overlay'
import type { CharacterWindow } from './characterWindow'
import type { OverlayWindows } from './overlayWindow'
import type { SettingsStore } from './settingsStore'

/** ウィンドウを動かす間隔(ミリ秒)。約 60 回/秒 */
const TICK_MS = 16

interface Anim {
  mode: MoveMode
  from: Point
  to: Point
  startedAt: number
  /** 歩く時間(ミリ秒) */
  totalMs: number
  /** ワープ: 移った(ウィンドウの位置を動かした)か */
  jumped: boolean
  /** ワープの、消える・現れるそれぞれの時間(ミリ秒) */
  fadeMs: number
}

/**
 * 機能 Mod「より自由な移動」の main 側。キャラ窓を、歩かせる・ワープさせる。
 * 動かすのは、ウィンドウの位置だけ(サイズはそのまま)。パネル・ゲーム窓・画面効果は、動かすたびに追従する(CharacterWindow の onBoundsChanged)。
 * 中断: ドラッグ・緊急リセット・Mod の OFF・新しい移動の要求。自動の移動は、会話中・ゲーム中・キャラが非表示のときはしない。
 */
export class MoveController {
  private anim: Anim | null = null
  private timer: NodeJS.Timeout | null = null
  private roamTimer: NodeJS.Timeout | null = null
  /** レンダラーが知らせる「会話中(入力欄を開いている・返答中)」 */
  private chatBusy = false

  constructor(
    private readonly store: SettingsStore,
    private readonly character: () => CharacterWindow | null | undefined,
    /** ゲーム中など、自動で動かしたくないとき true */
    private readonly gameActive: () => boolean,
    /** ワープの粒の演出の窓(元の場所用・新しい場所用)。画面効果 Mod の ON/OFF とは別 */
    private readonly fxWindows: { from: OverlayWindows; to: OverlayWindows },
    private readonly rng: () => number = Math.random
  ) {}

  enabled(): boolean {
    return this.store.get().mods.features.includes(MOVE_ID)
  }

  view(): MoveView {
    return { ...this.store.get().move, enabled: this.enabled() }
  }

  save(raw: unknown): MoveView {
    const parsed = MovePatchSchema.safeParse(raw)
    if (parsed.success) {
      this.store.update((s) => {
        s.move = MoveSchema.parse({ ...s.move, ...parsed.data })
      })
      this.sync()
    }
    return this.view()
  }

  setChatBusy(busy: boolean): void {
    this.chatBusy = busy
  }

  /** Mod の ON/OFF・自動の設定が変わったとき: 自動の移動を、始める・止める。OFF なら、いまの移動もやめる */
  sync(): void {
    if (!this.enabled()) {
      this.stop()
      this.stopRoam()
      return
    }
    if (this.store.get().move.autoRoam) this.scheduleRoam()
    else this.stopRoam()
  }

  /** 移動を始める。Mod が OFF・キャラが見えない・移動先が決まらないときは、false */
  start(target: MoveTarget, mode: MoveMode): boolean {
    if (!this.enabled()) return false
    const ch = this.character()
    if (!ch || ch.win.isDestroyed() || !ch.win.isVisible()) return false
    this.interrupt() // 動いている最中なら、いまの位置から、新しい移動へ
    const bounds = ch.win.getBounds()
    const cursor = screen.getCursorScreenPoint()
    const s = this.store.get().move
    const workAreas = screen.getAllDisplays().map((d) => d.workArea)
    // 範囲を決めてあれば、その矩形と画面の交わる所だけ(どれも画面と交わらないときは、画面全体に戻る)
    const rw = s.areaMode === 'rects' ? rectWorks(s.rects, workAreas) : []
    const to = pickTarget(target, {
      window: bounds,
      works: rw.length > 0 ? rw : workAreas,
      constrained: rw.length > 0,
      cursor,
      rng: this.rng,
      settings: s
    })
    if (!to) return false
    const from = { x: bounds.x, y: bounds.y }
    const now = Date.now()
    if (mode === 'walk') {
      const totalMs = walkDurationMs(from, to, s.speed)
      this.anim = { mode, from, to, startedAt: now, totalMs, jumped: false, fadeMs: s.warpFadeMs }
      this.send({ kind: 'walk', yaw: facingYaw(from, to), tag: s.walkTag })
    } else {
      this.anim = { mode, from, to, startedAt: now, totalMs: s.warpFadeMs * 2 + 30, jumped: false, fadeMs: s.warpFadeMs }
      this.send({ kind: 'warp', phase: 'out' })
      this.showFx('from', bounds)
    }
    this.timer = setInterval(() => this.tick(), TICK_MS)
    return true
  }

  /** ワープの粒の演出を、窓の周り(窓より少し広く)に出す。where が合わないとき・OFF のときは出さない */
  private showFx(which: 'from' | 'to', win: Electron.Rectangle): void {
    const fx = this.store.get().move.warpFx
    if (!fx.enabled || !(fx.where === 'both' || fx.where === which)) return
    this.fxWindows[which].show({
      spec: warpEffectSpec(fx),
      intensity: 1,
      color: fx.colors[0] ?? '#b388ff',
      durationSec: fx.durationMs / 1000,
      scope: 'rect',
      rects: [expandRect(win, 0.3)],
      instant: true
    })
  }

  /** 設定画面の「演出だけ見る」: いまの窓の位置に、元の場所・新しい場所の演出を出す(窓は動かさない) */
  previewFx(): void {
    const ch = this.character()
    if (!ch || ch.win.isDestroyed()) return
    const b = ch.win.getBounds()
    this.showFx('from', b)
    this.showFx('to', b)
  }

  /** 動いている最中なら、やめる(その場で止まる。位置は、保存する) */
  interrupt(): void {
    if (!this.anim) return
    this.finish(false)
  }

  /** 移動をやめる(ルールのアクション・ドラッグ・リセット・Mod の OFF) */
  stop(): void {
    this.interrupt()
  }

  dispose(): void {
    this.fxWindows.from.hide()
    this.fxWindows.to.hide()
    this.stop()
    this.stopRoam()
  }

  private tick(): void {
    const a = this.anim
    const ch = this.character()
    if (!a || !ch || ch.win.isDestroyed()) {
      this.clearTimer()
      this.anim = null
      return
    }
    const elapsed = Date.now() - a.startedAt
    if (a.mode === 'walk') {
      const p = positionAt(a.from, a.to, elapsed, a.totalMs)
      ch.moveTo(p.x, p.y)
      if (elapsed >= a.totalMs) this.finish(true)
      return
    }
    const w = warpAt(elapsed, a.fadeMs)
    ch.win.setOpacity(w.opacity)
    if (w.phase !== 'out' && !a.jumped) {
      a.jumped = true
      ch.moveTo(a.to.x, a.to.y)
      this.send({ kind: 'warp', phase: 'in' })
      this.showFx('to', ch.win.getBounds())
    }
    if (w.phase === 'done') this.finish(true)
  }

  private finish(ended: boolean): void {
    const a = this.anim
    this.clearTimer()
    this.anim = null
    const ch = this.character()
    if (ch && !ch.win.isDestroyed()) {
      ch.win.setOpacity(1) // 消えている途中でやめても、必ず現す(消えたまま、見つからなくならないように)
      ch.persistPosition()
    }
    this.send({ kind: 'idle', ended, mode: a?.mode ?? null, warpTag: this.store.get().move.warpTag })
    if (ended) this.scheduleRoam() // 次の自動の移動を、予約し直す
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private send(m: MoveMessage): void {
    const ch = this.character()
    if (ch && !ch.win.isDestroyed()) ch.win.webContents.send(IPC.moveState, m)
  }

  // --- 自動で歩き回る ---
  private scheduleRoam(): void {
    this.stopRoam()
    if (!this.enabled() || !this.store.get().move.autoRoam) return
    this.roamTimer = setTimeout(() => {
      this.roamTimer = null
      this.roamOnce()
    }, nextRoamDelayMs(this.store.get().move, this.rng))
  }

  private stopRoam(): void {
    if (this.roamTimer) clearTimeout(this.roamTimer)
    this.roamTimer = null
  }

  private roamOnce(): void {
    const ch = this.character()
    const busy = this.chatBusy || this.gameActive() || !ch || ch.win.isDestroyed() || !ch.win.isVisible() || this.anim !== null
    if (!busy) this.start('random', pickAutoMode(this.store.get().move.warpChance, this.rng))
    if (!this.anim) this.scheduleRoam() // 動かなかったときは、また次の機会に(動いたときは、終わったときに予約する)
  }
}
