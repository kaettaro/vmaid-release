import { join } from 'node:path'
import { BrowserWindow, type WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import { loadRenderer } from './renderer'

let win: BrowserWindow | null = null
/** 窓の読み込みが終わる前に来た「再生して」の要求(最後の1つ) */
let pending: string | null = null
let ready = false

/** モーション試し再生の窓(別ウィンドウ)。いまのキャラのモデルで、指定のモーションを再生する。開いていれば前面に出して再生する */
export function openPreviewWindow(name?: string): void {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    if (name) sendPlay(name)
    return
  }
  ready = false
  pending = name ?? null
  win = new BrowserWindow({
    width: 700,
    height: 640,
    minWidth: 560,
    minHeight: 420,
    title: 'VMaid モーションの試し再生',
    backgroundColor: '#1d1e26',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)
  win.on('closed', () => {
    win = null
    ready = false
    pending = null
  })
  loadRenderer(win, 'preview')
}

/** 窓が、再生の要求を受け取れる状態になった(窓自身からの通知。ほかの窓からは受け付けない) */
export function previewReady(sender: WebContents): void {
  if (!win || win.isDestroyed() || win.webContents !== sender) return
  ready = true
  if (pending) {
    const name = pending
    pending = null
    sendPlay(name)
  }
}

function sendPlay(name: string): void {
  if (!win || win.isDestroyed()) return
  if (!ready) {
    pending = name
    return
  }
  win.webContents.send(IPC.previewWinPlay, name)
}

/** 再生中のモーションの状態を、再生ウィンドウへ送る(窓が無ければ、何もしない) */
export function sendPlaybackToPreview(info: unknown): void {
  if (win && !win.isDestroyed() && ready) win.webContents.send(IPC.motionProgress, info)
}
