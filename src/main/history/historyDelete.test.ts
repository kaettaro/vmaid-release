import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { entryKey, filterEntries, newestKeys, pageNewestFirst, type HistoryEntry } from '../../shared/history/format'
import { HistoryStore } from './historyStore'

let dir: string
let store: HistoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmaid-histdel-'))
  store = new HistoryStore(join(dir, 'history'))
  return () => rmSync(dir, { recursive: true, force: true })
})

const at = (mo: number, d: number): number => new Date(2026, mo - 1, d, 12).getTime()
const log: HistoryEntry[] = [
  { ts: at(8, 1), role: 'user', text: '朝のあいさつ', characterId: 'a' },
  { ts: at(8, 1) + 1000, role: 'assistant', text: 'おはよう', characterId: 'a' },
  { ts: at(9, 5), role: 'user', text: 'ワルツを踊って', characterId: 'b' },
  { ts: at(9, 5) + 1000, role: 'assistant', text: 'いくよー', characterId: 'b' },
  { ts: at(10, 3), role: 'user', text: '今日は天気がいいね' }, // characterId なし = default のキャラ
  { ts: at(10, 3) + 1000, role: 'assistant', text: 'そうだね' }
]

describe('履歴の絞り込み・並べ替え(純粋な関数)', () => {
  it('キャラで絞る(characterId が無い古い記録は default)', () => {
    expect(filterEntries(log, { characterId: 'a' })).toHaveLength(2)
    expect(filterEntries(log, { characterId: 'default' }).map((e) => e.text)).toEqual(['今日は天気がいいね', 'そうだね'])
  })
  it('言葉で絞る(空白区切りは、すべて含む。大文字小文字を区別しない)', () => {
    expect(filterEntries(log, { query: 'ワルツ' }).map((e) => e.text)).toEqual(['ワルツを踊って'])
    expect(filterEntries(log, { query: '今日 天気' })).toHaveLength(1)
    expect(filterEntries(log, { query: '' })).toHaveLength(6)
  })
  it('新しい順に並べて、ページに切る', () => {
    const p = pageNewestFirst(log, 0, 2)
    expect(p.total).toBe(6)
    expect(p.items.map((e) => e.text)).toEqual(['そうだね', '今日は天気がいいね'])
    expect(pageNewestFirst(log, 4, 10).items.map((e) => e.text)).toEqual(['朝のあいさつ'.length ? 'おはよう' : '', '朝のあいさつ'])
    expect(pageNewestFirst(log, 99, 10).items).toEqual([])
  })
  it('新しいほうから n 件の印(キャラ別も)', () => {
    expect(newestKeys(log, 2)).toEqual([entryKey(log[5]), entryKey(log[4])])
    expect(newestKeys(log, 1, { characterId: 'a' })).toEqual([entryKey(log[1])])
  })
})

describe('HistoryStore: 印で消す', () => {
  it('選んだ記録だけを消し、ほかは残す。月の記録がすべて消えたら、ファイルも消える', async () => {
    await store.append(log)
    expect(await store.deleteKeys([entryKey(log[0]), entryKey(log[1])])).toBe(2)
    expect((await store.readAll()).map((e) => e.text)).toEqual(['ワルツを踊って', 'いくよー', '今日は天気がいいね', 'そうだね'])
    expect(readdirSync(join(dir, 'history')).sort()).toEqual(['2026-09.jsonl', '2026-10.jsonl']) // 8 月のファイルは消えた
    expect(readdirSync(join(dir, 'history')).some((n) => n.endsWith('.tmp'))).toBe(false)
  })

  it('直近 n 件(キャラ別も)を消せる', async () => {
    await store.append(log)
    expect(await store.deleteKeys(newestKeys(await store.readAll(), 3))).toBe(3)
    expect((await store.readAll()).map((e) => e.text)).toEqual(['朝のあいさつ', 'おはよう', 'ワルツを踊って'])
    expect(await store.deleteKeys(newestKeys(await store.readAll(), 5, { characterId: 'a' }))).toBe(2)
    expect((await store.readAll()).map((e) => e.text)).toEqual(['ワルツを踊って'])
  })

  it('空の指定・存在しない印は、何も消さない', async () => {
    await store.append(log)
    expect(await store.deleteKeys([])).toBe(0)
    expect(await store.deleteKeys(['0|user|nobody'])).toBe(0)
    expect(await store.readAll()).toHaveLength(6)
  })
})
