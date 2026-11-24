import { TYPE_KEY, type NodeKind } from '@shared/rules/definitions'
import { newNode } from '@shared/rules/edit'
import { describeProblem, nodeProblems } from '@shared/rules/registry'
import { groupDefs, ownerLabel } from '@shared/rules/groups'
import type { RuleNode } from '@shared/rules/types'
import { ParamField, type FormContext } from './ParamField'

interface Props {
  kind: NodeKind
  node: RuleNode
  ctx: FormContext
  onChange: (node: RuleNode) => void
  onRemove?: () => void
  onMove?: (delta: -1 | 1) => void
}

/** 新しいノードを作るときの選択肢。OFF の機能 Mod(モーションのタグ)のものは、既定で入れない */
export function nodeCtxOf(ctx: FormContext): { motions: string[]; tags: string[]; expressions: string[]; presets: string[] } {
  return { motions: ctx.motions, tags: ctx.registry.modEnabled('motion-tags') ? ctx.tags.map((t) => t.tag) : [], expressions: ctx.expressions, presets: ctx.presets }
}

/** トリガー・条件・アクションの1つ分。種類の選択と、その種類のパラメータ欄を、定義から自動生成する */
export function NodeEditor({ kind, node, ctx, onChange, onRemove, onMove }: Props): React.JSX.Element {
  const type = String(node[TYPE_KEY[kind]] ?? '')
  const def = ctx.registry.find(kind, type)
  // OFF の機能 Mod の種類・パラメータを使っているときは、中身を見せたうえで、ON にすると使えることを知らせる(中身は保持される)
  const problems = nodeProblems(kind, node, ctx.registry)
  const shownParams = def ? def.params.filter((p) => ctx.registry.modEnabled(p.modId ?? '') || !p.modId || (node[p.name] !== undefined && node[p.name] !== p.default)) : []
  const choices = ctx.registry.defs(kind)

  const setParam = (name: string, value: unknown): void => {
    const next: RuleNode = { ...node }
    if (value === undefined) delete next[name]
    else next[name] = value
    // 同時には指定できない相手(例: motion と tag)は、片方を選んだら空にする
    const excl = def?.params.find((p) => p.name === name)?.exclusiveWith
    if (excl && value !== undefined) delete next[excl]
    onChange(next)
  }

  return (
    <div className="node">
      <div className="node-head">
        <select
          value={type}
          aria-label="種類"
          onChange={(e) => onChange(newNode(kind, e.target.value, nodeCtxOf(ctx)))}
        >
          {!def && <option value={type}>{type}(未導入の Mod の種類)</option>}
          {def && !choices.includes(def) && <option value={type}>{def.label}(Mod が OFF)</option>}
          {groupDefs(choices).map((g) => (
            <optgroup key={g.group.id} label={g.group.label}>
              {g.defs.map((d) => (
                <option key={d.type} value={d.type}>
                  {d.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {def && ownerLabel(def) && (
          <span className="badge" title="この種類を足している Mod">
            {ownerLabel(def)}
          </span>
        )}
        <span className="node-tools">
          {onMove && (
            <>
              <button className="icon" onClick={() => onMove(-1)} aria-label="上へ" title="上へ">
                ↑
              </button>
              <button className="icon" onClick={() => onMove(1)} aria-label="下へ" title="下へ">
                ↓
              </button>
            </>
          )}
          {onRemove && (
            <button className="icon" onClick={onRemove} aria-label="削除" title="削除">
              ✕
            </button>
          )}
        </span>
      </div>
      {problems.length > 0 && <div className="notice warn">{[...new Set(problems.map(describeProblem))].join(' / ')}。中身は保存されたままで、ON にすると動きます</div>}
      {def?.description && <div className="pf-hint">{def.description}</div>}
      {shownParams.map((p) => (
        <ParamField key={p.name} def={p} value={node[p.name]} ctx={ctx} onChange={(v) => setParam(p.name, v)} />
      ))}
    </div>
  )
}
