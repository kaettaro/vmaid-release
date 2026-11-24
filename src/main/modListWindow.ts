import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, ipcMain, screen } from 'electron'
import { panelBounds, type Rect } from '../shared/geometry'
import { IPC } from '../shared/ipc'
import type { ModListState } from '../shared/modListApi'
import { sanitizeUiList, type UiList } from '../shared/scripts/uiList'
import { loadRenderer } from './renderer'
import type { SettingsStore } from './settingsStore'

// スクリプト Mod の「一覧窓」(host.ui.list)。Mod は、データ(見出し・アイコン・link)だけを渡し、窓はアプリ自身のページが描く。
// 守ること: Mod のデータは、渡されたときに作り直して検査する(uiList.ts)/ 窓から Mod へ届くのは「選んだ項目の id」だけ /
// ブラウザで開けるのは、直近に渡された項目の https の link だけ(窓から任意の URL は渡せない)/ 呼べるのは、その窓自身だけ(webContents.id で決める)

const MOD_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/
const DEFAULT_SIZE = { width: 380, height: 520 }

export interface ModListMod {
  id: string
  name: string
  /** 権限 openLink */
  canOpen: boolean
}

export interface ModListDeps {
  store: SettingsStore
  /** キャラ窓の位置(追従に使う)。無ければ null */
  characterBounds(): Rect | null
  /** いま有効で、一覧窓の権限(ui.list)を持つスクリプト Mod */
  mods(): ModListMod[]
  /** 最後に渡された一覧の保存先(userData/mod-ui) */
  dir: string
  /** 見出しを選んだことを、Mod のスクリプトへ届ける */
  deliver(modId: string, itemId: string): void
  openExternal(url: string): void
  /** 窓の表示状態が変わった(トレイ・設定画面を更新する) */
  onChange(): void
}

export class ModListWindows {
  private readonly wins = new Map<string, BrowserWindow>()
  private readonly byContents = new Map<number, string>()
  private readonly lists = new Map<string, UiList>()
  private moving = false
  private quitting = false

  constructor(private readonly deps: ModListDeps) {}

  // ------------------------------------------------------------ 一覧
  private file(modId: string): string | null {
    return MOD_ID_RE.test(modId) ? join(this.deps.dir, `${modId}.json`) : null
  }

  private list(modId: string): UiList {
    const cur = this.lists.get(modId)
    if (cur) return cur
    let l: UiList = { title: '', empty: '', icons: {}, items: [] }
    const f = this.file(modId)
    if (f) {
      try {
        l = sanitizeUiList(JSON.parse(readFileSync(f, 'utf-8')))
      } catch {
        // まだ無い・壊れている: 空
      }
    }
    this.lists.set(modId, l)
    return l
  }

  /** Mod が渡した一覧を、整えて、保存し、窓へ送る */
  setList(modId: string, raw: unknown): void {
    const l = sanitizeUiList(raw)
    this.lists.set(modId, l)
    const f = this.file(modId)
    if (f) {
      try {
        mkdirSync(this.deps.dir, { recursive: true })
        const tmp = `${f}.tmp`
        writeFileSync(tmp, JSON.stringify(l), 'utf-8')
        renameSync(tmp, f)
      } catch {
        // 保存できなくても、表示は続ける
      }
    }
    this.push(modId)
  }

  private state(modId: string): ModListState {
    const mod = this.deps.mods().find((m) => m.id === modId)
    const l = this.list(modId)
    return { modName: mod?.name ?? modId, title: l.title, empty: l.empty, icons: l.icons, items: l.items, follow: this.opts(modId).follow, canOpen: mod?.canOpen ?? false }
  }

  private push(modId: string): void {
    const win = this.wins.get(modId)
    if (win && !win.isDestroyed()) win.webContents.send(IPC.modListChanged, this.state(modId))
  }

  // ------------------------------------------------------------ 窓の状態(表示・追従・位置と大きさ)
  private opts(modId: string): { visible: boolean; follow: boolean; bounds: Rect | null } {
    const o = this.deps.store.get().mods.uiWindows[modId]
    return { visible: o?.visible ?? false, follow: o?.follow ?? false, bounds: o?.bounds ?? null }
  }

  private save(modId: string, patch: Partial<{ visible: boolean; follow: boolean; bounds: Rect | null }>): void {
    this.deps.store.update((s) => {
      const cur = s.mods.uiWindows[modId] ?? { visible: false, follow: false, bounds: null }
      s.mods.uiWindows[modId] = { ...cur, ...patch }
    })
  }

  isVisible(modId: string): boolean {
    return this.wins.has(modId)
  }

  /** 設定画面・トレイから。表示・追従を変える */
  set(modId: string, patch: { visible?: boolean; follow?: boolean }): void {
    this.save(modId, {
      ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
      ...(patch.follow !== undefined ? { follow: patch.follow } : {})
    })
    this.sync()
    if (patch.follow !== undefined) {
      this.follow()
      this.push(modId)
    }
  }

  toggle(modId: string): void {
    this.set(modId, { visible: !this.opts(modId).visible })
  }

  /** 設定・Mod の ON/OFF が変わったとき: 出すべき窓を出し、要らない窓を閉じる */
  sync(): void {
    const active = new Map(this.deps.mods().map((m) => [m.id, m]))
    for (const id of [...this.wins.keys()]) {
      if (!active.has(id) || !this.opts(id).visible) this.close(id)
    }
    for (const id of active.keys()) {
      if (this.opts(id).visible && !this.wins.has(id)) this.create(id)
    }
    this.deps.onChange()
  }

  private close(modId: string): void {
    const win = this.wins.get(modId)
    if (!win) return
    this.wins.delete(modId) // 先に外しておく(自分で閉じるときは、「closed」で表示の設定を変えない)
    for (const [cid, mid] of this.byContents) if (mid === modId) this.byContents.delete(cid)
    if (!win.isDestroyed()) win.close()
  }

  /** アプリを終了するとき: 窓が閉じても、表示の設定を変えない(次の起動で、また出る) */
  markQuitting(): void {
    this.quitting = true
  }

  closeAll(): void {
    for (const id of [...this.wins.keys()]) this.close(id)
  }

  /** キャラが動いたとき: 追従する窓を、キャラの隣へ */
  follow(): void {
    const char = this.deps.characterBounds()
    if (!char) return
    for (const [id, win] of this.wins) {
      if (win.isDestroyed() || !this.opts(id).follow) continue
      const size = win.getBounds()
      this.moving = true
      win.setBounds(panelBounds(char, size, screen.getDisplayMatching(char).workArea))
      this.moving = false
    }
  }

  private create(modId: string): void {
    const { bounds, follow } = this.opts(modId)
    const area = screen.getPrimaryDisplay().workArea
    // 保存した位置が、いまの画面の外なら、使わない(モニターを外したときなど)
    const usable =
      bounds &&
      screen.getAllDisplays().some((d) => bounds.x < d.workArea.x + d.workArea.width && bounds.x + bounds.width > d.workArea.x && bounds.y < d.workArea.y + d.workArea.height && bounds.y + bounds.height > d.workArea.y)
    const b = usable && bounds ? bounds : { x: Math.round(area.x + area.width - DEFAULT_SIZE.width - 40), y: Math.round(area.y + 60), ...DEFAULT_SIZE }
    const win = new BrowserWindow({
      ...b,
      minWidth: 260,
      minHeight: 240,
      title: this.state(modId).modName,
      autoHideMenuBar: true,
      show: false,
      backgroundColor: '#1d1e26',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    win.setMenuBarVisibility(false)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    const contentsId = win.webContents.id
    this.wins.set(modId, win)
    this.byContents.set(contentsId, modId)
    win.once('ready-to-show', () => {
      if (follow) this.follow()
      win.show()
    })
    const remember = (): void => {
      if (this.moving || win.isDestroyed()) return
      const cur = win.getBounds()
      // 追従中は、位置を覚えない(大きさだけ)
      const prev = this.opts(modId).bounds
      this.save(modId, { bounds: this.opts(modId).follow && prev ? { ...prev, width: cur.width, height: cur.height } : cur })
    }
    win.on('moved', remember)
    win.on('resized', remember)
    win.on('closed', () => {
      this.byContents.delete(contentsId)
      // 利用者が ✕ で閉じたとき(まだ、一覧に残っている)は、表示を OFF にする
      if (this.wins.get(modId) === win) {
        this.wins.delete(modId)
        if (this.quitting) return
        this.save(modId, { visible: false })
        this.deps.onChange()
      }
    })
    loadRenderer(win, 'modlist')
  }

  // ------------------------------------------------------------ 窓からの呼び出し(送り元の窓から、Mod を決める)
  registerIpc(): void {
    const modOf = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): string | undefined => this.byContents.get(e.sender.id)
    ipcMain.handle(IPC.modListGet, (e) => {
      const id = modOf(e)
      return id ? this.state(id) : null
    })
    ipcMain.on(IPC.modListSelect, (e, itemId: unknown) => {
      const id = modOf(e)
      if (id && typeof itemId === 'string' && this.list(id).items.some((i) => i.id === itemId)) this.deps.deliver(id, itemId)
    })
    ipcMain.on(IPC.modListOpen, (e, itemId: unknown) => {
      const id = modOf(e)
      if (!id || typeof itemId !== 'string' || !this.state(id).canOpen) return
      const link = this.list(id).items.find((i) => i.id === itemId)?.link
      if (link) this.deps.openExternal(link)
    })
    ipcMain.on(IPC.modListClose, (e) => {
      const id = modOf(e)
      if (id) this.set(id, { visible: false })
    })
    ipcMain.on(IPC.modListFollow, (e, follow: unknown) => {
      const id = modOf(e)
      if (id && typeof follow === 'boolean') this.set(id, { follow })
    })
  }
}
