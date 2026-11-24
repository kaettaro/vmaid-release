import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../shared/history/format'
import { HistoryStore } from './historyStore'

let dir: string
let store: HistoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmaid-hist-'))
  store = new HistoryStore(join(dir, 'history'))
  return () => rmSync(dir, { recursive: true, force: true })
})

const at = (y: number, mo: number, d: number, h = 12): number => new Date(y, mo - 1, d, h).getTime()
const turn = (ts: number, q: string, a: string): HistoryEntry[] => [
  { ts, role: 'user', text: q },
  { ts: ts + 1000, role: 'assistant', text: a }
]

describe('HistoryStore', () => {
  it('フォルダが無くても空として読め、追記すると月別のJSONLができる', async () => {
    expect(await store.readAll()).toEqual([])
    expect(await store.summary()).toEqual({ messages: 0, firstTs: null, lastTs: null, bytes: 0 })
    await store.append(turn(at(2026, 10, 14), 'こんにちは', 'やあ'))
    expect(readdirSync(join(dir, 'history'))).toEqual(['2026-10.jsonl'])
    expect((await store.readAll()).map((e) => e.text)).toEqual(['こんにちは', 'やあ'])
  })

  it('月をまたぐ追記は、月ごとのファイルに分かれ、読むと時系列に戻る', async () => {
    await store.append([...turn(at(2026, 9, 30, 23), 'q1', 'a1'), ...turn(at(2026, 10, 1, 9), 'q2', 'a2')])
    expect(readdirSync(join(dir, 'history')).sort()).toEqual(['2026-09.jsonl', '2026-10.jsonl'])
    expect((await store.readAll()).map((e) => e.text)).toEqual(['q1', 'a1', 'q2', 'a2'])
  })

  it('同時に何件追記しても、行が混ざったり欠けたりしない', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => store.append(turn(at(2026, 10, 14) + i * 10, `q${i}`, `a${i}`))))
    const all = await store.readAll()
    expect(all).toHaveLength(100)
    expect(new Set(all.map((e) => e.text)).size).toBe(100)
  })

  it('直近Nターンだけを取り出す。必要な分より古い月のファイルは読まなくてよい(新しい月で足りる)', async () => {
    await store.append(turn(at(2026, 8, 1), 'old-q', 'old-a'))
    await store.append([...turn(at(2026, 10, 1), 'q1', 'a1'), ...turn(at(2026, 10, 2), 'q2', 'a2'), ...turn(at(2026, 10, 3), 'q3', 'a3')])
    expect((await store.readRecentTurns(2)).map((e) => e.text)).toEqual(['q2', 'a2', 'q3', 'a3'])
    // 新しい月に足りないときは、古い月まで遡る
    expect((await store.readRecentTurns(4)).map((e) => e.text)).toEqual(['old-q', 'old-a', 'q1', 'a1', 'q2', 'a2', 'q3', 'a3'].slice(0, 8))
  })

  it('キャラごとに分けて保存し、文脈には、そのキャラとの会話だけを読む。characterId の無い古い記録は default のもの', async () => {
    const t = (ts: number, q: string, a: string, id?: string): HistoryEntry[] => [
      { ts, role: 'user', text: q, ...(id ? { characterId: id } : {}) },
      { ts: ts + 1, role: 'assistant', text: a, ...(id ? { characterId: id } : {}) }
    ]
    await store.append([...t(at(2026, 10, 1), 'old-q', 'old-a'), ...t(at(2026, 10, 2), 'a-q', 'a-a', 'c2'), ...t(at(2026, 10, 3), 'd-q', 'd-a', 'default')])
    expect((await store.readRecentTurns(10, 'c2')).map((e) => e.text)).toEqual(['a-q', 'a-a'])
    expect((await store.readRecentTurns(10, 'default')).map((e) => e.text)).toEqual(['old-q', 'old-a', 'd-q', 'd-a'])
    expect(await store.readRecentTurns(10, 'nobody')).toEqual([])
    expect((await store.readRecentTurns(10)).length).toBe(6) // 指定なしは、全員分
  })

  it('壊れた行があっても、他の履歴は読める(書き込み途中の切断を想定)', async () => {
    await store.append(turn(at(2026, 10, 14), 'q', 'a'))
    writeFileSync(join(dir, 'history', '2026-10.jsonl'), readFileSync(join(dir, 'history', '2026-10.jsonl'), 'utf-8') + '{"ts":1,"role":"us')
    expect(await store.readAll()).toHaveLength(2)
    expect((await store.summary()).messages).toBe(2)
  })

  it('件数・期間・サイズを集計できる', async () => {
    await store.append(turn(at(2026, 10, 1), 'a', 'b'))
    await store.append(turn(at(2026, 10, 5), 'c', 'd'))
    const s = await store.summary()
    expect(s.messages).toBe(4)
    expect(s.firstTs).toBe(at(2026, 10, 1))
    expect(s.lastTs).toBe(at(2026, 10, 5) + 1000)
    expect(s.bytes).toBeGreaterThan(0)
  })

  it('clear は履歴ファイルをすべて消す(他のファイルは触らない)', async () => {
    await store.append([...turn(at(2026, 9, 1), 'a', 'b'), ...turn(at(2026, 10, 1), 'c', 'd')])
    writeFileSync(join(dir, 'history', 'README.txt'), 'x')
    await store.clear()
    expect(await store.readAll()).toEqual([])
    expect(existsSync(join(dir, 'history', 'README.txt'))).toBe(true)
  })

  it('deleteBefore は古い発話だけ消し、ファイルが空になれば削除、残る分は書き直す', async () => {
    await store.append([...turn(at(2026, 8, 1), 'a1', 'b1'), ...turn(at(2026, 10, 1), 'a2', 'b2'), ...turn(at(2026, 10, 20), 'a3', 'b3')])
    const removed = await store.deleteBefore(at(2026, 10, 10))
    expect(removed).toBe(4)
    expect(existsSync(join(dir, 'history', '2026-08.jsonl'))).toBe(false)
    expect((await store.readAll()).map((e) => e.text)).toEqual(['a3', 'b3'])
    expect(readdirSync(join(dir, 'history')).some((n) => n.endsWith('.tmp'))).toBe(false)
  })

  it('空の追記は何も作らない', async () => {
    await store.append([])
    expect(existsSync(join(dir, 'history'))).toBe(false)
  })
})
