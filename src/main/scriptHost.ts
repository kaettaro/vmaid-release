import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { BrowserWindow, ipcMain, session } from 'electron'
import type { HttpLogEntry } from '../shared/scripts/gate'
import { sanitizeContext } from '../shared/scripts/context'
import type { ScriptSpec } from '../shared/scripts/spec'
import { gatedFetch } from './scriptHttp'

// スクリプト Mod(Tier 2)の実行環境(ADR 0002)。Mod ごとに、非表示の BrowserWindow を、専用の partition で作る:
//  - sandbox: true / contextIsolation: true / nodeIntegration: false(Node・Electron の API は見えない)
//  - ファイルは、専用プロトコル(vmaid-ext://<Mod の id>/…)で、Mod のフォルダの中の .js だけを配信。HTML は main が作る
//  - CSP で、ネットワーク・画像・スタイル・フレーム・ワーカーを遮断(unsafe-eval なし)
//  - webRequest で、専用プロトコル以外の要求を、すべて遮断して記録 / 権限の要求は、すべて拒否 / 新しい窓・ページ移動は拒否
//  - WebRTC は、ポリシー(disable_non_proxied_udp)と、preload での API の削除の両方で止める
//  - 通信は、host.http.fetch だけ(main が代行。scriptHttp.ts)
//  - どの Mod の窓かは、main が webContents.id から決める(スクリプトが名乗る id は信用しない)
// 起動は遅延(最初のアクション・イベントのとき)。しばらく使われなければ終了する。

export const SCRIPT_SCHEME = 'vmaid-ext'

export interface ScriptMod {
  id: string
  name: string
  dir: string
  /** スクリプトの実ファイル */
  entry: string
  spec: ScriptSpec
}

export interface ScriptEffects {
  say(text: string): void
  playMotion(name: string): void
  emit(modId: string, name: string): void
  /** 検査済みの VRMA を、この Mod が追加した動きとして、一覧に足す。足した名前(失敗なら null) */
  addMotion(modId: string, name: string, data: Uint8Array): string | null
  /** この Mod が追加したものだけ、消す */
  removeMotion(modId: string, name: string): boolean
  /** 裏で AI に頼んで、返答だけをセリフとして出す(キャラ窓が、会話中などなら、何もしない) */
  askAi(modId: string, instruction: string, save: boolean): void
  /** 一覧窓(host.ui.list)に出す一覧(検査は、受け取る側) */
  uiListSet(modId: string, list: unknown): void
}

export interface ScriptHostDeps {
  /** いま有効なスクリプト Mod(「開発者向け」が ON で、ON にしたもの) */
  mods(): ScriptMod[]
  /** Mod ごとの保存領域のフォルダ(userData/mod-storage) */
  storageDir: string
  effects: ScriptEffects
  /** 利用者が、設定(urls)で足して、承認した通信先(外部のサイト)。Mod の宣言した通信先に、足して使う */
  extraOrigins(mod: ScriptMod): string[]
  /** スクリプトの設定項目の値(host.settings.get)。型つき・secret は復号済み */
  setting(mod: ScriptMod, name: string): string | number | boolean | null
  /** 通信の前に呼ぶ(外部ツールの自動起動。起動を待つ間、通信は待たされる)。失敗しても、通信は進める */
  beforeHttp?(mod: ScriptMod, url: unknown): Promise<void>
  /** 使われなくなってから、窓を終了するまでの時間(ミリ秒) */
  idleMs?: number
}

interface Running {
  win: BrowserWindow
  /** 起動したときの宣言(中身が変わったら、作り直す) */
  fingerprint: string
  lastUse: number
}

const IDLE_MS = 5 * 60 * 1000
const MAX_LOG_LINES = 200
const MAX_HTTP_LOG = 100
const STORAGE_MAX_KEYS = 100
const STORAGE_MAX_VALUE = 64 * 1024
const STORAGE_MAX_TOTAL = 256 * 1024
const MAX_PARAMS_BYTES = 64 * 1024
const MIN_AI_GAP_MS = 30_000
/** 利用者が一覧で項目を選んでから、この間の ai.say は、間隔の制限を緩める(選んだ話題を、すぐ話すため) */
const UI_AI_WINDOW_MS = 5000
const UI_AI_GAP_MS = 2000
const MOD_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

export class ScriptHost {
  private readonly running = new Map<string, Running>()
  private readonly byContents = new Map<number, string>()
  private readonly logs = new Map<string, string[]>()
  private readonly httpLogs = new Map<string, HttpLogEntry[]>()
  private readonly rate = new Map<string, { windowStart: number; count: number }>()
  /** Mod ごとの「最近の話題」(host.context.set)。Mod が OFF なら、使われない */
  private readonly contexts = new Map<string, string>()
  /** Mod ごとの、最後に AI に頼んだ時刻(頼みすぎを防ぐ) */
  private readonly lastAi = new Map<string, number>()
  private readonly lastUiEvent = new Map<string, number>()
  private sweeper: NodeJS.Timeout | null = null

  constructor(private readonly deps: ScriptHostDeps) {}

  // ------------------------------------------------------------ 起動・終了
  private modById(id: string): ScriptMod | undefined {
    return this.deps.mods().find((m) => m.id === id)
  }

  private fingerprint(m: ScriptMod): string {
    return JSON.stringify([m.entry, m.dir, m.spec])
  }

  /** その Mod の窓があれば返し、無ければ作る(遅延起動)。有効でない Mod は null */
  private async ensure(modId: string): Promise<Running | null> {
    const mod = this.modById(modId)
    if (!mod) return null
    const cur = this.running.get(modId)
    if (cur && !cur.win.isDestroyed() && cur.fingerprint === this.fingerprint(mod)) {
      cur.lastUse = Date.now()
      return cur
    }
    if (cur) this.stop(modId)
    const r = await this.createWindow(mod)
    this.startSweeper()
    return r
  }

  private async createWindow(mod: ScriptMod): Promise<Running> {
    const id = mod.id
    const partition = `mod-ext-${id}`
    const ses = session.fromPartition(partition)
    const entryRel = relative(mod.dir, mod.entry).split(sep).map(encodeURIComponent).join('/')
    const dir = mod.dir

    // (1) 専用プロトコル: この Mod のフォルダの中の .js だけを配信。HTML は main が作る
    if (!ses.protocol.isProtocolHandled(SCRIPT_SCHEME)) {
      ses.protocol.handle(SCRIPT_SCHEME, async (req) => {
        const u = new URL(req.url)
        if (u.hostname !== id) return new Response('forbidden', { status: 403 })
        if (u.pathname === '/__host.html') {
          return new Response(`<!doctype html><meta charset="utf-8"><script src="${SCRIPT_SCHEME}://${id}/${entryRel}"></script>`, {
            headers: {
              'Content-Type': 'text/html',
              'Content-Security-Policy': `default-src 'none'; script-src ${SCRIPT_SCHEME}://${id}; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`
            }
          })
        }
        try {
          const rel = decodeURIComponent(u.pathname).replace(/^[/\\]+/, '')
          if (!/\.js$/i.test(rel)) return new Response('forbidden', { status: 403 })
          const full = resolve(dir, rel)
          const [realDir, realFull] = await Promise.all([realpath(dir), realpath(full)])
          if (!realFull.startsWith(realDir + sep)) return new Response('forbidden', { status: 403 })
          return new Response(await readFile(realFull), { headers: { 'Content-Type': 'text/javascript' } })
        } catch {
          return new Response('not found', { status: 404 })
        }
      })
    }
    // (2) 多重防御: このセッションからの、専用プロトコル以外の要求は、すべて遮断して記録する(CSP が先に止めるので、ふだんは来ない)
    ses.webRequest.onBeforeRequest((details, cb) => {
      if (details.url.startsWith(`${SCRIPT_SCHEME}://`) || details.url.startsWith('devtools://')) return cb({})
      this.log(id, 'blocked', `遮断した要求: ${details.url.slice(0, 200)}`)
      cb({ cancel: true })
    })
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    ses.setPermissionCheckHandler(() => false)

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        partition,
        preload: join(import.meta.dirname, '../preload/scriptmod.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false
      }
    })
    win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    const contentsId = win.webContents.id
    this.byContents.set(contentsId, id)
    win.webContents.on('render-process-gone', (_e, d) => {
      this.log(id, 'error', `スクリプトのプロセスが終了しました(${d.reason})`)
      this.forget(id)
    })
    win.on('closed', () => this.forget(id))
    const running: Running = { win, fingerprint: this.fingerprint(mod), lastUse: Date.now() }
    this.running.set(id, running)
    try {
      await win.loadURL(`${SCRIPT_SCHEME}://${id}/__host.html`)
    } catch (e) {
      this.log(id, 'error', `スクリプトを読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`)
      this.stop(id)
      throw e
    }
    return running
  }

  private forget(id: string): void {
    const r = this.running.get(id)
    if (!r) return
    this.running.delete(id)
    for (const [cid, mid] of this.byContents) if (mid === id) this.byContents.delete(cid)
  }

  stop(id: string): void {
    const r = this.running.get(id)
    this.forget(id)
    if (r && !r.win.isDestroyed()) r.win.destroy()
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id)
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
  }

  /** Mod の ON/OFF・「開発者向け」・取り込みが変わったとき: 有効でなくなった(または、中身が変わった)Mod の窓を、止める */
  reconcile(): void {
    const mods = new Map(this.deps.mods().map((m) => [m.id, m]))
    for (const [id, r] of [...this.running]) {
      const m = mods.get(id)
      if (!m || this.fingerprint(m) !== r.fingerprint) this.stop(id)
    }
  }

  private startSweeper(): void {
    if (this.sweeper) return
    this.sweeper = setInterval(() => {
      const idle = this.deps.idleMs ?? IDLE_MS
      for (const [id, r] of [...this.running]) if (Date.now() - r.lastUse > idle) this.stop(id)
    }, 30_000)
    this.sweeper.unref()
  }

  // ------------------------------------------------------------ ルールからの呼び出し
  /** ルールのアクションを、スクリプトに渡す(完了は待たない)。宣言したアクションだけ */
  async runAction(modId: string, action: string, params: unknown): Promise<void> {
    const mod = this.modById(modId)
    if (!mod || !mod.spec.contributes.actions.some((a) => a.type === action)) return
    const text = JSON.stringify(params ?? {})
    if (text === undefined || text.length > MAX_PARAMS_BYTES) return
    try {
      const r = await this.ensure(modId)
      if (r && !r.win.isDestroyed()) r.win.webContents.send('scriptmod:action', { action, params: JSON.parse(text) })
    } catch {
      // 読み込みに失敗した(理由は、ログに残してある)
    }
  }

  /** 一覧窓で、利用者が項目を選んだ。スクリプトへ届ける(窓が止まっていれば、起こす) */
  async deliverUiSelect(modId: string, itemId: string): Promise<void> {
    const mod = this.modById(modId)
    if (!mod?.spec.permissions.ui.list) return
    this.lastUiEvent.set(modId, Date.now())
    try {
      const r = await this.ensure(modId)
      if (r && !r.win.isDestroyed()) r.win.webContents.send('scriptmod:ui-event', { type: 'select', id: itemId.slice(0, 80) })
    } catch {
      // 読み込みに失敗した(理由は、ログに残してある)
    }
  }

  // ------------------------------------------------------------ ログ
  private log(modId: string, level: string, message: string): void {
    const list = this.logs.get(modId) ?? []
    list.push(`${new Date().toLocaleTimeString()} [${level}] ${message}`)
    if (list.length > MAX_LOG_LINES) list.splice(0, list.length - MAX_LOG_LINES)
    this.logs.set(modId, list)
  }

  private logHttp(modId: string, e: HttpLogEntry): void {
    const list = this.httpLogs.get(modId) ?? []
    list.push(e)
    if (list.length > MAX_HTTP_LOG) list.splice(0, list.length - MAX_HTTP_LOG)
    this.httpLogs.set(modId, list)
  }

  /** 外部ツールの起動などの、ホスト側の出来事を、Mod のログに残す */
  note(modId: string, message: string): void {
    this.log(modId, 'launcher', message)
  }

  getLogs(modId: string): { log: string[]; http: HttpLogEntry[]; running: boolean } {
    return { log: [...(this.logs.get(modId) ?? [])], http: [...(this.httpLogs.get(modId) ?? [])], running: this.running.has(modId) }
  }

  // ------------------------------------------------------------ 保存領域
  private storageFile(modId: string): string | null {
    return MOD_ID_RE.test(modId) ? join(this.deps.storageDir, `${modId}.json`) : null
  }

  private readStorage(modId: string): Record<string, unknown> {
    const f = this.storageFile(modId)
    if (!f) return {}
    try {
      const v = JSON.parse(readFileSync(f, 'utf-8')) as unknown
      return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  private writeStorage(modId: string, data: Record<string, unknown>): void {
    const f = this.storageFile(modId)
    if (!f) return
    mkdirSync(this.deps.storageDir, { recursive: true })
    const tmp = `${f}.tmp`
    writeFileSync(tmp, JSON.stringify(data), 'utf-8')
    renameSync(tmp, f)
  }

  /** 保存: 上限を超えるものは、断る(false) */
  private setStorage(modId: string, key: string, value: unknown): boolean {
    if (typeof key !== 'string' || key === '' || key.length > 60 || /[\u0000-\u001f]/.test(key)) return false // eslint-disable-line no-control-regex
    const data = this.readStorage(modId)
    if (value === null || value === undefined) {
      delete data[key]
    } else {
      let text: string | undefined
      try {
        text = JSON.stringify(value)
      } catch {
        return false
      }
      if (text === undefined || text.length > STORAGE_MAX_VALUE) return false
      if (!(key in data) && Object.keys(data).length >= STORAGE_MAX_KEYS) return false
      data[key] = JSON.parse(text)
    }
    if (JSON.stringify(data).length > STORAGE_MAX_TOTAL) return false
    this.writeStorage(modId, data)
    return true
  }

  // ------------------------------------------------------------ ホスト API(窓からの呼び出し)
  /** 1秒に20回まで(スクリプトが、画面・ルールを、あふれさせないように) */
  private allow(modId: string, key: string): boolean {
    const k = `${modId}:${key}`
    const now = Date.now()
    const r = this.rate.get(k)
    if (!r || now - r.windowStart > 1000) {
      this.rate.set(k, { windowStart: now, count: 1 })
      return true
    }
    r.count++
    return r.count <= 20
  }

  /** いま有効な Mod の、「最近の話題」(会話の追加の指示にする)。古く登録されたものが先 */
  contextEntries(): Array<{ modId: string; text: string }> {
    const on = new Set(this.deps.mods().map((m) => m.id))
    return [...this.contexts].filter(([id]) => on.has(id)).map(([modId, text]) => ({ modId, text }))
  }

  /** 呼び出し元の窓から、Mod を決める(名乗りは信用しない)。有効でない Mod・知らない窓は undefined */
  private caller(webContentsId: number): ScriptMod | undefined {
    const id = this.byContents.get(webContentsId)
    const mod = id ? this.modById(id) : undefined
    if (mod) {
      const r = this.running.get(mod.id)
      if (r) r.lastUse = Date.now()
    }
    return mod
  }

  registerIpc(): void {
    ipcMain.on('scriptmod:log', (e, level: unknown, message: unknown) => {
      const mod = this.caller(e.sender.id)
      if (mod && typeof level === 'string' && typeof message === 'string' && this.allow(mod.id, 'log')) this.log(mod.id, level.slice(0, 10), message.slice(0, 2000))
    })

    ipcMain.handle('scriptmod:http', async (e, req: unknown) => {
      const mod = this.caller(e.sender.id)
      if (!mod) return { ok: false, reason: 'unknown-sender' }
      const extra = this.deps.extraOrigins(mod)
      const origins = [...mod.spec.permissions.network, ...extra]
      const r = typeof req === 'object' && req !== null ? (req as { method?: unknown; url?: unknown; headers?: unknown; body?: unknown; timeoutMs?: unknown }) : {}
      if (origins.length === 0) {
        this.logHttp(mod.id, { at: Date.now(), method: String(r.method ?? ''), url: String(r.url ?? '').slice(0, 300), result: 'no-permission' })
        return { ok: false, reason: 'no-permission' }
      }
      // 外部ツールの自動起動(Mod の宣言した launcher と、利用者の「自動起動 ON」のときだけ。起動を待ったぶん、窓の待ち時間は、延びる)
      if (this.deps.beforeHttp && mod.spec.launcher) await this.deps.beforeHttp(mod, r.url).catch(() => undefined)
      const out = await gatedFetch(origins, r, extra)
      this.logHttp(mod.id, { at: Date.now(), method: String(r.method ?? '').toUpperCase(), url: String(r.url ?? '').slice(0, 300), result: out.ok ? `ok ${out.status}` : out.reason })
      return out
    })

    ipcMain.handle('scriptmod:settings-get', (e, name: unknown) => {
      const mod = this.caller(e.sender.id)
      return mod && typeof name === 'string' ? this.deps.setting(mod, name) : null
    })

    ipcMain.handle('scriptmod:storage-get', (e, key: unknown) => {
      const mod = this.caller(e.sender.id)
      if (!mod?.spec.permissions.storage || typeof key !== 'string') return null
      return this.readStorage(mod.id)[key] ?? null
    })
    ipcMain.handle('scriptmod:storage-set', (e, key: unknown, value: unknown) => {
      const mod = this.caller(e.sender.id)
      if (!mod?.spec.permissions.storage || typeof key !== 'string') return false
      return this.setStorage(mod.id, key, value)
    })

    ipcMain.handle('scriptmod:motion-add', (e, name: unknown, data: unknown) => {
      const mod = this.caller(e.sender.id)
      if (!mod?.spec.permissions.motion.includes('add') || typeof name !== 'string' || !(data instanceof Uint8Array)) return null
      return this.deps.effects.addMotion(mod.id, name, data)
    })
    ipcMain.handle('scriptmod:motion-remove', (e, name: unknown) => {
      const mod = this.caller(e.sender.id)
      if (!mod?.spec.permissions.motion.includes('add') || typeof name !== 'string') return false
      return this.deps.effects.removeMotion(mod.id, name)
    })
    ipcMain.on('scriptmod:motion-play', (e, name: unknown) => {
      const mod = this.caller(e.sender.id)
      if (mod?.spec.permissions.motion.includes('play') && typeof name === 'string' && name.length <= 200 && this.allow(mod.id, 'play')) this.deps.effects.playMotion(name)
    })
    ipcMain.on('scriptmod:say', (e, text: unknown) => {
      const mod = this.caller(e.sender.id)
      if (mod?.spec.permissions.say && typeof text === 'string' && text.trim() !== '' && this.allow(mod.id, 'say')) this.deps.effects.say(text.slice(0, 500))
    })
    ipcMain.on('scriptmod:ai-say', (e, instruction: unknown, save: unknown) => {
      const mod = this.caller(e.sender.id)
      if (!mod?.spec.permissions.ai || typeof instruction !== 'string' || instruction.trim() === '' || !this.allow(mod.id, 'ai')) return
      const now = Date.now()
      const afterUi = now - (this.lastUiEvent.get(mod.id) ?? 0) < UI_AI_WINDOW_MS
      if (now - (this.lastAi.get(mod.id) ?? 0) < (afterUi ? UI_AI_GAP_MS : MIN_AI_GAP_MS)) return // 頼みすぎ(30 秒に 1 回まで。利用者が項目を選んだ直後は、2 秒)
      this.lastAi.set(mod.id, now)
      this.deps.effects.askAi(mod.id, instruction.slice(0, 2000), save !== false)
    })
    ipcMain.on('scriptmod:context-set', (e, text: unknown) => {
      const mod = this.caller(e.sender.id)
      if (!mod?.spec.permissions.context || !this.allow(mod.id, 'context')) return
      const t = sanitizeContext(text)
      this.contexts.delete(mod.id) // 更新した Mod が、新しいほうとして、あとに並ぶ
      if (t !== '') this.contexts.set(mod.id, t)
    })
    ipcMain.on('scriptmod:ui-list-set', (e, list: unknown) => {
      const mod = this.caller(e.sender.id)
      if (!mod?.spec.permissions.ui.list || !this.allow(mod.id, 'ui-list')) return
      this.deps.effects.uiListSet(mod.id, list)
    })
    ipcMain.on('scriptmod:emit', (e, name: unknown) => {
      const mod = this.caller(e.sender.id)
      if (!mod?.spec.permissions.emit || typeof name !== 'string') return
      // 宣言したトリガーだけ起こせる
      if (mod.spec.contributes.triggers.some((t) => t.type === name) && this.allow(mod.id, 'emit')) this.deps.effects.emit(mod.id, name)
    })
  }
}
