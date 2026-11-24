import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { panelBounds, type Rect } from '../shared/geometry'
import { loadRenderer } from './renderer'

const PANEL_SIZE = { width: 340, height: 600 }

/** 表情・衣装パネル。キャラの隣に出て、キャラが動くと位置も追従する枠なしの別ウィンドウ */
export class PanelWindow {
  private win: BrowserWindow | null = null

  constructor(private readonly characterBounds: () => Rect) {}

  get window(): BrowserWindow | undefined {
    return this.win && !this.win.isDestroyed() ? this.win : undefined
  }

  get visible(): boolean {
    return this.window?.isVisible() ?? false
  }

  toggle(): void {
    if (this.visible) this.hide()
    else this.show()
  }

  show(): void {
    if (!this.window) this.create()
    this.follow()
    this.window?.show()
  }

  hide(): void {
    this.window?.hide()
  }

  /** キャラの位置・大きさが変わったとき */
  follow(): void {
    const win = this.window
    if (!win) return
    const char = this.characterBounds()
    const workArea = screen.getDisplayMatching(char).workArea
    win.setBounds(panelBounds(char, PANEL_SIZE, workArea))
  }

  private create(): void {
    const win = new BrowserWindow({
      ...PANEL_SIZE,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#1d1e26',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    // キャラウィンドウ(最前面)に隠れないよう同じレベルにする
    win.setAlwaysOnTop(true, 'screen-saver')
    win.on('closed', () => (this.win = null))
    loadRenderer(win, 'panel')
    this.win = win
  }
}
