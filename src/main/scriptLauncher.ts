import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { launcherOrigin, type ScriptSpec } from '../shared/scripts/spec'
import { planLauncher, shouldAutoStart } from '../shared/scripts/launcher'
import { readModSetting } from './modSettings'
import { gatedFetch } from './scriptHttp'
import type { SettingsStore } from './settingsStore'

// スクリプト Mod の「外部ツールの起動」(spec の launcher)。利用者が設定で選んだ実行ファイルを、起動する。
// 起動してよいのは、(1) 利用者が「起動」ボタンを押したとき (2) 自動起動が ON で、Mod が healthUrl のオリジンへ通信しようとしたとき だけ。
// VMaid が起動したものは、VMaid の終了・Mod の OFF のときに止める(利用者が先に起動していたものには、触れない)。判断は shared/scripts/launcher.ts。

export interface LauncherResult {
  ok: boolean
  message: string
}

/** Mod のうち、起動に必要な部分 */
export interface LauncherMod {
  id: string
  name: string
  spec: ScriptSpec
}

const POLL_MS = 500
const PROBE_TIMEOUT_MS = 3000

export class ScriptLauncher {
  private readonly children = new Map<string, ChildProcess>()
  private readonly pending = new Map<string, Promise<LauncherResult>>()

  constructor(
    private readonly store: SettingsStore,
    private readonly log: (modId: string, message: string) => void = () => undefined
  ) {}

  private exePath(mod: LauncherMod): string | null {
    const name = mod.spec.launcher?.pathSetting
    return (name ? this.store.get().mods.modSettings[mod.id]?.[name] : undefined) ?? null
  }

  private autoOn(mod: LauncherMod): boolean {
    const name = mod.spec.launcher?.autoSetting
    return name ? readModSetting(this.store, mod.spec, mod.id, name) === true : false
  }

  /** 起動済みか(healthUrl に GET して、200 が返るか) */
  async isUp(mod: LauncherMod): Promise<boolean> {
    const l = mod.spec.launcher
    const origin = l ? launcherOrigin(l.healthUrl) : null
    if (!l || !origin) return false
    const r = await gatedFetch([origin], { method: 'GET', url: l.healthUrl, timeoutMs: PROBE_TIMEOUT_MS })
    return r.ok && r.status === 200
  }

  /** 通信の前に呼ぶ。Mod が healthUrl のオリジンへ通信しようとしていて、自動起動が ON なら、起動済みにする(失敗しても、通信は、そのまま進める。つながらない理由は、Mod が表示する) */
  async beforeHttp(mod: LauncherMod, requestUrl: unknown): Promise<void> {
    const l = mod.spec.launcher
    if (!l || typeof requestUrl !== 'string') return
    if (!shouldAutoStart({ autoOn: this.autoOn(mod), requestOrigin: launcherOrigin(requestUrl), healthOrigin: launcherOrigin(l.healthUrl) })) return
    await this.ensure(mod)
  }

  /** 起動済みにする。すでに起動していれば、何もしない。起動して、接続できるまで startupSec まで待つ */
  ensure(mod: LauncherMod): Promise<LauncherResult> {
    let p = this.pending.get(mod.id)
    if (!p) {
      p = this.doEnsure(mod).finally(() => this.pending.delete(mod.id))
      this.pending.set(mod.id, p)
    }
    return p
  }

  private async doEnsure(mod: LauncherMod): Promise<LauncherResult> {
    const l = mod.spec.launcher
    if (!l) return { ok: false, message: 'この Mod は、外部ツールの起動を宣言していません' }
    if (await this.isUp(mod)) return { ok: true, message: `${l.label}は、すでに起動しています` }
    const path = this.exePath(mod)
    const pathKind = path && existsSync(path) ? (statSync(path).isDirectory() ? 'dir' : 'file') : 'none'
    const plan = planLauncher({ path, pathKind, platform: process.platform })
    if (plan.action === 'blocked') return { ok: false, message: plan.reason }
    this.log(mod.id, `外部ツールを起動します: ${path}`)
    const err = this.start(mod.id, plan.action, path as string)
    if (err) return { ok: false, message: err }
    const until = Date.now() + l.startupSec * 1000
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      if (await this.isUp(mod)) {
        this.log(mod.id, `${l.label}に接続できました`)
        return { ok: true, message: `${l.label}を起動しました` }
      }
      const exit = this.exited.get(mod.id)
      // 異常終了(0 以外)なら、待たずに失敗。0 で終わったときは、別のプロセスに引き継いだ(start など)可能性があるので、待ち続ける
      if (exit !== undefined && exit !== 0) return { ok: false, message: `${l.label}が、起動の途中で終了しました(終了コード ${exit})。実行ファイル(.bat の中身)を確認してください` }
    }
    return { ok: false, message: `${l.label}を起動しましたが、${l.startupSec}秒以内に接続できませんでした(モデルの読み込みに時間がかかっている可能性があります。もう一度「起動」を押すと、待ち直します)` }
  }

  /** 子プロセスの終了コード(終了していなければ、無い) */
  private readonly exited = new Map<string, number | null>()

  /** 起動する。失敗したら、理由(日本語) */
  private start(modId: string, action: 'spawn' | 'open-app', path: string): string | null {
    if (this.children.has(modId)) return null
    this.exited.delete(modId)
    try {
      if (action === 'open-app') {
        const p = spawn('open', ['-g', '-a', path], { stdio: 'ignore' })
        p.on('error', () => undefined)
        return null
      }
      // Windows の .bat / .cmd は、直接は起動できない(Node の仕様)ので、cmd.exe 経由にする(環境変数を付けて起動する .bat を、使えるように)
      const batch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(path)
      const child = batch ? spawn('cmd.exe', ['/c', path], { cwd: dirname(path), stdio: 'ignore', windowsHide: true }) : spawn(path, [], { cwd: dirname(path), stdio: 'ignore', windowsHide: true })
      this.children.set(modId, child)
      child.on('error', (e) => {
        this.children.delete(modId)
        this.exited.set(modId, -1)
        this.log(modId, `起動に失敗しました: ${e.message}`)
      })
      child.on('exit', (code) => {
        if (this.children.get(modId) === child) this.children.delete(modId)
        this.exited.set(modId, code ?? -1)
        this.log(modId, `外部ツールのプロセスが終了しました(終了コード ${code ?? '不明'})`)
      })
      return null
    } catch (e) {
      return `起動できませんでした: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  /** VMaid が起動したものを止める(その Mod のぶん) */
  stop(modId: string): void {
    const c = this.children.get(modId)
    this.children.delete(modId)
    if (!c || c.killed) return
    // Windows では、起動したプロセスの子(ツール本体)も、まとめて止める
    if (process.platform === 'win32' && c.pid) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => c.kill())
    else c.kill()
  }

  stopAll(): void {
    for (const id of [...this.children.keys()]) this.stop(id)
  }

  /** 有効でなくなった Mod(OFF・「開発者向け」OFF・削除)が起動したものを、止める */
  reconcile(activeIds: ReadonlySet<string>): void {
    for (const id of [...this.children.keys()]) if (!activeIds.has(id)) this.stop(id)
  }
}
