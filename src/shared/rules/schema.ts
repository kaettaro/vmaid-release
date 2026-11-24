import { normalizeTag } from '../motionMeta'
import { findDef, nodeDefs, TYPE_KEY, type NodeDef, type NodeKind, type ParamDef } from './definitions'
import { isNamespacedType } from './registry'
import { hasTemplate } from './template'

/** 値が、ちょうど `{{slot:id}}`(Mod の設定の値を、実行するときに差し込む)か */
const isSlotRef = (v: unknown): boolean => typeof v === 'string' && /^\{\{slot:[a-z0-9][a-z0-9-]{0,39}\}\}$/.test(v.trim())
import type { Rule, RuleIssue, RuleNode, RuleSet } from './types'

// ルールの検証と正規化。定義レジストリ(definitions.ts)に従って、パラメータの型・範囲を確認し、既定値を補う。
// エラーは最初の1件で止めず、できるだけまとめて返す(YAMLを直す手間を減らす)。

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
/** 候補が開いている列挙(open)に書ける id の形 */
const OPEN_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
/** 1つのルールに付けられるタグの数 */
const MAX_RULE_TAGS = 20

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 未導入の Mod のノードとして保持する中身の上限(悪意あるYAMLの肥大化を避ける) */
const MAX_PRESERVED_DEPTH = 6
const MAX_PRESERVED_BYTES = 20 * 1024

function withinDepth(v: unknown, depth: number): boolean {
  if (depth > MAX_PRESERVED_DEPTH) return false
  if (Array.isArray(v)) return v.every((x) => withinDepth(x, depth + 1))
  if (isObject(v)) return Object.values(v).every((x) => withinDepth(x, depth + 1))
  return true
}

/** パラメータ1つの検証。成功すれば正規化した値、失敗すればエラー文 */
export function checkParam(def: ParamDef, value: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const fail = (message: string): { ok: false; message: string } => ({ ok: false, message: `${def.label}(${def.name}): ${message}` })
  switch (def.kind) {
    case 'number': {
      // Mod のルールの {{slot:id}} は、実行するときに展開する(いまは、形だけ見る)
      if (isSlotRef(value) || (def.template && typeof value === 'string' && hasTemplate(value))) return { ok: true, value }
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail('数値で指定してください')
      if (def.min !== undefined && value < def.min) return fail(`${def.min} 以上にしてください`)
      if (def.max !== undefined && value > def.max) return fail(`${def.max} 以下にしてください`)
      return { ok: true, value }
    }
    case 'boolean':
      return typeof value === 'boolean' || isSlotRef(value) ? { ok: true, value } : fail('true か false で指定してください')
    case 'time':
      return (typeof value === 'string' && TIME_RE.test(value)) || isSlotRef(value) ? { ok: true, value } : fail('HH:MM の形式で指定してください(例: 12:00)')
    case 'enum': {
      const allowed = (def.options ?? []).map((o) => o.value)
      // 候補が開いている列挙(触れ合いの部位): Mod が宣言した id も書ける(その部位が無いときは、ただ反応しない)
      if (def.open && typeof value === 'string' && OPEN_ID_RE.test(value)) return { ok: true, value }
      // Mod のルールの {{slot:id}} は、実行するときに展開する(いまは、形だけ見る)
      if (isSlotRef(value) || (def.template && typeof value === 'string' && hasTemplate(value))) return { ok: true, value }
      return typeof value === 'string' && allowed.includes(value) ? { ok: true, value } : fail(`次のいずれかを指定してください: ${allowed.join(' / ')}`)
    }
    case 'stringList': {
      // 1つだけなら文字列でも書ける(`text: こんにちは`)
      const list = typeof value === 'string' ? [value] : value
      if (!Array.isArray(list) || list.length === 0 || !list.every((x) => typeof x === 'string' && x.trim() !== '')) {
        return fail('空でない文字列(または文字列のリスト)で指定してください')
      }
      return { ok: true, value: list.map((x: string) => x.trim()) }
    }
    case 'motionTag': {
      const tag = typeof value === 'string' ? normalizeTag(value) : null
      return tag !== null ? { ok: true, value: tag } : fail('タグは、1〜30文字で、カンマ・改行を含まない文字列で指定してください')
    }
    case 'string':
    case 'motion':
    case 'expression':
    case 'preset':
    case 'overlayEffect':
      // 任意の文字列項目(必須でない string)は、空でもよい(「指定しない」)
      if (def.kind === 'string' && !def.required && value === '') return { ok: true, value: '' }
      return typeof value === 'string' && value.trim() !== '' ? { ok: true, value: value.trim() } : fail('空でない文字列で指定してください')
  }
}

function validateNode(kind: NodeKind, raw: unknown, path: string, issues: RuleIssue[]): RuleNode | null {
  if (!isObject(raw)) {
    issues.push({ path, message: '設定の形式が正しくありません(`キー: 値` の形で書きます)' })
    return null
  }
  const key = TYPE_KEY[kind]
  const type = raw[key]
  if (typeof type !== 'string') {
    issues.push({ path: `${path}.${key}`, message: `「${key}」で種類を指定してください(例: ${nodeDefs(kind).map((d) => d.type).join(' / ')})` })
    return null
  }
  const def: NodeDef | undefined = findDef(kind, type)
  if (!def && isNamespacedType(type)) {
    // 未導入の Mod のノード(`<modId>/<種類>`): 中身をそのまま保持する(往復で失わない)。実行はされない(analyzeRuleSet)
    if (!withinDepth(raw, 0) || JSON.stringify(raw).length > MAX_PRESERVED_BYTES) {
      issues.push({ path, message: `「${type}」の設定が大きすぎます(深さ ${MAX_PRESERVED_DEPTH} まで、${MAX_PRESERVED_BYTES / 1024}KB まで)` })
      return null
    }
    return structuredClone(raw)
  }
  if (!def) {
    issues.push({ path: `${path}.${key}`, message: `「${type}」という種類はありません。使えるもの: ${nodeDefs(kind).map((d) => d.type).join(' / ')}` })
    return null
  }
  const out: RuleNode = { [key]: type }
  let ok = true
  const known = new Set(def.params.map((p) => p.name))
  for (const k of Object.keys(raw)) {
    if (k !== key && !known.has(k)) {
      // 打ち間違いに気づけるよう、未知のキーは警告ではなくエラーにする
      const hint = type === 'playMotion' && k === 'group' ? '(モーショングループは廃止されました。グループは、モーションのタグに変わっています。`tag: タグ名` で指定してください)' : ''
      issues.push({ path: `${path}.${k}`, message: `「${k}」は「${type}」で使えない項目です。使える項目: ${[...known].join(', ') || '(なし)'}${hint}` })
      ok = false
    }
  }
  for (const p of def.params) {
    const v = raw[p.name]
    if (v === undefined || v === null) {
      if (p.required) {
        issues.push({ path: `${path}.${p.name}`, message: `${p.label}(${p.name}) は必須です` })
        ok = false
      } else if (p.default !== undefined) out[p.name] = p.default
      continue
    }
    const r = checkParam(p, v)
    if (r.ok) out[p.name] = r.value
    else {
      issues.push({ path: `${path}.${p.name}`, message: r.message })
      ok = false
    }
  }
  // playMotion は、モーションかタグのどちらか1つが必要
  if (kind === 'action' && type === 'playMotion') {
    const hasMotion = out.motion !== undefined
    const hasTag = out.tag !== undefined
    if (hasMotion === hasTag) {
      issues.push({ path, message: 'playMotion には、motion(モーション)か tag(タグ)のどちらか1つだけを指定してください' })
      ok = false
    }
  }
  return ok ? out : null
}

function validateRule(raw: unknown, index: number, seenIds: Set<string>, issues: RuleIssue[]): Rule | null {
  const path = `rules[${index}]`
  if (!isObject(raw)) {
    issues.push({ path, message: 'ルールの形式が正しくありません' })
    return null
  }
  let ok = true
  const id = raw.id
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    issues.push({ path: `${path}.id`, message: 'id は英数字・ハイフン・アンダースコアで、64文字以内にしてください(例: idle-dance)' })
    ok = false
  } else if (seenIds.has(id)) {
    issues.push({ path: `${path}.id`, message: `id「${id}」が重複しています` })
    ok = false
  } else seenIds.add(id)

  const enabled = raw.enabled === undefined ? true : raw.enabled
  if (typeof enabled !== 'boolean') {
    issues.push({ path: `${path}.enabled`, message: 'enabled は true か false で指定してください' })
    ok = false
  }
  for (const k of Object.keys(raw)) {
    if (!['id', 'enabled', 'description', 'characters', 'tags', 'when', 'if', 'do'].includes(k)) {
      issues.push({ path: `${path}.${k}`, message: `「${k}」は使えない項目です(使える項目: id, enabled, description, characters, tags, when, if, do)` })
      ok = false
    }
  }
  let characters: string[] | undefined
  if (raw.characters !== undefined) {
    if (!Array.isArray(raw.characters) || raw.characters.some((c) => typeof c !== 'string' || c === '')) {
      issues.push({ path: `${path}.characters`, message: 'characters は、キャラのidのリストで書きます(例: [default, c2])。省略すると、すべてのキャラで動きます' })
      ok = false
    } else if (raw.characters.length > 0) {
      characters = raw.characters as string[]
    }
  }
  const when = validateNode('trigger', raw.when, `${path}.when`, issues)
  if (!when) ok = false

  const conds: Rule['if'] = []
  const rawIf = raw.if === undefined ? [] : raw.if
  if (!Array.isArray(rawIf)) {
    issues.push({ path: `${path}.if`, message: 'if は条件のリストで書きます(`- condition: probability` の形)' })
    ok = false
  } else {
    rawIf.forEach((c, i) => {
      const n = validateNode('condition', c, `${path}.if[${i}]`, issues)
      if (n) conds.push(n as Rule['if'][number])
      else ok = false
    })
  }

  const actions: Rule['do'] = []
  if (!Array.isArray(raw.do) || raw.do.length === 0) {
    issues.push({ path: `${path}.do`, message: 'do に、実行するアクションを1つ以上書いてください' })
    ok = false
  } else {
    raw.do.forEach((a, i) => {
      const n = validateNode('action', a, `${path}.do[${i}]`, issues)
      if (n) actions.push(n as Rule['do'][number])
      else ok = false
    })
  }
  if (!ok || !when) return null
  const rule: Rule = { id: id as string, enabled: enabled as boolean, when: when as Rule['when'], if: conds, do: actions }
  if (typeof raw.description === 'string') rule.description = raw.description
  if (characters) rule.characters = characters
  if (raw.tags !== undefined) {
    const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => (typeof t === 'string' ? normalizeTag(t) : null)) : null
    if (tags === null || tags.some((t) => t === null) || tags.length > MAX_RULE_TAGS) {
      issues.push({ path: `${path}.tags`, message: `tags は、タグ(1〜30文字)のリストで書きます(最大 ${MAX_RULE_TAGS} 個。例: [あいさつ, 朝])` })
      return null
    }
    if (tags.length > 0) rule.tags = [...new Set(tags as string[])]
  }
  return rule
}

export interface ParseResult {
  ruleSet: RuleSet | null
  issues: RuleIssue[]
}

/** 読み込んだデータ(YAML/JSONをパースしたもの)を検証して、RuleSet にする。1件でも問題があれば ruleSet は null */
export function parseRuleSet(raw: unknown): ParseResult {
  const issues: RuleIssue[] = []
  if (!isObject(raw)) return { ruleSet: null, issues: [{ path: '', message: 'ルールファイルの形式が正しくありません(最上位は `version:` `rules:` を持つ形です)' }] }
  for (const k of Object.keys(raw)) {
    if (k === 'motionGroups') {
      issues.push({ path: k, message: 'motionGroups(モーショングループ)は廃止されました。グループは、モーションのタグに変わっています(起動時・取り込み時に、自動で変換します)' })
    } else if (!['version', 'rules'].includes(k)) issues.push({ path: k, message: `「${k}」は使えない項目です(使える項目: version, rules)` })
  }
  if (raw.version !== 1) issues.push({ path: 'version', message: 'version は 1 を指定してください' })

  const rules: Rule[] = []
  if (!Array.isArray(raw.rules)) issues.push({ path: 'rules', message: 'rules はルールのリストで書きます' })
  else {
    const seen = new Set<string>()
    raw.rules.forEach((r, i) => {
      const rule = validateRule(r, i, seen, issues)
      if (rule) rules.push(rule)
    })
  }
  if (issues.length > 0) return { ruleSet: null, issues }
  return { ruleSet: { version: 1, rules }, issues }
}
