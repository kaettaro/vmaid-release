// ルール定義のレジストリ(ADR 0003 / 0005)。機能 Mod が ON のものだけを「使える定義」として返す。
// 無効な Mod の種類・パラメータを使ったルールは「未解決」として保持され(中身は消えない)、エンジンは実行しない。
import { FEATURE_GROUPS, featureModName } from '../mods/features'
import { findDef, nodeDefs, TYPE_KEY, type NodeDef, type NodeKind, type ParamDef } from './definitions'
import type { Rule, RuleNode, RuleSet } from './types'

export interface RuleRegistry {
  /** 機能 Mod が ON か(標準の定義には使わない) */
  modEnabled(modId: string): boolean
  /** 画面のメニューに出せる種類(OFF の Mod の種類を除く) */
  defs(kind: NodeKind): NodeDef[]
  /** 種類の定義(OFF の Mod のものも返す。検証・往復のため。使えるかは `analyzeRuleSet` で調べる) */
  find(kind: NodeKind, type: string): NodeDef | undefined
  /** 画面のフォームに出せるパラメータ(OFF の Mod のものを除く) */
  params(def: NodeDef): ParamDef[]
}

/** スクリプト Mod が宣言した、ルールのノード(種類名は、すでに `<Mod の id>/<種類>`)。有効な Mod のものだけ渡す */
export interface RuleContribution {
  modId: string
  modName: string
  triggers: NodeDef[]
  actions: NodeDef[]
}

/**
 * 有効な機能 Mod の id から、レジストリを作る。省略すると、すべての機能 Mod が ON。
 * contributions は、有効なスクリプト Mod が宣言したノード(ルールの画面にも出る)
 */
export function createRegistry(enabledMods?: Iterable<string>, contributions: readonly RuleContribution[] = []): RuleRegistry {
  const enabled = enabledMods === undefined ? null : new Set(enabledMods)
  // まとまりの id(ゲームなど)は、メンバーのどれかが ON なら、ON とみなす
  const on = (modId: string | undefined): boolean => modId === undefined || enabled === null || enabled.has(modId) || (FEATURE_GROUPS[modId]?.some((m) => enabled.has(m)) ?? false)
  const contributed = (kind: NodeKind): NodeDef[] => (kind === 'trigger' ? contributions.flatMap((c) => c.triggers) : kind === 'action' ? contributions.flatMap((c) => c.actions) : [])
  return {
    modEnabled: (modId) => on(modId),
    defs: (kind) => [...nodeDefs(kind).filter((d) => on(d.modId)), ...contributed(kind)],
    find: (kind, type) => findDef(kind, type) ?? contributed(kind).find((d) => d.type === type),
    params: (def) => def.params.filter((p) => on(p.modId))
  }
}

/** 画面・IPC の ModsView(機能 Mod の ON/OFF)から、レジストリを作る */
export function registryFromView(view: { features: ReadonlyArray<{ id: string; enabled: boolean }>; contributions?: readonly RuleContribution[] }): RuleRegistry {
  return createRegistry(
    view.features.filter((f) => f.enabled).map((f) => f.id),
    view.contributions ?? []
  )
}

/** すべての機能 Mod が ON のレジストリ(引数を省略したときの既定。既存の動作と同じ) */
export const FULL_REGISTRY: RuleRegistry = createRegistry()

/** Mod が提供する種類名: `<modId>/<種類>`(例 `motion-gen-textvrma/generateMotion`)。名前空間なしの未知の種類は、打ち間違いとして扱う */
const NAMESPACED_RE = /^[a-z0-9][a-z0-9-]{2,40}\/[A-Za-z0-9_-]{1,64}$/
export const isNamespacedType = (type: string): boolean => NAMESPACED_RE.test(type)

export type NodeProblem = { path: string; kind: NodeKind; type: string } & (
  | { status: 'mod-disabled'; modId: string; modName: string; /** 原因のパラメータ(種類そのものが原因なら無し) */ param?: string }
  | { status: 'missing-extension'; modId: string; modName: string }
)

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

function analyzeNode(kind: NodeKind, node: RuleNode, path: string, registry: RuleRegistry, out: NodeProblem[]): void {
  const type = node[TYPE_KEY[kind]]
  if (typeof type !== 'string') return
  const def = registry.find(kind, type)
  if (!def) {
    // 名前空間つきの、レジストリにない種類 = 未導入の Mod のノード
    const modId = type.split('/')[0]
    out.push({ path, kind, type, status: 'missing-extension', modId, modName: featureModName(modId) })
    return
  }
  if (def.modId && !registry.modEnabled(def.modId)) {
    out.push({ path, kind, type, status: 'mod-disabled', modId: def.modId, modName: featureModName(def.modId) })
    return
  }
  for (const p of def.params) {
    if (!p.modId || registry.modEnabled(p.modId)) continue
    const v = node[p.name]
    // 既定値のままなら、その機能を使っているとはいえない(例: part: any)
    if (v !== undefined && !same(v, p.default)) {
      out.push({ path: `${path}.${p.name}`, kind, type, status: 'mod-disabled', modId: p.modId, modName: featureModName(p.modId), param: p.name })
    }
  }
}

/** ノード1つの、使えない理由(画面の注意書き用)。使えれば空 */
export function nodeProblems(kind: NodeKind, node: RuleNode, registry: RuleRegistry): NodeProblem[] {
  const out: NodeProblem[] = []
  analyzeNode(kind, node, '', registry, out)
  return out
}

/** ルールごとの、使えない(未解決の)ノードを調べる。問題のないルールは含まない。エンジン・lint・設定画面が共通で使う */
export function analyzeRuleSet(rs: RuleSet, registry: RuleRegistry): Map<string, NodeProblem[]> {
  const result = new Map<string, NodeProblem[]>()
  rs.rules.forEach((rule: Rule, i) => {
    const problems: NodeProblem[] = []
    analyzeNode('trigger', rule.when, `rules[${i}].when`, registry, problems)
    rule.if.forEach((c, j) => analyzeNode('condition', c, `rules[${i}].if[${j}]`, registry, problems))
    rule.do.forEach((a, j) => analyzeNode('action', a, `rules[${i}].do[${j}]`, registry, problems))
    if (problems.length > 0) result.set(rule.id, problems)
  })
  return result
}

/** 問題を、人が読む1文にする(例: 「Mod「親密度と気分」を ON にすると使えます」) */
export function describeProblem(p: NodeProblem): string {
  return p.status === 'missing-extension'
    ? `Mod「${p.modName}」が入っていないため、「${p.type}」は使えません`
    : `Mod「${p.modName}」を ON にすると使えます(「${p.param ?? p.type}」)`
}
