import { describe, expect, it } from 'vitest'
import {
  fileNameForMonth,
  lastTurns,
  monthFromFileName,
  monthKey,
  parseLines,
  serializeEntry,
  toExportJson,
  toExportText,
  type HistoryEntry
} from './format'

const e = (ts: number, role: 'user' | 'assistant', text: string): HistoryEntry => ({ ts, role, text })
const base = new Date(2026, 9, 14, 10, 30, 0).getTime() // 2026-10-14 10:30(ローカル)

describe('JSONL', () => {
  it('1行1メッセージで保存・復元でき、改行や日本語・引用符を含んでも壊れない', () => {
    const entries = [e(base, 'user', '「こんにちは」\n"quote"'), e(base + 1000, 'assistant', 'やあ🙂')]
    const text = entries.map(serializeEntry).join('\n') + '\n'
    expect(text.split('\n').filter(Boolean)).toHaveLength(2) // テキスト中の改行は \n にエスケープされ、行は増えない
    expect(parseLines(text)).toEqual(entries)
  })
  it('壊れた行・不正な形式の行・空行は読み飛ばし、残りは読める', () => {
    const good = serializeEntry(e(base, 'user', 'a'))
    const text = [good, '{壊れた', '', '{"ts":"x","role":"user","text":"b"}', '{"ts":1,"role":"system","text":"c"}', '{"ts":5,"role":"assistant"', good].join('\n')
    expect(parseLines(text)).toHaveLength(2)
  })
  it('CRLFでも読める', () => {
    expect(parseLines(`${serializeEntry(e(1, 'user', 'a'))}\r\n${serializeEntry(e(2, 'assistant', 'b'))}\r\n`)).toHaveLength(2)
  })
})

describe('月ごとのファイル名', () => {
  it('ローカル時間の年月になり、ファイル名と相互に変換できる', () => {
    expect(monthKey(base)).toBe('2026-10')
    expect(fileNameForMonth('2026-10')).toBe('2026-10.jsonl')
    expect(monthFromFileName('2026-10.jsonl')).toBe('2026-10')
  })
  it('履歴ファイル以外の名前は null(拡張子違い・日付違い・一時ファイル)', () => {
    for (const n of ['2026-10.jsonl.tmp', 'notes.txt', '2026-1.jsonl', '../2026-10.jsonl', '.DS_Store']) expect(monthFromFileName(n)).toBeNull()
  })
  it('月の境目(12月→1月)', () => {
    expect(monthKey(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026-12')
    expect(monthKey(new Date(2027, 0, 1, 0, 0).getTime())).toBe('2027-01')
  })
})

describe('lastTurns', () => {
  const h = [e(1, 'user', 'q1'), e(2, 'assistant', 'a1'), e(3, 'user', 'q2'), e(4, 'assistant', 'a2'), e(5, 'user', 'q3'), e(6, 'assistant', 'a3')]
  it('末尾から Nターン(ユーザー発話の数)を、ターンの途中で切らずに取り出す', () => {
    expect(lastTurns(h, 2).map((x) => x.text)).toEqual(['q2', 'a2', 'q3', 'a3'])
    expect(lastTurns(h, 1).map((x) => x.text)).toEqual(['q3', 'a3'])
    expect(lastTurns(h, 99)).toHaveLength(6)
  })
  it('空・ユーザー発話なしなら空。最後が応答待ち(ユーザー発話で終わる)でもよい', () => {
    expect(lastTurns([], 3)).toEqual([])
    expect(lastTurns([e(1, 'assistant', 'x')], 3)).toEqual([])
    expect(lastTurns([...h, e(7, 'user', 'q4')], 1).map((x) => x.text)).toEqual(['q4'])
  })
  it('先頭が assistant で始まる断片は捨てる', () => {
    expect(lastTurns([e(0, 'assistant', 'orphan'), e(1, 'user', 'q'), e(2, 'assistant', 'a')], 5).map((x) => x.text)).toEqual(['q', 'a'])
  })
})

describe('エクスポート', () => {
  const entries = [e(base, 'user', 'おはよう'), e(base + 5000, 'assistant', '1行目\n2行目'), e(base + 86400000, 'user', '翌日')]
  it('JSON: 時刻はISO、役割と本文を持つ', () => {
    const parsed = JSON.parse(toExportJson(entries))
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toMatchObject({ role: 'user', text: 'おはよう' })
    expect(new Date(parsed[0].time).getTime()).toBe(base)
  })
  it('テキスト: 日付の見出し・名前つき・複数行はインデント', () => {
    const t = toExportText(entries, { character: 'ユメ', user: 'あなた' })
    expect(t).toContain('# 2026-10-14')
    expect(t).toContain('# 2026-10-15')
    expect(t).toContain('[10:30] あなた: おはよう')
    expect(t).toContain('ユメ: 1行目\n    2行目')
  })
  it('空の履歴は空文字', () => {
    expect(toExportText([], { character: 'a', user: 'b' })).toBe('')
    expect(JSON.parse(toExportJson([]))).toEqual([])
  })
})
