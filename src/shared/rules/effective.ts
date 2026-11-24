// ルールの「実効の値」。Mod タブの設定(スロット)と、「詳しい設定(ルールの値)」の上書きを、ルールに差し込む。純粋ロジック。
//
// 2 つの層(ADR 0005 §22):
//  - 層 B(スロット): ルールの値を、ちょうど `{{slot:id}}` と書いておくと、Mod の設定(スロット)の値が入る。値は、パラメータの種類に合わせて型変換する
//  - 層 A(ルールの値の上書き): Mod の作者が何も書かなくても、ルールの number / time / boolean / enum / stringList の値を、
//    場所(`when.afterSec` / `if.0.sec` / `do.1.text`)をキーに、利用者が上書きできる。元のルールは、変えない
// 優先順位: スロット(`{{slot}}`)が決める値 → 上書き → ルールに書かれた値。

import { type NodeDef, type NodeKind, type ParamDef } from './definitions'
import { checkParam } from './schema'
import type { Rule, RuleNode, RuleSet } from './types'

/** 上書きの値(YAML・JSON で表せる、単純な値) */
export type RuleValue = number | string | boolean | string[]
/** 場所(`when.afterSec` など)→ 値 */
export type RuleValues = Record<string, RuleValue>

export type FindDef = (kind: NodeKind, type: string) => NodeDef | undefined

const SLOT_REF_RE = /^\{\{slot:([a-z0-9][a-z0-9-]{0,39})\}\}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const TYPE_KEY: Record<NodeKind, string> = { trigger: 'trigger', condition: 'condition', action: 'action' }

/** 値が、ちょうど `{{slot:id}}` なら、その id */
export const slotRefOf = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const m = SLOT_REF_RE.exec(v.trim())
  return m ? (m[1] ?? null) : null
}

/** 上書き・スロットの対象にできる種類(選択肢・文字の入力欄で、利用者が決めてよいもの) */
const TUNABLE = new Set(['number', 'time', 'boolean', 'enum', 'stringList'])
/** 「詳しい設定」(層 A)の一覧に出す種類。選択肢(enum)は、ルールの構造(左右・選び方など)なので、出さない(スロットでは、使える) */
const LISTED = new Set(['number', 'time', 'boolean', 'stringList'])
/** スロットの `{{slot}}` 展開が、別の仕組み(カンマ区切りの言葉)で行われるパラメータ */
const KEYWORD_PARAMS = new Set(['keywords'])

/** ルールの全ノードを、(種類・場所・ノード)で列挙する */
function nodesOf(rule: Rule): Array<{ kind: NodeKind; prefix: string; node: RuleNode }> {
  return [
    { kind: 'trigger', prefix: 'when', node: rule.when },
    ...rule.if.map((n, i) => ({ kind: 'condition' as const, prefix: `if.${i}`, node: n })),
    ...rule.do.map((n, i) => ({ kind: 'action' as const, prefix: `do.${i}`, node: n }))
  ]
}

export interface RuleField {
  /** 場所(`when.afterSec` / `if.0.sec` / `do.1.text`) */
  path: string
  kind: NodeKind
  /** ノードの種類(例: idle / say) */
  type: string
  param: ParamDef
  /** ルールに書かれている値 */
  value: unknown
}

/**
 * 利用者が調整できる値の一覧(層 A の対象)。number / time / boolean / stringList の値で、
 * `{{slot:…}}` が書かれているもの(スロットで調整する)・開いた列挙(触れ合いの部位)・キーワードの `{{…}}` を含むものは、除く
 */
export function listRuleFields(rule: Rule, find: FindDef): RuleField[] {
  const out: RuleField[] = []
  for (const { kind, prefix, node } of nodesOf(rule)) {
    const type = node[TYPE_KEY[kind]]
    if (typeof type !== 'string') continue
    const def = find(kind, type)
    if (!def) continue
    for (const p of def.params) {
      if (!LISTED.has(p.kind) || p.open || !(p.name in node)) continue
      const value = node[p.name]
      if (slotRefOf(value) !== null) continue
      if (Array.isArray(value) && value.some((x) => typeof x === 'string' && x.includes('{{'))) continue
      out.push({ path: `${prefix}.${p.name}`, kind, type, param: p, value })
    }
  }
  return out
}

/** スロットの値(文字列)を、パラメータの種類の値にする。変換できなければ undefined */
export function coerceSlotValue(p: ParamDef, raw: string): RuleValue | undefined {
  const t = raw.trim()
  switch (p.kind) {
    case 'number': {
      if (t === '') return undefined
      const n = Number(t)
      if (!Number.isFinite(n)) return undefined
      return Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n))
    }
    case 'boolean':
      if (/^(true|on|はい|オン|1)$/i.test(t)) return true
      if (/^(false|off|いいえ|オフ|0)$/i.test(t)) return false
      return undefined
    case 'time':
      return TIME_RE.test(t) ? t : undefined
    case 'enum':
      return (p.options ?? []).some((o) => o.value === t) ? t : undefined
    case 'stringList': {
      const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '')
      return lines.length > 0 ? lines : undefined
    }
    default:
      return t === '' ? undefined : t
  }
}

/** スロットが参照されているが、解決できないときの、パラメータの既定値(無ければ、最小限の値) */
function fallbackFor(p: ParamDef): unknown {
  if (p.default !== undefined) return p.default
  switch (p.kind) {
    case 'number':
      return p.min ?? 0
    case 'boolean':
      return false
    case 'time':
      return '12:00'
    case 'stringList':
      return ['…']
    default:
      return undefined
  }
}

/** `{{slot:id}}` を、スロットの値に差し込む(層 B)。slots が無ければ(マイルールなど)、パラメータの既定値にする */
export function resolveSlotRefs(rule: Rule, find: FindDef, slots: Record<string, string> | undefined): Rule {
  let changed = false
  const patch = (kind: NodeKind, node: RuleNode): RuleNode => {
    const type = node[TYPE_KEY[kind]]
    const def = typeof type === 'string' ? find(kind, type) : undefined
    if (!def) return node
    let out: RuleNode | null = null
    for (const p of def.params) {
      const v = node[p.name]
      if (v === undefined) continue
      if (p.kind === 'stringList' && Array.isArray(v)) {
        // 自分のルール(スロットが渡されない)の文は、これまでどおり、そのまま(`{{slot:…}}` は、展開しない)
        if (!slots || KEYWORD_PARAMS.has(p.name) || !v.some((x) => slotRefOf(x) !== null)) continue
        const list = v.flatMap((x) => {
          const id = slotRefOf(x)
          if (id === null) return [x as string]
          const lines = coerceSlotValue(p, slots[id] ?? '')
          return Array.isArray(lines) ? lines : []
        })
        out ??= { ...node }
        out[p.name] = list.length > 0 ? list : (fallbackFor(p) as string[])
        continue
      }
      const id = slotRefOf(v)
      if (id === null || !TUNABLE.has(p.kind)) continue
      const coerced = slots ? coerceSlotValue(p, slots[id] ?? '') : undefined
      out ??= { ...node }
      out[p.name] = coerced ?? fallbackFor(p)
    }
    if (out) changed = true
    return out ?? node
  }
  const when = patch('trigger', rule.when) as Rule['when']
  const ifs = rule.if.map((n) => patch('condition', n) as Rule['if'][number])
  const dos = rule.do.map((n) => patch('action', n) as Rule['do'][number])
  return changed ? { ...rule, when, if: ifs, do: dos } : rule
}

/** 層 A の上書きを、検査して差し込む。場所が無い・種類が合わない・範囲外などの値は、無視する(ルールの値のまま) */
export function applyRuleValues(rule: Rule, find: FindDef, values: RuleValues | undefined): Rule {
  if (!values || Object.keys(values).length === 0) return rule
  const fields = new Map(listRuleFields(rule, find).map((f) => [f.path, f]))
  const todo = Object.entries(values).filter(([path]) => fields.has(path))
  if (todo.length === 0) return rule
  const next = { when: { ...rule.when }, if: rule.if.map((n) => ({ ...n })), do: rule.do.map((n) => ({ ...n })) }
  let changed = false
  for (const [path, raw] of todo) {
    const f = fields.get(path)!
    const r = checkParam(f.param, raw)
    if (!r.ok) continue
    const parts = path.split('.')
    const holder = parts[0] === 'when' ? next.when : parts[0] === 'if' ? next.if[Number(parts[1])] : next.do[Number(parts[1])]
    if (!holder) continue
    holder[f.param.name] = r.value
    changed = true
  }
  return changed ? { ...rule, when: next.when, if: next.if, do: next.do } : rule
}

/** 実効のルール: 上書き(層 A)→ スロット(層 B)の順に差し込む(スロットが決める値は、上書きされない) */
export function effectiveRule(rule: Rule, find: FindDef, slots: Record<string, string> | undefined, values: RuleValues | undefined): Rule {
  return resolveSlotRefs(applyRuleValues(rule, find, values), find, slots)
}

/** ルールの値に、`{{slot:…}}` が(キーワード以外で)書かれているか。無ければ、スロットの解決は、いらない */
export function hasSlotRefs(rule: Rule): boolean {
  return nodesOf(rule).some(({ node }) => Object.entries(node).some(([k, v]) => !KEYWORD_PARAMS.has(k) && (slotRefOf(v) !== null || (Array.isArray(v) && v.some((x) => slotRefOf(x) !== null)))))
}

// ---------------------------------------------------------------- Mod の読み込み時の検査

/** スロットの種類 → 参照してよいパラメータの種類 */
const COMPATIBLE: Record<string, readonly string[]> = {
  number: ['number'],
  time: ['time'],
  boolean: ['boolean'],
  lines: ['stringList'],
  text: ['number', 'time', 'boolean', 'enum', 'stringList'],
  choice: ['number', 'time', 'boolean', 'enum']
}

/**
 * Mod のルールが参照する `{{slot:id}}`(number / time / boolean / stringList / enum のパラメータ)が、
 * 宣言したスロットで、種類が合っているかを調べる。問題の文を返す(無ければ空)
 */
export function checkSlotRefs(rs: RuleSet, slots: ReadonlyArray<{ id: string; kind: string }>, find: FindDef): string[] {
  const problems: string[] = []
  const byId = new Map(slots.map((s) => [s.id, s.kind]))
  for (const rule of rs.rules) {
    for (const { kind, prefix, node } of nodesOf(rule)) {
      const type = node[TYPE_KEY[kind]]
      const def = typeof type === 'string' ? find(kind, type) : undefined
      if (!def) continue
      for (const p of def.params) {
        if (!TUNABLE.has(p.kind) || KEYWORD_PARAMS.has(p.name)) continue
        const v = node[p.name]
        const ids = (Array.isArray(v) ? v : [v]).map(slotRefOf).filter((x): x is string => x !== null)
        for (const id of ids) {
          const sk = byId.get(id)
          if (sk === undefined) problems.push(`ルール「${rule.id}」の ${prefix}.${p.name} が、宣言していないスロット「${id}」を使っています`)
          else if (!(COMPATIBLE[sk] ?? []).includes(p.kind)) problems.push(`ルール「${rule.id}」の ${prefix}.${p.name}(${p.label})に、種類 ${sk} のスロット「${id}」は使えません`)
        }
      }
    }
  }
  return problems
}
