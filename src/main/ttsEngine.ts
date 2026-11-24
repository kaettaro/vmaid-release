import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { planEngineLaunch, type LaunchInput } from '../shared/tts/engineLaunch'
import type { SettingsStore } from './settingsStore'
import { probeEngine } from './ttsService'

// VOICEVOX 互換エンジンの自動起動。利用者が選んだ実行ファイルを、自動起動が ON のときだけ、自分のPCの接続先のときだけ起動する(判断は shared/tts/engineLaunch.ts)。
// VMaid が起動したエンジンは、VMaid の終了時に止める(利用者が先に起動していたエンジンには、触れない)。

export interface EngineResult {
  ok: boolean
  message: string
}

const POLL_MS = 500

export class TtsEngineLauncher {
  private child: ChildProcess | null = null
  private pending: Promise<EngineResult> | null = null
  private lastOkAt = 0

  constructor(private readonly store: SettingsStore) {}

  private input(): LaunchInput {
    const s = this.store.get()
    let pathKind: LaunchInput['pathKind'] = 'none'
    if (s.tts.enginePath && existsSync(s.tts.enginePath)) pathKind = statSync(s.tts.enginePath).isDirectory() ? 'dir' : 'file'
    return {
      modOn: s.mods.features.includes('tts'),
      backend: s.tts.backend,
      autoStart: s.tts.autoStart,
      enginePath: s.tts.enginePath,
      endpoint: s.tts.endpoint,
      platform: process.platform,
      pathKind
    }
  }

  /** エンジンに接続できる状態にする。すでに起動していれば、何もしない。起動して、接続できるまで、waitMs まで待つ */
  ensure(waitMs: number): Promise<EngineResult> {
    this.pending ??= this.doEnsure(waitMs).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  /** 読み上げの前に呼ぶ。自動起動が有効なら、エンジンが起動しているか確かめ、無ければ起動して待つ(確認は、20秒に1回まで) */
  async beforeUse(): Promise<void> {
    if (planEngineLaunch(this.input()).action === 'none') return
    if (Date.now() - this.lastOkAt < 20_000) return
    await this.ensure(30_000)
  }

  private async doEnsure(waitMs: number): Promise<EngineResult> {
    const input = this.input()
    const plan = planEngineLaunch(input)
    if (plan.action === 'none') return { ok: false, message: '自動起動は、OFF です(または、音声合成が VOICEVOX 方式ではありません)' }
    if (plan.action === 'blocked') return { ok: false, message: plan.reason }
    if (await probeEngine(input.endpoint)) {
      this.lastOkAt = Date.now()
      return { ok: true, message: 'エンジンは、すでに起動しています' }
    }
    const started = this.start(plan.action, input.enginePath as string)
    if (started) return { ok: false, message: started }
    const until = Date.now() + waitMs
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      if (await probeEngine(input.endpoint)) {
        this.lastOkAt = Date.now()
        return { ok: true, message: 'エンジンを起動しました' }
      }
      if (plan.action === 'spawn' && this.child === null) return { ok: false, message: 'エンジンが、起動の途中で終了しました(実行ファイルを確認してください)' }
    }
    return { ok: false, message: `エンジンを起動しましたが、${Math.round(waitMs / 1000)}秒以内に、接続できませんでした(起動に時間がかかっている可能性があります)` }
  }

  /** 起動する。失敗したら、理由(日本語)。すでに、こちらが起動した子プロセスが動いていれば、何もしない */
  private start(action: 'spawn' | 'open-app', path: string): string | null {
    if (this.child) return null
    try {
      if (action === 'open-app') {
        const p = spawn('open', ['-g', '-a', path], { stdio: 'ignore' })
        p.on('error', () => undefined)
        return null
      }
      // Windows の .bat / .cmd は、直接は起動できない(Node の仕様)ので、cmd.exe 経由にする(オプションつきで起動する .bat を、使えるように)
      const batch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(path)
      const child = batch ? spawn('cmd.exe', ['/c', path], { cwd: dirname(path), stdio: 'ignore', windowsHide: true }) : spawn(path, [], { cwd: dirname(path), stdio: 'ignore', windowsHide: true })
      this.child = child
      child.on('error', () => (this.child = null))
      child.on('exit', () => (this.child = null))
      return null
    } catch (e) {
      return `エンジンを起動できませんでした: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  /** VMaid が起動したエンジンを、止める(アプリの終了時) */
  stop(): void {
    const c = this.child
    this.child = null
    if (!c || c.killed) return
    // Windows では、起動したプロセスの子(エンジン本体)も、まとめて止める
    if (process.platform === 'win32' && c.pid) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => c.kill())
    else c.kill()
  }
}
