import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

/** 開発時は dev サーバー、本番はビルド済みHTMLを読む */
export function loadRenderer(win: BrowserWindow, entry: 'character' | 'settings' | 'panel' | 'overlay' | 'preview' | 'game' | 'movearea' | 'modlist'): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${entry}/index.html`)
  } else {
    void win.loadFile(join(import.meta.dirname, `../renderer/${entry}/index.html`))
  }
}
