import { useEffect, useMemo, useState } from 'react'
import type { ModExportInfo } from '@shared/modsApi'
import { PACK_ID_RE } from '@shared/packs/manifest'

/** 「Mod としてエクスポート」: 自分のルール・モーション・指示文を、選んで、1つの Mod(.vmaidmod)にまとめる */
export function ModExportSection(): React.JSX.Element {
  const [info, setInfo] = useState<ModExportInfo | null>(null)
  const [id, setId] = useState('my-mod')
  const [name, setName] = useState('')
  const [version, setVersion] = useState('0.1.0')
  const [description, setDescription] = useState('')
  const [ruleIds, setRuleIds] = useState<ReadonlySet<string>>(new Set())
  const [motionNames, setMotionNames] = useState<ReadonlySet<string>>(new Set())
  const [promptText, setPromptText] = useState('')
  const [layer, setLayer] = useState<'persona' | 'state'>('persona')
  const [confirmed, setConfirmed] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string; warnings: string[] } | null>(null)

  const load = (): void => void window.vmaid.getModExportInfo().then(setInfo)
  useEffect(load, [])

  const own = useMemo(() => new Set(info?.motions.map((m) => m.name) ?? []), [info])
  const idOk = PACK_ID_RE.test(id)
  const toggle = (set: ReadonlySet<string>, setter: (s: ReadonlySet<string>) => void, key: string): void => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setter(next)
  }
  const anything = ruleIds.size > 0 || motionNames.size > 0 || promptText.trim() !== ''
  const needsConfirm = motionNames.size > 0
  const canExport = idOk && name.trim() !== '' && anything && (!needsConfirm || confirmed)

  const run = async (): Promise<void> => {
    const r = await window.vmaid.exportMod({ id, name, version, description, ruleIds: [...ruleIds], motionNames: [...motionNames].filter((n) => own.has(n)), promptText, promptLayer: layer })
    setNote(r.message || r.warnings.length > 0 ? { ok: r.ok, text: r.message, warnings: r.warnings } : null)
  }

  return (
    <details className="tagmanager" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
      <summary>自分のルール・モーション・指示文を、Mod として書き出す</summary>
      <p className="muted small">
        選んだものを、1つの Mod(.vmaidmod)にまとめます。他のPCや、他の人へ渡せます。<strong>モデル(VRM)・個人の設定・会話履歴は含まれません。</strong>
        ルールが使っている自分のモーションは、自動で含まれます。
      </p>
      {!info ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <>
          <div className="row">
            <label className="field-inline">
              id(英小文字・数字・ハイフン)
              <input type="text" value={id} onChange={(e) => setId(e.target.value)} />
            </label>
            <label className="field-inline">
              名前
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field-inline">
              バージョン
              <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} />
            </label>
          </div>
          {!idOk && <p className="ng small">id は、英小文字・数字・ハイフンで、2〜41文字にしてください(例: my-mod)</p>}
          <label className="field-inline">
            説明
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <h3>ルール({info.rules.length}件・自分のルールのみ)</h3>
          <div className="check-list">
            {info.rules.map((r) => (
              <label key={r.id} className="radio-line">
                <input type="checkbox" checked={ruleIds.has(r.id)} onChange={() => toggle(ruleIds, setRuleIds, r.id)} />
                <code>{r.id}</code> <span className="muted small">{r.description}</span>
              </label>
            ))}
            {info.rules.length === 0 && <p className="muted small">自分のルールがありません。</p>}
          </div>

          <h3>モーション({info.motions.length}件・自分が登録したもののみ)</h3>
          <div className="check-list">
            {info.motions.map((m) => (
              <label key={m.name} className="radio-line">
                <input type="checkbox" checked={motionNames.has(m.name)} onChange={() => toggle(motionNames, setMotionNames, m.name)} />
                {m.name} {m.tags.length > 0 && <span className="muted small">{m.tags.map((t) => `#${t}`).join(' ')}</span>}
              </label>
            ))}
            {info.motions.length === 0 && <p className="muted small">登録したモーションがありません。</p>}
          </div>

          <h3>会話の指示文(任意)</h3>
          <div className="row">
            <select value={layer} onChange={(e) => setLayer(e.target.value as 'persona' | 'state')}>
              <option value="persona">性格(重ね掛けできる)</option>
              <option value="state">状態(性格のあとに足す)</option>
            </select>
            <button onClick={() => setPromptText(info.characterPrompt)} disabled={info.characterPrompt.trim() === ''}>
              いまのキャラの設定を入れる
            </button>
          </div>
          <textarea rows={3} value={promptText} placeholder="例: ゆっくり、やさしく話す(2000文字まで。空なら含めない)" onChange={(e) => setPromptText(e.target.value)} />

          {needsConfirm && (
            <label className="radio-line">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              含めるモーションを、渡す相手に使わせてよい(配布元の規約で許されている)ことを確認しました
            </label>
          )}
          <p className="muted small">書き出した Mod は、「私用(再配布不可)」として扱われます。他の人へ公開・配布するときは、素材の規約を、自分で確認してください。</p>
          <div className="row">
            <button className="primary" disabled={!canExport} onClick={() => void run()}>
              書き出す…
            </button>
          </div>
          {note && (
            <>
              {note.text && <p className={note.ok ? 'ok small' : 'ng small'}>{note.text}</p>}
              {note.warnings.map((w) => (
                <p key={w} className="ng small">
                  {w}
                </p>
              ))}
            </>
          )}
        </>
      )}
    </details>
  )
}
