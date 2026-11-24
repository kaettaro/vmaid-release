import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { parseMeta, type MotionMeta } from '../shared/motionMeta'

/**
 * userData/motion-meta.json の読み書き(モーション名 → タグ)。壊れていれば、空で始める。
 * settings.json とは別にしたのは、数千件のタグでも設定ファイル(ウィンドウ移動のたびに書く)を重くしないため
 */
export class MotionMetaStore {
  private readonly file = join(app.getPath('userData'), 'motion-meta.json')
  private data: MotionMeta
  private timer: NodeJS.Timeout | null = null

  constructor() {
    let raw: unknown = null
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf-8'))
    } catch {
      // 初回 or 破損。空で始める
    }
    this.data = parseMeta(raw)
  }

  get(): MotionMeta {
    return this.data
  }

  /** 新しい内容に置き換える(同じオブジェクトなら何もしない)。少し待ってから、まとめて書き込む */
  set(next: MotionMeta): void {
    if (next === this.data) return
    this.data = next
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data), 'utf-8')
      renameSync(tmp, this.file)
    } catch (e) {
      console.error('motion-meta.json の保存に失敗', e)
    }
  }
}
