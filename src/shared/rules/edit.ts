import { findDef, type NodeDef, type NodeKind, TYPE_KEY } from './definitions'
import type { Rule, RuleNode, RuleSet } from './types'

// ルールのGUI編集用の、純粋な操作(RuleSet を変更せず、新しい RuleSet を返す)。Electron/React に依存しない。

const ID_BASE_RE = /[^A-Za-z0-9_-]+/g

/** 既存のidと被らない、新しいid(`base`、`base-2`、`base-3`…) */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const clean = (base.replace(ID_BASE_RE, '-').replace(/^-+|-+$/g, '') || 'rule').slice(0, 56)
  if (!used.has(clean)) return clean
  for (let n = 2; ; n++) {
    const id = `${clean}-${n}`
    if (!used.has(id)) return id
  }
}

const ids = (rs: RuleSet): string[] => rs.rules.map((r) => r.id)
const withRules = (rs: RuleSet, rules: Rule[]): RuleSet => ({ ...rs, rules })

export function toggleRule(rs: RuleSet, id: string, enabled: boolean): RuleSet {
  return withRules(rs, rs.rules.map((r) => (r.id === id ? { ...r, enabled } : r)))
}

/** ルールを上(-1)・下(+1)へ動かす。端なら何もしない */
export function moveRule(rs: RuleSet, id: string, delta: -1 | 1): RuleSet {
  const i = rs.rules.findIndex((r) => r.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= rs.rules.length) return rs
  const rules = [...rs.rules]
  ;[rules[i], rules[j]] = [rules[j], rules[i]]
  return withRules(rs, rules)
}

/** 複製(元のすぐ下に、新しいidで入る。複製は無効の状態ではなく、元と同じ有効/無効) */
export function duplicateRule(rs: RuleSet, id: string): { ruleSet: RuleSet; newId: string | null } {
  const i = rs.rules.findIndex((r) => r.id === id)
  if (i < 0) return { ruleSet: rs, newId: null }
  const newId = uniqueId(`${id}-copy`, ids(rs))
  const copy: Rule = structuredClone(rs.rules[i])
  copy.id = newId
  const rules = [...rs.rules]
  rules.splice(i + 1, 0, copy)
  return { ruleSet: withRules(rs, rules), newId }
}

export function deleteRule(rs: RuleSet, id: string): RuleSet {
  return withRules(rs, rs.rules.filter((r) => r.id !== id))
}

export function replaceRule(rs: RuleSet, id: string, rule: Rule): RuleSet {
  return withRules(rs, rs.rules.map((r) => (r.id === id ? rule : r)))
}

/** 定義の既定値(と必須項目の空の値)で、新しい node(トリガー・条件・アクション)を作る */
export function newNode(
  kind: NodeKind,
  type: string,
  ctx: { motions?: string[]; tags?: string[]; expressions?: string[]; presets?: string[] } = {}
): RuleNode {
  const def: NodeDef | undefined = findDef(kind, type)
  const node: RuleNode = { [TYPE_KEY[kind]]: type }
  if (!def) return node
  for (const p of def.params) {
    if (p.default !== undefined) node[p.name] = p.default
    else if (p.required) {
      if (p.kind === 'stringList') node[p.name] = ['']
      else if (p.kind === 'time') node[p.name] = '12:00'
      else if (p.kind === 'expression') node[p.name] = ctx.expressions?.[0] ?? 'happy'
      else if (p.kind === 'preset') node[p.name] = ctx.presets?.[0] ?? ''
      else if (p.kind === 'number') node[p.name] = p.min ?? 0
      else node[p.name] = ''
    }
  }
  // playMotion は、モーションかタグのどちらか1つが必要。登録済みの先頭を入れておく
  if (kind === 'action' && type === 'playMotion') {
    if (ctx.motions?.[0]) node.motion = ctx.motions[0]
    else if (ctx.tags?.[0]) node.tag = ctx.tags[0]
  }
  return node
}

/** 新しいルール(初期値つき)。idは重複しないものを付ける */
export function newRule(rs: RuleSet, ctx: Parameters<typeof newNode>[2] = {}): Rule {
  return {
    id: uniqueId('new-rule', ids(rs)),
    enabled: true,
    when: newNode('trigger', 'click') as Rule['when'],
    if: [],
    do: [newNode('action', 'say', ctx) as Rule['do'][number]]
  }
}

/// --- タグ(モーションのタグを指す playMotion の tag)---

/** タグを使っているルールのid(タグの削除・名前変更の前に、影響を知らせる用) */
export function rulesUsingTag(rs: RuleSet, tag: string): string[] {
  return rs.rules.filter((r) => r.do.some((a) => a.action === 'playMotion' && a.tag === tag)).map((r) => r.id)
}

/** モーションのタグの名前が変わったとき、ルールの `tag:` の参照も更新する */
export function renameTagInRuleSet(rs: RuleSet, from: string, to: string): RuleSet {
  if (from === to) return rs
  const rules = rs.rules.map((r) => ({ ...r, do: r.do.map((a) => (a.action === 'playMotion' && a.tag === from ? { ...a, tag: to } : a)) }))
  return { ...rs, rules }
}

/**
 * インポートしたルールを、いまのルールに追加する(共有されたルールの取り込み)。
 * idが被るルールは、別のidにする。
 */
export function mergeRuleSets(base: RuleSet, incoming: RuleSet): { ruleSet: RuleSet; renamed: Array<{ from: string; to: string }> } {
  const renamed: Array<{ from: string; to: string }> = []
  const taken = new Set(ids(base))
  const added: Rule[] = incoming.rules.map((r) => {
    if (!taken.has(r.id)) {
      taken.add(r.id)
      return r
    }
    const id = uniqueId(r.id, taken)
    taken.add(id)
    renamed.push({ from: r.id, to: id })
    return { ...r, id }
  })
  return { ruleSet: { ...base, rules: [...base.rules, ...added] }, renamed }
}

/** モーションを使っているルール(名前変更の前に、影響を知らせる用) */
export function motionReferences(rs: RuleSet, name: string): { rules: string[] } {
  return { rules: rs.rules.filter((r) => r.do.some((a) => a.action === 'playMotion' && a.motion === name)).map((r) => r.id) }
}

/** モーション名を変え、ルールの `motion:` の参照も一緒に更新する */
export function renameMotionInRuleSet(rs: RuleSet, from: string, to: string): RuleSet {
  if (from === to) return rs
  const rules = rs.rules.map((r) => ({ ...r, do: r.do.map((a) => (a.action === 'playMotion' && a.motion === from ? { ...a, motion: to } : a)) }))
  return { ...rs, rules }
}

// --- ルールの一括操作(数百件のルールを、まとめて扱う)---

/** 指定したルールを、まとめて有効/無効にする。変更が無ければ同じオブジェクト */
export function setEnabledMany(rs: RuleSet, targets: ReadonlySet<string>, enabled: boolean): RuleSet {
  if (!rs.rules.some((r) => targets.has(r.id) && r.enabled !== enabled)) return rs
  return withRules(rs, rs.rules.map((r) => (targets.has(r.id) && r.enabled !== enabled ? { ...r, enabled } : r)))
}

/** 指定したルールを、まとめて削除する */
export function deleteRules(rs: RuleSet, targets: ReadonlySet<string>): RuleSet {
  if (!rs.rules.some((r) => targets.has(r.id))) return rs
  return withRules(rs, rs.rules.filter((r) => !targets.has(r.id)))
}

const MAX_TAGS_PER_RULE = 20

/** 指定したルールに、タグをまとめて足す(重複なし。上限あり)。タグは検証済み(normalizeTag)のものを渡す */
export function addRuleTags(rs: RuleSet, targets: ReadonlySet<string>, tags: readonly string[]): RuleSet {
  if (tags.length === 0) return rs
  let changed = false
  const rules = rs.rules.map((r) => {
    if (!targets.has(r.id)) return r
    const merged = [...new Set([...(r.tags ?? []), ...tags])].slice(0, MAX_TAGS_PER_RULE)
    if (merged.length === (r.tags ?? []).length) return r
    changed = true
    return { ...r, tags: merged }
  })
  return changed ? withRules(rs, rules) : rs
}

/** 指定したルールから、タグをまとめて外す(空になったら、tags 自体を持たない) */
export function removeRuleTags(rs: RuleSet, targets: ReadonlySet<string>, tags: readonly string[]): RuleSet {
  const drop = new Set(tags)
  let changed = false
  const rules = rs.rules.map((r) => {
    if (!targets.has(r.id) || !r.tags) return r
    const rest = r.tags.filter((t) => !drop.has(t))
    if (rest.length === r.tags.length) return r
    changed = true
    const { tags: _old, ...others } = r
    void _old
    return rest.length > 0 ? { ...others, tags: rest } : others
  })
  return changed ? withRules(rs, rules) : rs
}

/** ルールのタグごとの件数(多い順、同数なら名前順) */
export function ruleTagCounts(rs: RuleSet): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>()
  for (const r of rs.rules) for (const t of r.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'))
}

export interface RuleFilter {
  /** 検索語(空白で区切った語の、すべてを含むもの。id・説明・タグが対象。大文字小文字・全角半角は問わない) */
  query: string
  /** 選んだタグ(すべてを持つもの) */
  tags: readonly string[]
  /** 有効/無効で絞る */
  enabled: 'all' | 'on' | 'off'
}

export const NO_RULE_FILTER: RuleFilter = { query: '', tags: [], enabled: 'all' }

const fold = (s: string): string => s.normalize('NFKC').toLowerCase()

/** ルールの絞り込み(元の順序を保つ)。動作の中身(モーション名・セリフ)も、検索の対象にする */
export function filterRules(rules: readonly Rule[], f: RuleFilter): Rule[] {
  const terms = fold(f.query).split(/\s+/).filter((t) => t !== '')
  if (terms.length === 0 && f.tags.length === 0 && f.enabled === 'all') return [...rules]
  return rules.filter((r) => {
    if (f.enabled === 'on' && !r.enabled) return false
    if (f.enabled === 'off' && r.enabled) return false
    for (const t of f.tags) if (!r.tags?.includes(t)) return false
    if (terms.length > 0) {
      const actions = r.do.map((a) => [a.motion, a.tag, a.text].flat().filter((x): x is string => typeof x === 'string').join(' ')).join(' ')
      const hay = fold(`${r.id} ${r.description ?? ''} ${(r.tags ?? []).join(' ')} ${actions}`)
      for (const t of terms) if (!hay.includes(t)) return false
    }
    return true
  })
}
