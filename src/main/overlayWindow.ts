import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { IPC } from '../shared/ipc'
import { characterOverlayBounds, type OverlayPayload, type OverlayScope } from '../shared/overlay'
import { loadRenderer } from './renderer'

/**
 * 画面効果の窓: 全画面の効果は、画面ごとに1枚、全体を覆う透過・枠なし・最前面・クリック透過のウィンドウ。
 * キャラ付近だけの効果は、キャラのウィンドウを広げた範囲に1枚(キャラが動くと、追いかける)。
 * 出している間だけ作り、消すときは窓ごと壊す(何も出していないときは、窓も、描画も無い)。
 * フォーカスは奪わず、マウスは常に素通しにする(操作を妨げない)。
 */
export class OverlayWindows {
  /** キー: 画面なら `d:<画面のid>`、キャラ付近なら `char` */
  private readonly wins = new Map<string, BrowserWindow>()
  private current: OverlayPayload | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  /** 読み込みが終わった窓(終わる前に送っても、描く側が受け取れない) */
  private readonly loaded = new WeakSet<BrowserWindow>()

  /** @param characterBounds キャラのウィンドウの位置と大きさ(キャラ付近の効果の範囲を決める) */
  constructor(private readonly characterBounds: () => Electron.Rectangle | null) {
    // 画面の抜き差し・解像度の変更に合わせる
    const resync = (): void => {
      if (this.current) this.sync()
    }
    screen.on('display-added', resync)
    screen.on('display-removed', resync)
    screen.on('display-metrics-changed', resync)
  }

  get active(): boolean {
    return this.current !== null
  }

  show(payload: OverlayPayload): void {
    const scopeChanged = this.current !== null && (this.current.scope !== payload.scope || payload.scope === 'rect')
    if (scopeChanged) this.destroyAll() // 範囲が変わるときは、窓を作り直す(矩形は、毎回、作り直す。粒を、最初から出すため)
    this.current = payload
    if (this.timer) clearTimeout(this.timer)
    // 時間で消すのは main が持つ(描く側が止まっても、残らないように)。消える演出の分だけ、少し待つ
    this.timer = payload.durationSec > 0 ? setTimeout(() => this.hide(), payload.durationSec * 1000 + 1500) : null
    this.sync()
    for (const w of this.wins.values()) this.send(w, payload)
  }

  hide(): void {
    this.current = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.destroyAll()
  }

  /** キャラが動いた・大きさが変わった(キャラ付近の効果が、追いかける) */
  followCharacter(): void {
    if (this.current?.scope === 'character') this.sync()
  }

  private destroyAll(): void {
    for (const w of this.wins.values()) if (!w.isDestroyed()) w.destroy()
    this.wins.clear()
  }

  /** 範囲に合わせて窓を整える(足りない窓を作り、不要な窓を壊し、位置・大きさを合わせる) */
  private sync(): void {
    const targets = new Map<string, Electron.Rectangle>()
    const scope: OverlayScope = this.current?.scope ?? 'screen'
    if (scope === 'rect') {
      this.current?.rects?.forEach((r, i) => targets.set(`r:${i}`, r))
    } else if (scope === 'character') {
      const c = this.characterBounds()
      if (c) targets.set('char', characterOverlayBounds(c))
    } else {
      for (const d of screen.getAllDisplays()) targets.set(`d:${d.id}`, d.bounds)
    }
    for (const [key, w] of this.wins) {
      if (!targets.has(key) || w.isDestroyed()) {
        if (!w.isDestroyed()) w.destroy()
        this.wins.delete(key)
      }
    }
    for (const [key, bounds] of targets) {
      const existing = this.wins.get(key)
      if (existing) existing.setBounds(bounds)
      else this.wins.set(key, this.create(bounds))
    }
  }

  private create(bounds: Electron.Rectangle): BrowserWindow {
    const w = new BrowserWindow({
      ...bounds,
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false, // キーボードフォーカスを受けない(入力を奪わない)
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    w.setIgnoreMouseEvents(true) // 常にクリック透過
    w.setAlwaysOnTop(true, 'screen-saver')
    if (process.platform === 'darwin') {
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      void app.dock?.show() // visibleOnFullScreen で Dock アイコンが消えるため(キャラ窓と同じ。要実機確認)
    }
    w.once('ready-to-show', () => {
      if (!w.isDestroyed()) w.showInactive()
    })
    // 読み込みが終わってから指示を送る(窓を作った直後の指示も取りこぼさない)
    w.webContents.once('did-finish-load', () => {
      this.loaded.add(w)
      if (this.current && !w.isDestroyed()) this.send(w, this.current)
    })
    loadRenderer(w, 'overlay')
    return w
  }

  private send(w: BrowserWindow, req: OverlayPayload): void {
    if (!w.isDestroyed() && this.loaded.has(w)) w.webContents.send(IPC.overlayShow, req)
  }
}
