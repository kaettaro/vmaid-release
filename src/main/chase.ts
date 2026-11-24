import { BrowserWindow, screen } from 'electron'
import { IPC } from '../shared/ipc'
import { CHASE_ID, ChasePatchSchema, ChaseSchema, type ChaseView } from '../shared/chase'
import type { SettingsStore } from './settingsStore'

/** カーソルを読む間隔(ミリ秒)。約 30 回/秒 */
const POLL_MS = 33

/** キャラ窓へ送る、カーソルの位置。screen は OS の画面座標、window はキャラ窓の中身の左上の画面座標(どちらも DIP) */
export interface ChaseCursorMessage {
  x: number
  y: number
  wx: number
  wy: number
}

/**
 * 機能 Mod「追いかけ」の main 側。設定の保存と、全ウィンドウへの通知と、Mod が ON の間だけ、OS のカーソル位置を読んで、キャラ窓へ送る。
 * 読むのは、画面上のカーソルの座標だけ(ローカル。通信しない・保存しない)。
 */
export class ChaseController {
  private timer: NodeJS.Timeout | null = null
  private last = ''

  constructor(
    private readonly store: SettingsStore,
    private readonly character: () => BrowserWindow | undefined
  ) {}

  enabled(): boolean {
    return this.store.get().mods.features.includes(CHASE_ID)
  }

  view(): ChaseView {
    return { ...this.store.get().chase, enabled: this.enabled() }
  }

  /** 設定・Mod の ON/OFF が変わったとき: 全ウィンドウへ知らせ、カーソルの読み取りを始める・止める */
  changed(): void {
    const view = this.view()
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.chaseChanged, view)
    this.sync()
  }

  save(raw: unknown): ChaseView {
    const parsed = ChasePatchSchema.safeParse(raw)
    if (parsed.success) {
      this.store.update((s) => {
        s.chase = ChaseSchema.parse({ ...s.chase, ...parsed.data })
      })
      this.changed()
    }
    return this.view()
  }

  /** Mod が ON なら読み取りを始め、OFF なら止める */
  sync(): void {
    if (this.enabled()) this.start()
    else this.stop()
  }

  private start(): void {
    if (this.timer) return
    this.last = ''
    this.timer = setInterval(() => this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private poll(): void {
    const win = this.character()
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const p = screen.getCursorScreenPoint()
    const b = win.getContentBounds()
    const key = `${p.x},${p.y},${b.x},${b.y}`
    if (key === this.last) return // 動いていなければ、送らない
    this.last = key
    const msg: ChaseCursorMessage = { x: p.x, y: p.y, wx: b.x, wy: b.y }
    win.webContents.send(IPC.chaseCursor, msg)
  }
}
