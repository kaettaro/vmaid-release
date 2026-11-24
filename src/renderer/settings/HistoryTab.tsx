import { useCallback, useEffect, useState } from 'react'
import type { HistoryView } from '@shared/historyApi'
import type { SettingsPatch, SettingsView } from '@shared/settingsApi'
import { HistoryList } from './HistoryList'

const formatDate = (ts: number | null): string => (ts === null ? '-' : new Date(ts).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }))
const formatSize = (bytes: number): string => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`)

interface Props {
  view: SettingsView
  update: (patch: SettingsPatch) => Promise<void>
}

/** 履歴タブ: 保存するか・件数・削除・エクスポート。履歴はこのPCの中にだけ保存される */
export function HistoryTab({ view, update }: Props): React.JSX.Element {
  const [history, setHistory] = useState<HistoryView | null>(null)
  const [message, setMessage] = useState('')
  const [days, setDays] = useState(30)
  /** 履歴が変わったら増やして、一覧を取り直させる */
  const [version, setVersion] = useState(0)

  const refresh = useCallback(async () => setHistory(await window.vmaid.getHistory()), [])
  useEffect(() => {
    let alive = true
    void window.vmaid.getHistory().then((h) => alive && setHistory(h))
    return () => {
      alive = false
    }
  }, [])

  const run = async (fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    const r = await fn()
    setMessage(r.message)
    await refresh()
    setVersion((v) => v + 1)
  }

  const s = history?.summary
  return (
    <section>
      <h1>履歴</h1>
      <p className="muted">会話の履歴は、このPCの中にだけ保存されます(外部には送信されません)。</p>

      <label className="check">
        <input
          type="checkbox"
          checked={view.history.enabled}
          onChange={(e) => void update({ history: { enabled: e.target.checked } }).then(refresh)}
        />
        会話履歴を保存する(オフにすると、これからの会話は保存されません)
      </label>

      <div className="stats">
        {!s ? (
          <span className="muted">読み込み中…</span>
        ) : s.messages === 0 ? (
          <span className="muted">保存されている履歴はありません。</span>
        ) : (
          <>
            <div>
              <strong>{s.messages}</strong> 件のメッセージ({formatSize(s.bytes)})
            </div>
            <div className="muted small">
              {formatDate(s.firstTs)} 〜 {formatDate(s.lastTs)}
            </div>
          </>
        )}
        {history && (
          <div className="muted small">
            保存先: <code>{history.dir}</code>
          </div>
        )}
      </div>

      <HistoryList characters={view.characters.map((c) => ({ id: c.id, name: c.name }))} version={version} onChanged={() => void refresh()} />

      <h2>書き出し</h2>
      <div className="row">
        <button disabled={!s || s.messages === 0} onClick={() => void run(() => window.vmaid.exportHistory('text'))}>
          テキストで書き出す…
        </button>
        <button disabled={!s || s.messages === 0} onClick={() => void run(() => window.vmaid.exportHistory('json'))}>
          JSONで書き出す…
        </button>
      </div>

      <h2>まとめて削除</h2>
      <div className="row">
        <button className="danger" disabled={!s || s.messages === 0} onClick={() => void run(() => window.vmaid.clearHistory())}>
          すべて削除…
        </button>
      </div>
      <div className="row">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              {d}日
            </option>
          ))}
        </select>
        <span>より古い履歴を</span>
        <button disabled={!s || s.messages === 0} onClick={() => void run(() => window.vmaid.deleteHistoryOlderThan(days))}>
          削除…
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
    </section>
  )
}
