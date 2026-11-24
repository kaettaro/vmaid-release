import { useEffect, useMemo, useState } from 'react'
import { ADJUST_GROUPS, defaultValues, filterItems, type AdjustGroup, type AdjustItem, type AdjustSnapshot } from '@shared/adjust'

export function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AdjustSnapshot | null>(null)
  const [values, setValues] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<AdjustGroup>('expression')
  const [presetName, setPresetName] = useState('')
  const [presetMessage, setPresetMessage] = useState('')

  useEffect(() => {
    const apply = (s: AdjustSnapshot | null): void => {
      setSnapshot(s)
      setValues(s ? s.values : {})
    }
    void window.vmaid.getAdjust().then(apply)
    return window.vmaid.onAdjustSnapshot(apply)
  }, [])

  // 検索は全グループにかけ、タブには該当件数を出す(別グループにある項目を見落とさないため)
  const filtered = useMemo(() => filterItems(snapshot?.items ?? [], query), [snapshot, query])
  const counts = useMemo(() => {
    const c: Record<AdjustGroup, number> = { expression: 0, morph: 0, visibility: 0 }
    filtered.forEach((i) => c[i.group]++)
    return c
  }, [filtered])
  const shown = filtered.filter((i) => i.group === tab)
  /** いま重ねているセットの名前 */
  const layerIds = useMemo(() => new Set((snapshot?.layers ?? []).map((l) => l.id)), [snapshot])

  const change = (key: string, value: number): void => {
    setValues((v) => ({ ...v, [key]: value }))
    window.vmaid.setAdjust(key, value)
  }
  const savePreset = async (): Promise<void> => {
    const r = await window.vmaid.savePreset(presetName)
    setPresetMessage(r.message)
    if (r.ok) setPresetName('')
  }
  const resetAll = (): void => {
    if (!snapshot) return
    setValues(defaultValues(snapshot.items))
    window.vmaid.resetAdjust()
  }

  return (
    <div className="panel">
      <header>
        <div className="title">
          <strong>表情・衣装</strong>
          <span className="model">{snapshot?.modelName ?? 'モデル未読み込み'}</span>
        </div>
        <button className="close" onClick={() => window.vmaid.closePanel()} aria-label="閉じる">
          ✕
        </button>
      </header>

      {!snapshot ? (
        <p className="empty">モデルを読み込むと、表情・モーフ・表示の項目が自動で並びます。</p>
      ) : (
        <>
          <input
            className="search"
            type="search"
            placeholder="検索(例: smile / 髪 / まばたき)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <nav className="tabs" role="tablist">
            {ADJUST_GROUPS.map((g) => (
              <button
                key={g.id}
                role="tab"
                aria-selected={tab === g.id}
                className={tab === g.id ? 'tab active' : 'tab'}
                onClick={() => setTab(g.id)}
              >
                {g.label} <span className="count">{counts[g.id]}</span>
              </button>
            ))}
          </nav>
          <ul className="list">
            {shown.map((item) => (
              <Row key={item.key} item={item} value={values[item.key] ?? item.defaultValue} onChange={change} />
            ))}
            {shown.length === 0 && <li className="none">該当する項目がありません</li>}
          </ul>
          <details className="presets">
            <summary>セット(名前をつけて保存)</summary>
            <div className="preset-save">
              <input
                type="text"
                placeholder="名前(例: 私服 / 笑顔)"
                value={presetName}
                maxLength={40}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void savePreset()}
              />
              <button onClick={() => void savePreset()} disabled={presetName.trim() === ''}>
                いまの状態を保存
              </button>
            </div>
            <div className="preset-save">
              <button title="重ねているセットを外し、「標準」のセットがあれば、それに戻します" onClick={() => { window.vmaid.resetLook(); setPresetMessage('標準の表情・衣装に戻しました') }}>
                標準に戻す{snapshot.defaultPreset ? `(★${snapshot.defaultPreset})` : ''}
              </button>
            </div>
            <ul className="preset-list">
              {snapshot.presets.map((name) => (
                <li key={name}>
                  <span className="preset-name" title={name}>
                    {snapshot.defaultPreset === name ? '★ ' : ''}
                    {name}
                  </span>
                  <button
                    title={snapshot.defaultPreset === name ? '「標準」を解除します' : '「標準」に決めます(「標準に戻す」やルールの「標準の表情・衣装に戻す」で、このセットに戻ります。見た目は変わりません)'}
                    onClick={() => void window.vmaid.setDefaultPreset(snapshot.defaultPreset === name ? null : name).then((r) => setPresetMessage(r.message))}
                  >
                    {snapshot.defaultPreset === name ? '標準を解除' : '標準にする'}
                  </button>
                  <button
                    title="基準値は変えずに、いまの状態の上に重ねます(猫耳・ハート目・衣装を、別々のセットで同時に使えます)"
                    onClick={() =>
                      void (layerIds.has(name) ? Promise.resolve(window.vmaid.revertPreset({ name })).then(() => setPresetMessage(`「${name}」を外しました`)) : window.vmaid.applyPreset(name, { transient: true, mode: 'overlay' }).then((r) => setPresetMessage(r.message)))
                    }
                  >
                    {layerIds.has(name) ? '外す' : '重ねる'}
                  </button>
                  <button title="状態まるごと入れ替えて、基準値として保存します" onClick={() => void window.vmaid.applyPreset(name).then((r) => setPresetMessage(r.message))}>呼び出す</button>
                  <button
                    className="undo"
                    aria-label={`${name} を削除`}
                    onClick={() => void window.vmaid.deletePreset(name).then((r) => setPresetMessage(r.message))}
                  >
                    ✕
                  </button>
                </li>
              ))}
              {snapshot.presets.length === 0 && <li className="none">保存したセットはまだありません</li>}
            </ul>
            {presetMessage && <div className="note">{presetMessage}</div>}
            {layerIds.size > 0 && <div className="note">重ねているセット: {[...layerIds].join(' / ')}(「すべてリセット」で外れます)</div>}
            <div className="note">ルールの「表情・衣装セットを適用」から呼び出せます。</div>
          </details>
          <footer>
            <button onClick={resetAll}>すべてリセット</button>
            <span className="note">モデルごとに自動保存</span>
          </footer>
        </>
      )}
    </div>
  )
}

function Row({
  item,
  value,
  onChange
}: {
  item: AdjustItem
  value: number
  onChange: (key: string, value: number) => void
}): React.JSX.Element {
  const changed = value !== item.defaultValue
  if (item.kind === 'toggle') {
    return (
      <li className="row">
        <label className="toggle">
          <input type="checkbox" checked={value >= 0.5} onChange={(e) => onChange(item.key, e.target.checked ? 1 : 0)} />
          <span className="label">{item.label}</span>
        </label>
      </li>
    )
  }
  return (
    <li className="row">
      <div className="head">
        <span className={changed ? 'label changed' : 'label'} title={item.key}>
          {item.label}
        </span>
        <span className="value">{value.toFixed(2)}</span>
        <button className="undo" disabled={!changed} onClick={() => onChange(item.key, item.defaultValue)} aria-label="この項目をリセット">
          ↺
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(item.key, Number(e.target.value))}
      />
      {item.hint && <div className="hint">{item.hint}</div>}
    </li>
  )
}
