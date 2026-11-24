import { useId, useState } from 'react'
import type { ParamDef } from '@shared/rules/definitions'
import type { RuleRegistry } from '@shared/rules/registry'

/** フォームの選択肢の元(登録済みのモーション・タグ・表情) */
export interface FormContext {
  motions: string[]
  /** モーションのタグと、そのタグが付いたモーションの数(多い順) */
  tags: Array<{ tag: string; count: number }>
  expressions: string[]
  /** 表情・衣装パネルで保存したセットの名前(読み込み中のモデルの分) */
  presets: string[]
  /** 画面効果(組み込み + 自作)。名前と表示名 */
  overlayEffects: Array<{ name: string; label: string }>
  /** Mod が宣言した、触れ合いの部位(有効なもの。ルールの「触った部位」の選択肢に足す) */
  touchParts: Array<{ id: string; label: string }>
  /** 基本設定「再生ウィンドウの中にもキャラを出す」が ON か(ON のときだけ、モーション欄に、ウィンドウ内で再生するボタンを足す) */
  previewInWindow: boolean
  /** キャラの一覧(ルールの「対象キャラ」の選択肢) */
  characters: Array<{ id: string; name: string }>
  /** 使える種類・パラメータ(機能 Mod の ON/OFF) */
  registry: RuleRegistry
}

interface Props {
  def: ParamDef
  value: unknown
  ctx: FormContext
  onChange: (value: unknown) => void
}

/**
 * パラメータ1つ分の入力欄。**定義(ParamDef)の kind から自動で作る**ので、
 * トリガー・条件・アクションの種類を増やしても、このGUIを作り直さなくてよい(SPEC 6.3)。
 */
export function ParamField({ def, value, ctx, onChange }: Props): React.JSX.Element {
  const id = useId()
  const listId = `${id}-list`
  const label = (
    <label htmlFor={id} className="pf-label">
      {def.label}
      {def.required && <span className="req"> *</span>}
    </label>
  )
  const hint = def.hint ? <div className="pf-hint">{def.hint}</div> : null

  switch (def.kind) {
    case 'number':
      return (
        <div className="pf">
          {label}
          <input
            id={id}
            type="number"
            min={def.min}
            max={def.max}
            step={def.max !== undefined && def.max <= 1 ? 0.05 : def.min !== undefined && def.min < 1 ? 0.1 : 1}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
          {hint}
        </div>
      )
    case 'boolean':
      return (
        <div className="pf">
          <label className="pf-check">
            <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
            {def.label}
          </label>
          {hint}
        </div>
      )
    case 'enum': {
      // 候補が開いている列挙(触れ合いの部位)は、Mod が宣言した部位も出す。選ばれている値が候補に無ければ(Mod が OFF など)、そのまま見せる
      const base = def.options ?? []
      const extra = def.open ? ctx.touchParts.filter((p) => !base.some((o) => o.value === p.id)).map((p) => ({ value: p.id, label: p.label })) : []
      const options = [...base, ...extra]
      const current = typeof value === 'string' ? value : ''
      const unknown = def.open && current !== '' && !options.some((o) => o.value === current)
      return (
        <div className="pf">
          {label}
          <select id={id} value={current} onChange={(e) => onChange(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {unknown && <option value={current}>{current}(その Mod が OFF か、見つかりません)</option>}
          </select>
          {hint}
        </div>
      )
    }
    case 'time':
      return (
        <div className="pf">
          {label}
          <input id={id} type="time" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} />
          {hint}
        </div>
      )
    case 'stringList':
      return (
        <div className="pf">
          {label}
          <textarea
            id={id}
            rows={3}
            placeholder="1行に1つ"
            value={Array.isArray(value) ? (value as string[]).join('\n') : typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value.split('\n'))}
          />
          {hint}
        </div>
      )
    case 'motion':
    case 'motionTag': {
      // 数百〜数千の候補から選ぶので、<select> ではなく、入力して絞り込める欄にする(候補は datalist)
      const isMotion = def.kind === 'motion'
      const options = isMotion ? ctx.motions.map((m) => ({ value: m, label: m })) : ctx.tags.map((t) => ({ value: t.tag, label: `${t.tag}(${t.count}件)` }))
      const v = typeof value === 'string' ? value : ''
      const unknown = v !== '' && !options.some((o) => o.value === v)
      return (
        <div className="pf">
          {label}
          <ComboInput
            id={id}
            listId={listId}
            value={v}
            placeholder={isMotion ? 'モーション名(入力で絞り込み)' : 'タグ名(入力で絞り込み)'}
            valid={(text) => options.some((o) => o.value === text)}
            onCommit={(text) => onChange(text.trim() === '' ? undefined : text.trim())}
          />
          {isMotion && (
            <>
              <button type="button" className="small" disabled={v === '' || unknown} title="画面のキャラで、このモーションを再生して確認します" onClick={() => window.vmaid.previewMotion(v)}>
                ▶ 再生
              </button>
              {ctx.previewInWindow && (
                <button type="button" className="small" disabled={v === '' || unknown} title="再生ウィンドウの中のキャラで再生します(画面のキャラは動きません)" onClick={() => window.vmaid.openMotionPreview(v)}>
                  ⧉ ウィンドウ内で
                </button>
              )}
            </>
          )}
          <datalist id={listId}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </datalist>
          {unknown && <span className="muted small">{isMotion ? '登録されていないモーションです' : 'このタグが付いたモーションは、ありません'}</span>}
          {hint}
        </div>
      )
    }
    case 'expression':
      return (
        <div className="pf">
          {label}
          <input id={id} type="text" list={listId} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
          <datalist id={listId}>
            {ctx.expressions.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          {hint}
        </div>
      )
    case 'preset': {
      const v = typeof value === 'string' ? value : ''
      return (
        <div className="pf">
          {label}
          {/* 別のモデルのセット名も書けるよう、候補つきの入力欄にする(選択肢はいま読み込んでいるモデルのもの) */}
          <input id={id} type="text" list={listId} value={v} onChange={(e) => onChange(e.target.value)} />
          <datalist id={listId}>
            {ctx.presets.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          {ctx.presets.length === 0 && <div className="pf-hint">読み込み中のモデルに、保存したセットはまだありません(表情・衣装パネルで「名前をつけて保存」)。</div>}
          {hint}
        </div>
      )
    }
    case 'overlayEffect': {
      const v = typeof value === 'string' ? value : ''
      return (
        <div className="pf">
          {label}
          <input id={id} type="text" list={listId} value={v} onChange={(e) => onChange(e.target.value)} />
          <datalist id={listId}>
            {ctx.overlayEffects.map((x) => (
              <option key={x.name} value={x.name}>
                {x.label}
              </option>
            ))}
          </datalist>
          {hint}
        </div>
      )
    }
    case 'string':
      return (
        <div className="pf">
          {label}
          <input id={id} type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
          {hint}
        </div>
      )
  }
}

/**
 * 入力しながら絞り込む欄(候補は <datalist>)。入力中の途中の文字では保存せず、
 * 候補と完全に一致したとき(候補の選択)、または、フォーカスを外したときに保存する(未登録の名前も、書けるように)
 */
function ComboInput({
  id,
  listId,
  value,
  placeholder,
  valid,
  onCommit
}: {
  id: string
  listId: string
  value: string
  placeholder: string
  valid: (text: string) => boolean
  onCommit: (text: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  // 外から値が変わったら(別のルールを選んだとき・検証で丸められたとき)、入力欄も追従する
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }
  return (
    <input
      id={id}
      type="text"
      list={listId}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        setDraft(e.target.value)
        if (valid(e.target.value)) onCommit(e.target.value)
      }}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && draft !== value) onCommit(draft)
      }}
    />
  )
}
