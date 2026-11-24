import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { loadRenderer } from './renderer'

let win: BrowserWindow | null = null

/** 設定ウィンドウ(別ウィンドウ)。既に開いていれば前面に出す */
export function openSettingsWindow(): void {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 720,
    height: 520,
    title: 'VMaid 設定',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)
  win.on('closed', () => (win = null))
  loadRenderer(win, 'settings')
}
