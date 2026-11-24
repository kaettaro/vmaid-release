import { readFile, stat } from 'node:fs/promises'
import { app, BrowserWindow, dialog } from 'electron'
import { IPC, type AudioPreview } from '../shared/ipc'
import { AUDIO_EXTENSIONS, MAX_AUDIO_BYTES, SePatchSchema, SeSchema, isAudioPath, type SeView } from '../shared/sound'
import { DanceEntrySchema } from '../shared/dance'
import type { SettingsStore } from './settingsStore'

/**
 * 機能 Mod「効果音(SE)」と、ダンス Mod の BGM の、音ファイルまわり(main 側)。
 * 設定の保存・音ファイルの読み出し・試し再生の中継だけ。鳴らすのは、キャラウィンドウ(Web Audio)。通信は一切しない。
 */
export class SoundController {
  constructor(
    private readonly store: SettingsStore,
    private readonly characterContents: () => Electron.WebContents | undefined,
    /** ダンス Mod の楽曲の表にある BGM のパス(利用者が選んだもの) */
    private readonly bgmPaths: () => Set<string>
  ) {}

  private enabled(): boolean {
    return this.store.get().mods.features.includes('se')
  }

  view(): SeView {
    return { ...this.store.get().se, enabled: this.enabled() }
  }

  changed(): void {
    const view = this.view()
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.soundChanged, view)
  }

  save(raw: unknown): SeView {
    const parsed = SePatchSchema.safeParse(raw)
    if (parsed.success) {
      const patch = parsed.data
      this.store.update((s) => {
        s.se = SeSchema.parse({ ...s.se, ...patch })
      })
      this.changed()
    }
    return this.view()
  }

  pick(): string | null {
    app.focus({ steal: true })
    const paths = dialog.showOpenDialogSync({
      title: '音のファイルを選ぶ',
      properties: ['openFile'],
      filters: [{ name: '音声ファイル', extensions: [...AUDIO_EXTENSIONS] }]
    })
    return paths && paths.length > 0 ? paths[0] : null
  }

  /** 読んでよいファイルか: 効果音(Mod が ON のとき)か、ダンスの楽曲の表に、利用者が登録したものだけ */
  private allowed(path: string): boolean {
    if (!isAudioPath(path)) return false
    if (this.enabled() && this.store.get().se.sounds.some((s) => s.path === path)) return true
    return this.bgmPaths().has(path)
  }

  async read(path: unknown): Promise<Uint8Array | null> {
    if (typeof path !== 'string' || !this.allowed(path)) return null
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size > MAX_AUDIO_BYTES) return null
      return new Uint8Array(await readFile(path))
    } catch {
      return null
    }
  }

  /** 設定画面からの試し再生を、キャラウィンドウへ中継する(形を検証してから) */
  preview(raw: unknown): void {
    const req = this.parsePreview(raw)
    if (req) this.characterContents()?.send(IPC.audioPreviewRun, req)
  }

  private parsePreview(raw: unknown): AudioPreview | null {
    if (typeof raw !== 'object' || raw === null) return null
    const r = raw as { kind?: unknown; name?: unknown; entry?: unknown }
    if (r.kind === 'sound' && typeof r.name === 'string' && r.name.length <= 80) return { kind: 'sound', name: r.name }
    if (r.kind === 'dance') {
      const e = DanceEntrySchema.safeParse(r.entry)
      if (e.success) return { kind: 'dance', entry: e.data }
    }
    return null
  }
}
