import { useCallback, useEffect, useState } from 'react'
import { formatBytes } from '@shared/models/registry'
import type { ModelsView, ModelView } from '@shared/modelsApi'

function formatEta(sec: number | null): string {
  if (sec === null) return ''
  if (sec < 60) return `残り約${Math.ceil(sec)}秒`
  return `残り約${Math.ceil(sec / 60)}分`
}

/** 内蔵LLMのモデル管理: おすすめ表示・ダウンロード(進捗・中止・再開)・選択・削除・任意のGGUF */
export function ModelsSection(): React.JSX.Element {
  const [view, setView] = useState<ModelsView | null>(null)
  const [message, setMessage] = useState<string>('')

  const refresh = useCallback(async () => setView(await window.vmaid.listModels()), [])
  useEffect(() => {
    // 初回の取得(結果を受けてから state を更新する)。ダウンロードの進捗は main から流れてくる
    let alive = true
    void window.vmaid.listModels().then((v) => alive && setView(v))
    const off = window.vmaid.onModelsProgress(setView)
    return () => {
      alive = false
      off()
    }
  }, [])

  if (!view) return <p className="muted">読み込み中…</p>
  const busy = view.download !== null

  const act = async (fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    const r = await fn()
    if (r.message) setMessage(r.message)
    await refresh()
  }

  return (
    <div className="models">
      <p className="muted">
        このPCのメモリ: {view.totalRamGB}GB。モデルは最初に1回ダウンロードするだけで、以後は完全オフラインで動きます。
        保存先: <code>{view.modelsDir}</code>
      </p>
      <ul className="model-list">
        {view.models.map((m) => (
          <ModelRow key={m.id} m={m} download={view.download?.modelId === m.id ? view.download : null} busy={busy} onAct={act} onSelect={async () => setView(await window.vmaid.selectModel(m.id))} />
        ))}
      </ul>

      <div className="custom">
        <div className="row">
          <button
            onClick={() => void act(() => window.vmaid.pickCustomModel())}
            title="上級者向け: 自分で用意した .gguf ファイルを使います"
          >
            任意のGGUFファイルを使う…
          </button>
          {view.customPath && (
            <>
              <code className="path">{view.customPath}</code>
              <button onClick={async () => setView(await window.vmaid.clearCustomModel())}>指定を解除</button>
            </>
          )}
        </div>
        {view.customPath && <div className="notice warn">任意のモデルを使っています。ライセンス・利用条件は、あなた自身の責任で確認してください。</div>}
      </div>
      {message && <p className="muted">{message}</p>}
    </div>
  )
}

function ModelRow({
  m,
  download,
  busy,
  onAct,
  onSelect
}: {
  m: ModelView
  download: NonNullable<ModelsView['download']> | null
  busy: boolean
  onAct: (fn: () => Promise<{ ok: boolean; message: string }>) => Promise<void>
  onSelect: () => Promise<void>
}): React.JSX.Element {
  const partial = m.partialBytes > 0 && !m.installed
  return (
    <li className={m.selected ? 'model selected' : 'model'}>
      <div className="model-head">
        <label className="radio-line">
          <input type="radio" name="model" checked={m.selected} disabled={!m.installed} onChange={() => void onSelect()} />
          <strong>{m.name}</strong>
        </label>
        {m.recommended && <span className="badge">おすすめ</span>}
        {m.heavy && <span className="badge warn">このPCには重い可能性</span>}
      </div>
      <div className="muted small">
        {formatBytes(m.sizeBytes)} / {m.license} / メモリ目安 {m.minRamGB}GB以上
      </div>
      {m.notes && <div className="muted small">{m.notes}</div>}
      <div className="row">
        {download ? (
          <>
            <progress max={1} value={download.fraction} />
            <span className="small">
              {download.phase === 'verifying' ? '検証しています…' : `${Math.round(download.fraction * 100)}% ${formatEta(download.etaSec)}`}
            </span>
            <button onClick={() => window.vmaid.cancelDownload()}>中止</button>
          </>
        ) : m.installed ? (
          <>
            <span className="ok small">ダウンロード済み</span>
            <button disabled={busy} onClick={() => void onAct(() => window.vmaid.deleteModel(m.id))}>
              削除
            </button>
          </>
        ) : (
          <>
            <button className="primary" disabled={busy} onClick={() => void onAct(() => window.vmaid.downloadModel(m.id))}>
              {partial ? `続きからダウンロード(${Math.round((m.partialBytes / m.sizeBytes) * 100)}%済み)` : 'ダウンロード'}
            </button>
            {partial && (
              <button disabled={busy} onClick={() => void onAct(() => window.vmaid.deleteModel(m.id))}>
                途中のファイルを削除
              </button>
            )}
          </>
        )}
      </div>
    </li>
  )
}
