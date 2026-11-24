import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { makeProfile, type Presets } from '../shared/adjust'
import type { Orientation } from '../shared/character/yaw'

/** モデルごとの調整値: userData/model-profiles/<モデルのSHA-256>.json */
export class ProfileStore {
  private readonly dir = join(app.getPath('userData'), 'model-profiles')

  /** ハッシュはレンダラーから渡るため、ファイル名にできる形式(SHA-256の16進)だけ受け付ける */
  private fileFor(hash: string): string | null {
    return /^[0-9a-f]{64}$/.test(hash) ? join(this.dir, `${hash}.json`) : null
  }

  read(hash: string): unknown {
    const file = this.fileFor(hash)
    if (!file) return null
    try {
      return JSON.parse(readFileSync(file, 'utf-8'))
    } catch {
      return null
    }
  }

  /** 既定値から変えた項目(基準値)・名前つきのセット・キャラの向きを保存する。すべて空(向きは0)ならファイルを消す */
  write(hash: string, values: Record<string, number>, presets: Presets = {}, orientation: Orientation = { yaw: 0, pitch: 0 }, defaultPreset: string | null = null): void {
    const file = this.fileFor(hash)
    if (!file) return
    try {
      if (Object.keys(values).length === 0 && Object.keys(presets).length === 0 && orientation.yaw === 0 && orientation.pitch === 0 && defaultPreset === null) {
        rmSync(file, { force: true })
        return
      }
      mkdirSync(this.dir, { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(makeProfile(values, presets, orientation, defaultPreset), null, 2), 'utf-8')
      renameSync(tmp, file)
    } catch (e) {
      console.error('モデルプロファイルの保存に失敗', e)
    }
  }
}
