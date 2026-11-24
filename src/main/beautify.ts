import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { BEAUTIFY_REAL_ID, BEAUTIFY_TOON_ID, BeautifyPatchSchema, BeautifySchema, type BeautifyView } from '../shared/beautify'
import type { SettingsStore } from './settingsStore'

/**
 * 機能 Mod「美化(リアル)」「美化(トゥーン)」の main 側。設定の保存と、全ウィンドウへの通知だけ。
 * 描画の変更は、キャラウィンドウ(Three.js)が行う。通信は一切しない。
 */
export class BeautifyController {
  constructor(private readonly store: SettingsStore) {}

  view(): BeautifyView {
    const s = this.store.get()
    return {
      ...s.beautify,
      realEnabled: s.mods.features.includes(BEAUTIFY_REAL_ID),
      toonEnabled: s.mods.features.includes(BEAUTIFY_TOON_ID)
    }
  }

  changed(): void {
    const view = this.view()
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.beautifyChanged, view)
  }

  save(raw: unknown): BeautifyView {
    const parsed = BeautifyPatchSchema.safeParse(raw)
    if (parsed.success) {
      const patch = parsed.data
      this.store.update((s) => {
        s.beautify = BeautifySchema.parse({
          real: { ...s.beautify.real, ...patch.real },
          toon: { ...s.beautify.toon, ...patch.toon }
        })
      })
      this.changed()
    }
    return this.view()
  }
}
