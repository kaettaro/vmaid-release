import { useCallback, useEffect, useState } from 'react'
import type { HistoryList as HistoryListData } from '@shared/historyApi'

const PAGE = 30
const formatDate = (ts: number): string => new Date(ts).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })

/**
 * 履歴の本文の一覧(新しい順)。キャラ・言葉で絞り込み、選んだ記録や、直近の n 件を、削除できる。
 * 一覧の取得と削除は main が行う(削除は、確認ダイアログつき)。
 */
export function HistoryList({ characters, version, onChanged }: { characters: Array<{ id: string; name: string }>; version: number; onChanged: () => void }): React.JSX.Element {
  const [characterId, setCharacterId] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<HistoryListData | null>(null)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [last, setLast] = useState(10)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const d = await window.vmaid.listHistory({ ...(characterId ? { characterId } : {}), query, offset: page * PAGE, limit: PAGE })
    setData(d)
  }, [characterId, query, page])
  useEffect(() => {
    let alive = true
    void window.vmaid.listHistory({ ...(characterId ? { characterId } : {}), query, offset: page * PAGE, limit: PAGE }).then((d) => alive && setData(d))
    return () => {
      alive = false
    }
  }, [characterId, query, page, version])

  const nameOf = (id: string | undefined): string => characters.find((c) => c.id === (id ?? 'default'))?.name ?? (id ?? 'default')
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1

  const run = async (fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    const r = await fn()
    if (r.message) setMessage(r.message)
    setChecked(new Set())
    await load()
    onChanged()
  }
  const toggle = (key: string): void =>
    setChecked((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <>
      <h2>履歴を見る・消す</h2>
      <div className="row">
        <select
          value={characterId}
          onChange={(e) => {
            setCharacterId(e.target.value)
            setPage(0)
          }}
          aria-label="キャラで絞り込む"
        >
          <option value="">すべてのキャラ</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={query}
          placeholder="本文で検索"
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(0)
          }}
        />
        <span className="muted small">{data ? `${data.total}件` : '読み込み中…'}</span>
      </div>

      <ul className="history-list">
        {data?.items.map((m) => (
          <li key={`${m.key}|${m.text.length}`} className={m.role === 'user' ? 'h-user' : 'h-char'}>
            <label className="radio-line">
              <input type="checkbox" checked={checked.has(m.key)} onChange={() => toggle(m.key)} />
              <span className="muted small">
                {formatDate(m.ts)} / {m.role === 'user' ? 'あなた' : nameOf(m.characterId)}
              </span>
            </label>
            <div className="h-text">{m.text}</div>
          </li>
        ))}
        {data && data.items.length === 0 && <li className="muted small">該当する履歴はありません。</li>}
      </ul>

      <div className="row">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ← 新しい
        </button>
        <span className="muted small">
          {page + 1} / {pages} ページ
        </span>
        <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
          古い →
        </button>
        <button className="danger" disabled={checked.size === 0} onClick={() => void run(() => window.vmaid.deleteHistoryKeys([...checked]))}>
          選んだ {checked.size} 件を削除…
        </button>
      </div>
      <div className="row">
        <span>新しいほうから</span>
        <input type="number" min={1} max={100000} value={last} onChange={(e) => setLast(Math.max(1, Number(e.target.value) || 1))} style={{ width: '5em' }} />
        <span>件を</span>
        <button className="danger" onClick={() => void run(() => window.vmaid.deleteHistoryLast(last, characterId || undefined))}>
          削除…
        </button>
        <span className="muted small">{characterId ? `(「${nameOf(characterId)}」の分だけ)` : '(すべてのキャラ)'}</span>
      </div>
      {message && <p className="muted">{message}</p>}
    </>
  )
}
