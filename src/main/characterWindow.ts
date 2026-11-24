import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { IPC, type DisplayState, type ModelFile, type MotionState } from '../shared/ipc'
import {
  boundsAfterScale,
  clampScale,
  defaultPosition,
  isRectVisible,
  windowSizeForScale,
  type Rect
} from '../shared/geometry'
import { loadRenderer } from './renderer'
import type { SettingsStore } from './settingsStore'

/** 枠なし・透過・最前面のキャラウィンドウ */
export class CharacterWindow {
  readonly win: BrowserWindow
  private dragOrigin: { x: number; y: number } | null = null

  constructor(
    private readonly store: SettingsStore,
    private readonly onStateChanged: () => void,
    /** 位置・大きさが変わったとき(表情・衣装パネルの追従用) */
    private readonly onBoundsChanged: () => void = () => {}
  ) {
    const { display, window: pos } = store.get()
    const size = windowSizeForScale(display.scale)
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    const saved = pos.x !== null && pos.y !== null ? { x: pos.x, y: pos.y, ...size } : null
    const origin =
      saved && isRectVisible(saved, areas)
        ? { x: saved.x, y: saved.y }
        : defaultPosition(screen.getPrimaryDisplay().workArea, size)

    this.win = new BrowserWindow({
      ...origin,
      ...size,
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 背面でもアニメ・当たり判定を止めない(常駐キャラのため)
        backgroundThrottling: false
      }
    })

    this.applyAlwaysOnTop(display.alwaysOnTop)
    this.win.on('ready-to-show', () => {
      if (store.get().display.showOnStartup) this.win.showInactive()
      this.onStateChanged()
    })
    this.win.on('show', this.onStateChanged)
    this.win.on('hide', this.onStateChanged)
    loadRenderer(this.win, 'character')
  }

  get displayState(): DisplayState {
    const { scale, clickThrough } = this.store.get().display
    return { scale, clickThrough }
  }

  get visible(): boolean {
    return this.win.isVisible()
  }

  private applyAlwaysOnTop(on: boolean): void {
    if (on) {
      // 'screen-saver' レベルでフルスクリーンアプリの上にも出す。
      // macOS: visibleOnFullScreen を使うとDockアイコンが消えるため再表示する(要実機確認)
      this.win.setAlwaysOnTop(true, 'screen-saver')
      if (process.platform === 'darwin') {
        this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        void app.dock?.show()
      }
    } else {
      this.win.setAlwaysOnTop(false)
    }
  }

  /** 入力欄用にキーボードフォーカスを得る。常駐キャラは showInactive で出しているため明示的に前面化する */
  focus(): void {
    app.focus({ steal: true })
    this.win.focus()
  }

  toggleVisible(): void {
    if (this.win.isVisible()) this.win.hide()
    else this.win.showInactive()
  }

  toggleClickThrough(): void {
    const next = !this.store.get().display.clickThrough
    this.store.update((s) => (s.display.clickThrough = next))
    // OFFにしたら即座に全面でマウスを受ける。ONの間の判定はレンダラーが当たり判定で行う
    if (!next) this.win.setIgnoreMouseEvents(false)
    this.broadcastDisplay()
  }

  /** 最前面にするか(基本設定) */
  setAlwaysOnTop(on: boolean): void {
    this.store.update((s) => (s.display.alwaysOnTop = on))
    this.applyAlwaysOnTop(on)
    this.broadcastDisplay()
  }

  /** クリック透過(基本設定)。OFF にしたら、すぐ全面でマウスを受ける */
  setClickThrough(on: boolean): void {
    this.store.update((s) => (s.display.clickThrough = on))
    if (!on) this.win.setIgnoreMouseEvents(false)
    this.broadcastDisplay()
  }

  /** 起動時に表示するか(基本設定。いまの表示は変えない) */
  setShowOnStartup(on: boolean): void {
    this.store.update((s) => (s.display.showOnStartup = on))
  }

  /**
   * 緊急リセット: キャラを、初期の表示に戻す。表示にして、主画面の右下に置き、倍率 1・クリック透過 OFF(全面でマウスを受ける)にする。
   * モデルが消えた・画面の外に出た・非表示にしてしまった、で、設定を開けなくなったときの、最後の手段。保存済みのほかの設定は、変えない
   */
  resetToDefault(): void {
    const size = windowSizeForScale(1)
    const origin = defaultPosition(screen.getPrimaryDisplay().workArea, size)
    this.win.setBounds({ ...origin, ...size })
    this.store.update((s) => {
      s.display.scale = 1
      s.display.clickThrough = false
    })
    this.win.setIgnoreMouseEvents(false)
    this.win.showInactive()
    this.applyAlwaysOnTop(this.store.get().display.alwaysOnTop)
    this.onBoundsChanged()
    this.savePosition()
    this.broadcastDisplay()
  }

  /** 緊急リセットの直前の状態(「元に戻す」のため) */
  captureState(): { bounds: Rect; scale: number; clickThrough: boolean; visible: boolean } {
    const { scale, clickThrough } = this.store.get().display
    return { bounds: this.win.getBounds(), scale, clickThrough, visible: this.win.isVisible() }
  }

  /** 記録した状態へ戻す(位置・大きさ・倍率・クリック透過・表示/非表示) */
  restoreState(s: { bounds: Rect; scale: number; clickThrough: boolean; visible: boolean }): void {
    this.win.setBounds(s.bounds)
    this.store.update((st) => {
      st.display.scale = s.scale
      st.display.clickThrough = s.clickThrough
    })
    if (!s.clickThrough) this.win.setIgnoreMouseEvents(false)
    if (s.visible) this.win.showInactive()
    else this.win.hide()
    this.onBoundsChanged()
    this.savePosition()
    this.broadcastDisplay()
  }

  setIgnoreMouse(ignore: boolean): void {
    if (ignore && this.store.get().display.clickThrough) {
      // forward: true でマウス移動だけはレンダラーに届け、当たり判定を続ける
      this.win.setIgnoreMouseEvents(true, { forward: true })
    } else {
      this.win.setIgnoreMouseEvents(false)
    }
  }

  dragStart(): void {
    const [x, y] = this.win.getPosition()
    this.dragOrigin = { x, y }
  }

  dragMove(dx: number, dy: number): void {
    if (!this.dragOrigin) return
    // Windowsの高DPIでsetPositionだけだとサイズが変わる不具合を避け、サイズ込みのsetBoundsを使う
    const { width, height } = this.win.getBounds()
    this.win.setBounds({
      x: Math.round(this.dragOrigin.x + dx),
      y: Math.round(this.dragOrigin.y + dy),
      width,
      height
    })
    this.onBoundsChanged()
  }

  /** 位置だけ動かす(サイズはそのまま。移動の Mod が使う)。パネル・ゲーム窓・画面効果も追従する。保存は、終わったときに persistPosition() */
  moveTo(x: number, y: number): void {
    const { width, height } = this.win.getBounds()
    this.win.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
    this.onBoundsChanged()
  }

  /** いまの位置を、設定に保存する */
  persistPosition(): void {
    this.savePosition()
  }

  dragEnd(): void {
    this.dragOrigin = null
    this.savePosition()
  }

  setScale(scale: number): void {
    const next = clampScale(scale)
    this.win.setBounds(boundsAfterScale(this.win.getBounds(), next))
    this.onBoundsChanged()
    this.store.update((s) => (s.display.scale = next))
    this.savePosition()
    this.broadcastDisplay()
  }

  private savePosition(): void {
    const [x, y] = this.win.getPosition()
    this.store.update((s) => {
      s.window.x = x
      s.window.y = y
    })
  }

  private broadcastDisplay(): void {
    this.win.webContents.send(IPC.displayChanged, this.displayState)
    this.onStateChanged()
  }

  sendMotions(state: MotionState): void {
    this.win.webContents.send(IPC.motionChanged, state)
  }

  sendModel(file: ModelFile): void {
    this.win.webContents.send(IPC.modelLoad, file)
  }
}
