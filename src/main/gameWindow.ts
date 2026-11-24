import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { panelBounds, type Rect } from '../shared/geometry'
import { IPC } from '../shared/ipc'
import type { GameState } from '../shared/game/types'
import { loadRenderer } from './renderer'

/** 盤面の窓の、初めの大きさ(遊ぶゲームごとに、show で変える) */
const DEFAULT_SIZE = { width: 320, height: 540 }

/** ゲームの盤面の窓。キャラの隣に出て、キャラが動くと位置も追従する枠なしの別ウィンドウ(表情・衣装パネルと同じ作り) */
export class GameWindow {
  private win: BrowserWindow | null = null
  private size: { width: number; height: number } = DEFAULT_SIZE

  constructor(private readonly characterBounds: () => Rect) {}

  /** 窓を出す。size は、そのゲームの盤面に合わせた大きさ(窓が出ている最中に、別のゲームを始めたら、大きさを変える) */
  show(size: { width: number; height: number } = DEFAULT_SIZE): void {
    this.size = size
    if (!this.win || this.win.isDestroyed()) this.create()
    this.follow()
    this.win?.show()
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close()
    this.win = null
  }

  follow(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    const char = this.characterBounds()
    win.setBounds(panelBounds(char, this.size, screen.getDisplayMatching(char).workArea))
  }

  /** 盤面の状態を、窓へ送る(窓が無ければ、何もしない。窓は、起動時に、自分で取りに来る) */
  send(state: GameState): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(IPC.gameState, state)
  }

  private create(): void {
    const win = new BrowserWindow({
      ...this.size,
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
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    loadRenderer(win, 'game')
    this.win = win
  }
}
