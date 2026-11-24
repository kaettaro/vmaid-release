import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** キャラごとの気分・親密度: userData/character-state/<キャラid>.json。壊れていれば、読み出しは null(呼び出し側が既定にする) */
export class CharStateStore {
  private readonly dir = join(app.getPath('userData'), 'character-state')

  /** キャラidは、レンダラーから渡るため、ファイル名にできる形式だけ受け付ける */
  private fileFor(id: string): string | null {
    return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? join(this.dir, `${id}.json`) : null
  }

  read(id: string): unknown {
    const file = this.fileFor(id)
    if (!file) return null
    try {
      return JSON.parse(readFileSync(file, 'utf-8'))
    } catch {
      return null
    }
  }

  write(id: string, state: unknown): void {
    const file = this.fileFor(id)
    if (!file) return
    try {
      mkdirSync(this.dir, { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
      renameSync(tmp, file)
    } catch (e) {
      console.error('キャラの状態の保存に失敗', e)
    }
  }
}
