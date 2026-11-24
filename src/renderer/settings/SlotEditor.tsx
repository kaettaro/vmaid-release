import { useEffect, useState } from 'react'
import type { PackInfo } from '@shared/packsApi'
import { DanceTableEditor } from './DanceTableEditor'

type Slot = PackInfo['slots'][number]

/** 見出し(group)ごとにまとめる。見出しのないものが先(1 つの塊)。見出しは、最初に出てきた順 */
function groupedSlots(slots: readonly Slot[]): Array<[string, Slot[]]> {
  const m = new Map<string, Slot[]>()
  for (const sl of slots) m.set(sl.group ?? '', [...(m.get(sl.group ?? '') ?? []), sl])
  return [...m].sort((x, y) => (x[0] === '' ? -1 : y[0] === '' ? 1 : 0))
}

/**
 * Mod のスロット(利用者が決める項目)の編集。キャラごとに値を変えられる(「全キャラ共通」+ キャラ別の上書き)。
 * 値の優先順位: キャラ別の値 → 全キャラ共通の値 → Mod の初期値。空にすると、一つ下の値に戻る。
 */
export function SlotEditor({
  pack,
  motionNames,
  onSet
}: {
  pack: PackInfo
  motionNames: string[]
  /** characterId = '' は全キャラ共通 */
  onSet: (slotId: string, value: string, characterId: string) => void
}): React.JSX.Element {
  const [characters, setCharacters] = useState<Array<{ id: string; name: string }>>([])
  const [activeId, setActiveId] = useState('')
  const [scope, setScope] = useState('') // '' = 全キャラ共通
  // 使っているキャラのモデルに保存された「表情・衣装セット」の名前(モーフ・表情の組み合わせ)
  const [presets, setPresets] = useState<string[]>([])
  // 画面効果の選択肢(組み込み + 自作)
  const [effects, setEffects] = useState<Array<{ name: string; label: string }>>([])

  useEffect(() => {
    const apply = (c: { activeId: string; characters: Array<{ id: string; name: string }> }): void => {
      setCharacters(c.characters)
      setActiveId(c.activeId)
      void window.vmaid.getAdjust().then((a) => setPresets(a?.presets ?? []))
    }
    void window.vmaid.getCharacterChange().then(apply)
    void window.vmaid.getOverlayEffects().then((l) => setEffects(l.filter((e) => !e.error).map((e) => ({ name: e.name, label: e.label }))))
    return window.vmaid.onCharacterChanged(apply)
  }, [])

  const valueOf = (s: Slot): string => (scope === '' ? s.value : (s.charValues[scope] ?? ''))
  /** このキャラ(または共通)の値が空のときに、代わりに使われる値(説明用) */
  const fallbackOf = (s: Slot): string => (scope === '' ? (s.default ?? '') : s.value || (s.default ?? ''))
  const presetsHere = scope === '' || scope === activeId

  const renderSlot = (s: Slot): React.JSX.Element => {
        const v = valueOf(s)
        const fb = fallbackOf(s)
        const set = (value: string): void => onSet(s.id, value, scope)
        const fieldKey = `${scope}/${s.id}/${v}`
        if (s.kind === 'dances') {
          // 楽曲の表(ダンス Mod): 行の編集中に作り直さないよう、key に値を含めない
          return (
            <div key={s.id} className="slot-field">
              <div>{s.label}</div>
              <DanceTableEditor key={`${scope}/${s.id}`} value={v} motionNames={motionNames} onChange={set} />
              {scope !== '' && v === '' && fb !== '' && <div className="muted small">このキャラの表が空のあいだは、全キャラ共通の表を使います。</div>}
              {s.hint && <div className="muted small">{s.hint}</div>}
            </div>
          )
        }
        return (
          <div key={s.id} className="slot-field">
            <label className="field-inline">
              {s.label}
              {s.kind === 'number' ? (
                <>
                  <input key={fieldKey} type="number" min={s.min} max={s.max} step={s.step ?? 'any'} style={{ width: 100 }} defaultValue={v} placeholder={fb} onBlur={(e) => e.target.value !== v && set(e.target.value)} />
                  {s.unit ?? ''}
                </>
              ) : s.kind === 'time' ? (
                <input key={fieldKey} type="time" value={v || fb} onChange={(e) => e.target.value && set(e.target.value)} />
              ) : s.kind === 'boolean' ? (
                <select value={v} onChange={(e) => set(e.target.value)}>
                  <option value="">(初期値: {fb === 'true' ? 'オン' : 'オフ'})</option>
                  <option value="true">オン</option>
                  <option value="false">オフ</option>
                </select>
              ) : s.kind === 'lines' ? (
                <textarea key={fieldKey} rows={Math.min(8, Math.max(3, (v || fb).split('\n').length + 1))} style={{ width: '100%' }} defaultValue={v} placeholder={fb} onBlur={(e) => e.target.value !== v && set(e.target.value)} />
              ) : s.kind === 'motion' ? (
                <select value={v} onChange={(e) => set(e.target.value)}>
                  <option value="">{fb ? `(${scope === '' ? '初期値' : '共通'}: ${fb})` : '(空)'}</option>
                  {v !== '' && !motionNames.includes(v) && <option value={v}>{v}(見つかりません)</option>}
                  {motionNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ) : s.kind === 'choice' ? (
                <select value={v} onChange={(e) => set(e.target.value)}>
                  <option value="">{fb ? `(${scope === '' ? '初期値' : '共通'}: ${(s.options ?? []).find((o) => o.value === fb)?.label ?? fb})` : '(未選択)'}</option>
                  {(s.options ?? []).map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : s.kind === 'effect' ? (
                <select value={v} onChange={(e) => set(e.target.value)}>
                  <option value="">{fb ? `(${scope === '' ? '初期値' : '共通'}: ${effects.find((x) => x.name === fb)?.label ?? fb})` : '(なし=効果を出さない)'}</option>
                  {v !== '' && !effects.some((x) => x.name === v) && <option value={v}>{v}(見つかりません)</option>}
                  {effects.map((x) => (
                    <option key={x.name} value={x.name}>
                      {x.label}({x.name})
                    </option>
                  ))}
                </select>
              ) : s.kind === 'preset' && presetsHere ? (
                <select value={v} onChange={(e) => set(e.target.value)}>
                  <option value="">{fb ? `(${scope === '' ? '初期値' : '共通'}: ${fb})` : '(なし)'}</option>
                  {v !== '' && !presets.includes(v) && <option value={v}>{v}(見つかりません)</option>}
                  {presets.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ) : v.length > 60 || fb.length > 60 || s.kind === 'text' && (s.default ?? '').length > 60 ? (
                <textarea key={fieldKey} rows={3} defaultValue={v} placeholder={fb} onBlur={(e) => e.target.value !== v && set(e.target.value)} />
              ) : (
                <input key={fieldKey} type="text" defaultValue={v} placeholder={fb} onBlur={(e) => e.target.value !== v && set(e.target.value)} />
              )}
            </label>
            {v !== '' && (
              <button onClick={() => set('')} title="初期値(または、全キャラ共通の値)に戻す">
                初期値に戻す
              </button>
            )}
            {(s.hint || (s.kind === 'preset' && !presetsHere)) && (
              <div className="muted small">
                {s.hint}
                {s.kind === 'preset' && !presetsHere && ' セット名は、そのキャラを使っているときに、一覧から選べます(ここでは、名前を直接入力します)。'}
              </div>
            )}
          </div>
        )
  }

  return (
    <div className="slots">
      <div className="muted small">
        この Mod の設定です。キャラごとに変えられます(キャラ別の値 → 全キャラ共通の値 → 初期値、の順に使います)。空にすると、ひとつ手前の値に戻ります。
      </div>
      <label className="field-inline">
        設定するキャラ
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">全キャラ共通</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.id === activeId ? '(使用中)' : ''}
            </option>
          ))}
        </select>
      </label>
      {groupedSlots(pack.slots).map(([group, list], gi) =>
        group === '' ? (
          <div key="">{list.map((sl) => renderSlot(sl))}</div>
        ) : (
          <details key={group} open={gi === 0}>
            <summary>{group}</summary>
            {list.map((sl) => renderSlot(sl))}
          </details>
        )
      )}
      {pack.slots.some((s) => s.kind === 'effect') && (
        <div className="muted small">画面効果は、設定 → Mod の「画面効果」(公式の機能 Mod)で、自分で作って増やせます。</div>
      )}
      {pack.slots.some((s) => s.kind === 'preset') && (
        <div className="muted small">「表情・衣装セット」は、表情・衣装パネルの「名前をつけて保存」で作ります(表情・モーフ・メッシュの表示の組み合わせ。モデルごと)。</div>
      )}
    </div>
  )
}
