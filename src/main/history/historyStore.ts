import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  fileNameForMonth,
  lastTurns,
  monthFromFileName,
  monthKey,
  parseLines,
  serializeEntry,
  belongsTo,
  entryKey,
  type HistoryEntry,
  type HistorySummary
} from '../../shared/history/format'

/**
 * 会話履歴のJSONLストア(userData/history/YYYY-MM.jsonl)。ローカルのみ・ネイティブDBなし。
 * 書き込みは順番に1つずつ行い、行が混ざらないようにする。Electron非依存なので一時ディレクトリでテストできる。
 */
export class HistoryStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly dir: string) {}

  /** 書き込み系の操作を直列化する(失敗しても次の操作は続ける) */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  private async months(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).map(monthFromFileName).filter((m): m is string => m !== null).sort()
    } catch {
      return [] // まだフォルダが無い
    }
  }

  private fileFor(month: string): string {
    return join(this.dir, fileNameForMonth(month))
  }

  append(entries: HistoryEntry[]): Promise<void> {
    if (entries.length === 0) return Promise.resolve()
    return this.serial(async () => {
      await mkdir(this.dir, { recursive: true })
      // 月をまたぐ場合に備えて、月ごとにまとめて追記する
      const byMonth = new Map<string, string[]>()
      for (const e of entries) {
        const m = monthKey(e.ts)
        byMonth.set(m, [...(byMonth.get(m) ?? []), serializeEntry(e)])
      }
      for (const [month, lines] of byMonth) await appendFile(this.fileFor(month), lines.join('\n') + '\n', 'utf-8')
    })
  }

  /** すべての履歴(古い順)。量が多い場合に備え、書き出しや件数集計でのみ使う */
  async readAll(): Promise<HistoryEntry[]> {
    const all: HistoryEntry[] = []
    for (const m of await this.months()) all.push(...parseLines(await readFile(this.fileFor(m), 'utf-8').catch(() => '')))
    return all.sort((a, b) => a.ts - b.ts)
  }

  /** 文脈に使う直近のターン(characterId を渡すと、そのキャラとの会話だけ)。新しい月のファイルから必要な分だけ読む(全履歴は読まない) */
  async readRecentTurns(maxTurns: number, characterId?: string): Promise<HistoryEntry[]> {
    const months = await this.months()
    let collected: HistoryEntry[] = []
    for (let i = months.length - 1; i >= 0; i--) {
      const entries = parseLines(await readFile(this.fileFor(months[i]), 'utf-8').catch(() => ''))
      collected = [...entries.filter((e) => characterId === undefined || belongsTo(e, characterId)), ...collected]
      // 必要なターン数が、先頭の欠けなしで揃っていれば、これより古い月は読まない
      if (collected.filter((e) => e.role === 'user').length > maxTurns) break
    }
    return lastTurns(collected, maxTurns)
  }

  async summary(): Promise<HistorySummary> {
    let messages = 0
    let bytes = 0
    let firstTs: number | null = null
    let lastTs: number | null = null
    for (const m of await this.months()) {
      const path = this.fileFor(m)
      bytes += (await stat(path).catch(() => null))?.size ?? 0
      for (const e of parseLines(await readFile(path, 'utf-8').catch(() => ''))) {
        messages++
        firstTs = firstTs === null ? e.ts : Math.min(firstTs, e.ts)
        lastTs = lastTs === null ? e.ts : Math.max(lastTs, e.ts)
      }
    }
    return { messages, firstTs, lastTs, bytes }
  }

  /** すべて削除 */
  clear(): Promise<void> {
    return this.serial(async () => {
      for (const m of await this.months()) await rm(this.fileFor(m), { force: true })
    })
  }

  /** 条件に合わない記録だけを残して、ファイルを書き直す(途中で壊れないよう一時ファイル経由)。消した件数を返す */
  private rewrite(keep: (e: HistoryEntry) => boolean): Promise<number> {
    return this.serial(async () => {
      let removed = 0
      for (const m of await this.months()) {
        const path = this.fileFor(m)
        const entries = parseLines(await readFile(path, 'utf-8').catch(() => ''))
        const kept = entries.filter(keep)
        removed += entries.length - kept.length
        if (kept.length === entries.length) continue
        if (kept.length === 0) {
          await rm(path, { force: true })
        } else {
          const tmp = `${path}.tmp`
          await writeFile(tmp, kept.map(serializeEntry).join('\n') + '\n', 'utf-8')
          await rename(tmp, path)
        }
      }
      return removed
    })
  }

  /** 印(entryKey)で指した記録を削除する。消した件数を返す */
  deleteKeys(keys: Iterable<string>): Promise<number> {
    const set = new Set(keys)
    if (set.size === 0) return Promise.resolve(0)
    return this.rewrite((e) => !set.has(entryKey(e)))
  }

  /** 指定時刻より古い発話を削除する。残る分はファイルを書き直す(途中で壊れないよう一時ファイル経由)。削除した件数を返す */
  deleteBefore(cutoffTs: number): Promise<number> {
    return this.serial(async () => {
      let removed = 0
      for (const m of await this.months()) {
        const path = this.fileFor(m)
        const entries = parseLines(await readFile(path, 'utf-8').catch(() => ''))
        const kept = entries.filter((e) => e.ts >= cutoffTs)
        removed += entries.length - kept.length
        if (kept.length === entries.length) continue
        if (kept.length === 0) {
          await rm(path, { force: true })
        } else {
          const tmp = `${path}.tmp`
          await writeFile(tmp, kept.map(serializeEntry).join('\n') + '\n', 'utf-8')
          await rename(tmp, path)
        }
      }
      return removed
    })
  }
}
