import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { parseSettings, type Settings } from '../shared/settings'

/** userData/settings.json の読み書き。壊れていれば既定値で起動する */
export class SettingsStore {
  private readonly file = join(app.getPath('userData'), 'settings.json')
  private data: Settings
  /** 設定ファイルが、すでにあった(= 初回起動ではない)か。Mod の移行の判定に使う */
  readonly existed: boolean
  private timer: NodeJS.Timeout | null = null

  constructor() {
    let raw: unknown = null
    let existed = false
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf-8'))
      existed = true
    } catch {
      // 初回起動 or 破損。既定値を使う
    }
    this.existed = existed
    this.data = parseSettings(raw)
  }

  get(): Settings {
    return this.data
  }

  /** 変更を反映し、少し待ってからまとめて書き込む(ドラッグ中の連続更新対策) */
  update(mutate: (s: Settings) => void): void {
    mutate(this.data)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      // 書き込み途中の破損を避けるため、一時ファイル経由で置き換える
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      renameSync(tmp, this.file)
    } catch (e) {
      console.error('settings.json の保存に失敗', e)
    }
  }
}
