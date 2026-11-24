import type { RuleRegistry } from '@shared/rules/registry'
import { newNode } from '@shared/rules/edit'
import { groupDefs } from '@shared/rules/groups'
import { checkedCharacters, toggleRuleCharacter } from '@shared/rules/characters'
import type { Rule, RuleIssue } from '@shared/rules/types'
import { NodeEditor, nodeCtxOf } from './NodeEditor'
import type { FormContext } from './ParamField'
import { useState } from 'react'
import { parseTagInput } from '@shared/motionMeta'

interface Props {
  rule: Rule
  ctx: FormContext
  /** このルールに関する、検証エラー・警告 */
  issues: RuleIssue[]
  warnings: RuleIssue[]
  onChange: (rule: Rule) => void
}

const move = <T,>(list: T[], i: number, delta: -1 | 1): T[] => {
  const j = i + delta
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** 1つのルールの編集フォーム。いつ(トリガー)→もし(条件)→する(アクション) の3段を、定義から自動生成する */
export function RuleEditor({ rule, ctx, issues, warnings, onChange }: Props): React.JSX.Element {
  const nodeCtx = nodeCtxOf(ctx)
  const allCharacterIds = ctx.characters.map((c) => c.id)
  const checkedIds = checkedCharacters(rule.characters, allCharacterIds)
  const toggleCharacter = (id: string, on: boolean): void => {
    onChange({ ...rule, characters: toggleRuleCharacter(rule.characters, allCharacterIds, id, on) })
  }
  return (
    <div className="rule-editor">
      <div className="pf">
        <label className="pf-label" htmlFor="rule-id">
          ルールのid
        </label>
        <input id="rule-id" type="text" value={rule.id} onChange={(e) => onChange({ ...rule, id: e.target.value })} />
        <div className="pf-hint">英数字・ハイフン・アンダースコア(例: idle-dance)。ほかのルールと重ならないようにします。</div>
      </div>
      <div className="pf">
        <label className="pf-label" htmlFor="rule-desc">
          説明(メモ)
        </label>
        <input id="rule-desc" type="text" value={rule.description ?? ''} onChange={(e) => onChange({ ...rule, description: e.target.value || undefined })} />
      </div>

      {ctx.registry.modEnabled('motion-tags') && (
      <div className="pf">
        <label className="pf-label" htmlFor="rule-tags">
          タグ(整理用)
        </label>
        <RuleTagsInput value={rule.tags ?? []} onCommit={(tags) => onChange({ ...rule, tags: tags.length > 0 ? tags : undefined })} />
        <div className="pf-hint">ルール一覧の絞り込み・まとめての操作に使います(動作には影響しません)。カンマ・空白で区切ります。</div>
      </div>
      )}

      {ctx.characters.length > 1 && (
        <div className="pf">
          <span className="pf-label">対象のキャラ</span>
          <div className="char-checks">
            <button type="button" className="small" onClick={() => onChange({ ...rule, characters: undefined })} disabled={!rule.characters || rule.characters.length === 0}>
              全選択
            </button>
            {ctx.characters.map((c) => (
              <label key={c.id} className="check-line">
                <input type="checkbox" checked={checkedIds.includes(c.id)} onChange={(e) => toggleCharacter(c.id, e.target.checked)} />
                {c.name}
              </label>
            ))}
          </div>
          <div className="pf-hint">
            {!rule.characters || rule.characters.length === 0 ? 'すべてのキャラで動きます。' : '選んだキャラのときだけ動きます。(全員を選ぶと、後から増えたキャラでも動きます)'}
          </div>
        </div>
      )}

      <h3>いつ</h3>
      <NodeEditor kind="trigger" node={rule.when} ctx={ctx} onChange={(n) => onChange({ ...rule, when: n as Rule['when'] })} />

      <h3>もし(すべて満たすとき)</h3>
      {rule.if.length === 0 && <p className="muted small">条件なし(いつも実行します)</p>}
      {rule.if.map((c, i) => (
        <NodeEditor
          key={i}
          kind="condition"
          node={c}
          ctx={ctx}
          onChange={(n) => onChange({ ...rule, if: rule.if.map((x, j) => (j === i ? (n as Rule['if'][number]) : x)) })}
          onRemove={() => onChange({ ...rule, if: rule.if.filter((_, j) => j !== i) })}
          onMove={(d) => onChange({ ...rule, if: move(rule.if, i, d) })}
        />
      ))}
      <AddMenu registry={ctx.registry} label="条件を追加" kind="condition" onAdd={(type) => onChange({ ...rule, if: [...rule.if, newNode('condition', type) as Rule['if'][number]] })} />

      <h3>する(上から順に実行)</h3>
      {rule.do.map((a, i) => (
        <NodeEditor
          key={i}
          kind="action"
          node={a}
          ctx={ctx}
          onChange={(n) => onChange({ ...rule, do: rule.do.map((x, j) => (j === i ? (n as Rule['do'][number]) : x)) })}
          onRemove={rule.do.length > 1 ? () => onChange({ ...rule, do: rule.do.filter((_, j) => j !== i) }) : undefined}
          onMove={(d) => onChange({ ...rule, do: move(rule.do, i, d) })}
        />
      ))}
      <AddMenu registry={ctx.registry} label="アクションを追加" kind="action" onAdd={(type) => onChange({ ...rule, do: [...rule.do, newNode('action', type, nodeCtx) as Rule['do'][number]] })} />

      {issues.length > 0 && (
        <div className="notice error" role="alert">
          <strong>このルールは、まだ保存できません</strong>
          {issues.map((i, k) => (
            <div key={k}>{i.message}</div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="notice warn">
          {warnings.map((w, k) => (
            <div key={k}>{w.message}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function AddMenu({ registry, label, kind, onAdd }: { registry: RuleRegistry; label: string; kind: 'condition' | 'action'; onAdd: (type: string) => void }): React.JSX.Element {
  return (
    <select
      className="add-menu"
      value=""
      aria-label={label}
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value)
      }}
    >
      <option value="">＋ {label}…</option>
      {groupDefs(registry.defs(kind)).map((g) => (
        <optgroup key={g.group.id} label={g.group.label}>
          {g.defs.map((d) => (
            <option key={d.type} value={d.type}>
              {d.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/** ルールのタグの入力欄。入力中は保存せず、フォーカスを外す・Enter で保存する(カンマ・空白で区切る) */
function RuleTagsInput({ value, onCommit }: { value: string[]; onCommit: (tags: string[]) => void }): React.JSX.Element {
  const text = value.join(', ')
  const [draft, setDraft] = useState(text)
  const [seen, setSeen] = useState(text)
  // 別のルールを選んだとき・外から値が変わったとき、入力欄も追従する
  if (text !== seen) {
    setSeen(text)
    setDraft(text)
  }
  const commit = (): void => {
    const tags = parseTagInput(draft)
    if (tags.join(', ') !== text) onCommit(tags)
    setDraft(tags.join(', '))
  }
  return (
    <input
      id="rule-tags"
      type="text"
      value={draft}
      placeholder="例: あいさつ, 朝"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
      }}
    />
  )
}
