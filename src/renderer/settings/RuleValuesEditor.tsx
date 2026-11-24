import { useEffect, useState } from 'react'
import type { PackInfo, RuleFieldInfo } from '@shared/packsApi'
import type { RuleValue } from '@shared/rules/effective'

/** Mod のルールの、調整できる値の一覧(「詳しい設定」)。Mod の作者が何も書かなくても、すべての Mod で出る。ルールの本体は、変えない */

const KIND_UNIT: Record<string, string> = { afterSec: '秒', sec: '秒', durationSec: '秒', minSec: '秒', everyMin: '分' }

const show = (v: RuleValue | undefined): string => (v === undefined ? '' : Array.isArray(v) ? v.join('\n') : String(v))

export function RuleValuesEditor({
  pack,
  onSet
}: {
  pack: PackInfo
  /** characterId = '' は全キャラ共通。value = null は、Mod が書いた値に戻す */
  onSet: (ruleId: string, path: string, value: RuleValue | null, characterId: string) => void
}): React.JSX.Element | null {
  const [characters, setCharacters] = useState<Array<{ id: string; name: string }>>([])
  const [activeId, setActiveId] = useState('')
  const [scope, setScope] = useState('')
  useEffect(() => {
    const apply = (c: { activeId: string; characters: Array<{ id: string; name: string }> }): void => {
      setCharacters(c.characters)
      setActiveId(c.activeId)
    }
    void window.vmaid.getCharacterChange().then(apply)
    return window.vmaid.onCharacterChanged(apply)
  }, [])
  if (pack.ruleFields.length === 0) return null

  const byRule = new Map<string, RuleFieldInfo[]>()
  for (const f of pack.ruleFields) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f])
  const changed = pack.ruleFields.filter((f) => f.value !== undefined || Object.keys(f.charValues).length > 0).length

  const currentOf = (f: RuleFieldInfo): RuleValue | undefined => (scope === '' ? f.value : f.charValues[scope])
  /** 空にしたときに、代わりに使われる値 */
  const fallbackOf = (f: RuleFieldInfo): RuleValue => (scope === '' ? f.base : (f.value ?? f.base))

  const input = (f: RuleFieldInfo): React.JSX.Element => {
    const cur = currentOf(f)
    const fb = fallbackOf(f)
    const key = `${scope}/${f.ruleId}/${f.path}/${show(cur)}`
    const set = (v: RuleValue | null): void => onSet(f.ruleId, f.path, v, scope)
    switch (f.kind) {
      case 'number':
        return (
          <>
            <input
              key={key}
              type="number"
              min={f.min}
              max={f.max}
              step="any"
              style={{ width: 90 }}
              defaultValue={show(cur)}
              placeholder={show(fb)}
              onBlur={(e) => {
                const t = e.target.value.trim()
                if (t === show(cur)) return
                set(t === '' ? null : Number(t))
              }}
            />{' '}
            {KIND_UNIT[f.path.split('.').pop() ?? ''] ?? ''}
          </>
        )
      case 'time':
        return <input key={key} type="time" value={show(cur) || show(fb)} onChange={(e) => e.target.value && set(e.target.value)} />
      case 'boolean':
        return (
          <select key={key} value={cur === undefined ? '' : String(cur)} onChange={(e) => set(e.target.value === '' ? null : e.target.value === 'true')}>
            <option value="">(Mod の値: {fb ? 'オン' : 'オフ'})</option>
            <option value="true">オン</option>
            <option value="false">オフ</option>
          </select>
        )
      case 'enum':
        return (
          <select key={key} value={show(cur)} onChange={(e) => set(e.target.value === '' ? null : e.target.value)}>
            <option value="">(Mod の値: {(f.options ?? []).find((o) => o.value === fb)?.label ?? show(fb)})</option>
            {(f.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )
      case 'stringList':
        return (
          <textarea
            key={key}
            rows={Math.min(6, Math.max(2, (Array.isArray(fb) ? fb.length : 1) + 1))}
            style={{ width: '100%' }}
            defaultValue={show(cur)}
            placeholder={show(fb)}
            onBlur={(e) => {
              if (e.target.value === show(cur)) return
              const lines = e.target.value.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '')
              set(lines.length === 0 ? null : lines)
            }}
          />
        )
    }
  }

  return (
    <details className="slots">
      <summary>
        詳しい設定(ルールの値){changed > 0 ? `  — 変えた値 ${changed} 件` : ''}
      </summary>
      <div className="muted small">
        この Mod のルールの、数値・時刻・オン/オフ・セリフを、ここで変えられます(ルールは、そのまま)。空にすると、Mod が書いた値に戻ります。キャラごとに変えることもできます。
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
      {[...byRule].map(([ruleId, fields]) => (
        <details key={ruleId} className="slot-field">
          <summary>
            {fields[0]?.ruleDescription || ruleId} <code className="muted small">{ruleId}</code>
          </summary>
          {fields.map((f) => (
            <div key={f.path} className="slot-field">
              <label className="field-inline">
                {f.nodeLabel}: {f.label}
                {input(f)}
              </label>
              {currentOf(f) !== undefined && (
                <button onClick={() => onSet(f.ruleId, f.path, null, scope)} title="Mod が書いた値(または、全キャラ共通の値)に戻す">
                  初期値に戻す
                </button>
              )}
              {f.hint && <div className="muted small">{f.hint}</div>}
            </div>
          ))}
        </details>
      ))}
    </details>
  )
}
