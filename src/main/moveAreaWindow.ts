import { join } from 'node:path'
import { BrowserWindow, screen, type WebContents } from 'electron'
import type { Rect } from '../shared/geometry'
import { IPC } from '../shared/ipc'
import { sanitizeRects } from '../shared/move'
import type { MoveAreaInit } from '../shared/moveArea'
import { loadRenderer } from './renderer'

/**
 * 移動範囲を決める窓: ディスプレイごとに 1 枚、暗い半透明の全画面窓を出し、ドラッグで矩形を描く。
 * 矩形は全ディスプレイ共通の絶対座標。ひとつの窓で変えたら、他の窓へも伝える。
 * Enter / 保存で確定、Esc で取り消し。ディスプレイの構成が変わったら、取り消して閉じる。
 */
export class MoveAreaWindow {
  private readonly wins = new Map<number, BrowserWindow>()
  private rects: Rect[] = []
  private done: ((rects: Rect[] | null) => void) | null = null

  constructor(private readonly guideSize: () => { width: number; height: number }) {
    const cancel = (): void => this.finish(false)
    screen.on('display-added', cancel)
    screen.on('display-removed', cancel)
    screen.on('display-metrics-changed', cancel)
  }

  get active(): boolean {
    return this.done !== null
  }

  /** 窓を出す。確定したら矩形、取り消したら null で、返事が来る */
  open(initial: Rect[]): Promise<Rect[] | null> {
    this.finish(false)
    this.rects = sanitizeRects(initial)
    return new Promise((resolve) => {
      this.done = resolve
      for (const d of screen.getAllDisplays()) this.wins.set(d.id, this.create(d.id, d.bounds))
    })
  }

  /** 窓が起動時に取りに来る: その窓のディスプレイの位置・大きさと、いまの矩形 */
  init(sender: WebContents): MoveAreaInit | null {
    for (const [, w] of this.wins) {
      if (w.isDestroyed() || w.webContents !== sender) continue
      const b = w.getBounds()
      return { origin: { x: b.x, y: b.y }, size: { width: b.width, height: b.height }, rects: this.rects, guide: this.guideSize() }
    }
    return null
  }

  /** 窓が矩形を変えた: 受け取って、他の窓へ伝える */
  change(sender: WebContents, raw: unknown): void {
    this.rects = sanitizeRects(raw)
    for (const w of this.wins.values()) if (!w.isDestroyed() && w.webContents !== sender) w.webContents.send(IPC.moveAreaRects, this.rects)
  }

  finish(save: boolean): void {
    const done = this.done
    this.done = null
    const rects = this.rects
    for (const w of this.wins.values()) if (!w.isDestroyed()) w.destroy()
    this.wins.clear()
    done?.(save ? rects : null)
  }

  private create(_id: number, bounds: Electron.Rectangle): BrowserWindow {
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
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    w.setAlwaysOnTop(true, 'screen-saver')
    if (process.platform === 'darwin') w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    w.once('ready-to-show', () => {
      if (w.isDestroyed()) return
      w.show()
      w.focus() // Enter / Esc を受けるため
    })
    loadRenderer(w, 'movearea')
    return w
  }
}
