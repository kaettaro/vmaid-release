// 初回の移行(ADR 0005 §6): 以前から使っていた機能に対応する機能 Mod を ON にして、動作を変えない。
// 新規インストールは、DEFAULT_ON_FEATURES(追いかけ・モーションのタグ)だけ ON。あとは利用者が「Mod」タブで選ぶ。
import { analyzeRuleSet, createRegistry } from '../rules/registry'
import { DEFAULT_ON_FEATURES, FEATURE_GROUPS } from './features'
import type { RuleSet } from '../rules/types'

export interface MigrationInput {
  /** 設定ファイルが、すでにあった(= 初回起動ではない) */
  existingUser: boolean
  footLock: boolean
  ttsEnabled: boolean
  /** ユーザーのルールと、有効なパックのルールを合わせたもの */
  rules: RuleSet | null
  /** モーションに、利用者が付けたタグがある */
  hasMotionTags: boolean
}

/** ルールが使っている機能 Mod(すべての Mod が OFF のレジストリで調べて、使えないと判定されたものの提供元) */
export function featureModsUsedByRules(rs: RuleSet): Set<string> {
  const used = new Set<string>()
  for (const problems of analyzeRuleSet(rs, createRegistry([])).values()) {
    // まとまりの id(ゲームなど)は、最初のメンバー(以前からある Mod)に直す
    for (const p of problems) if (p.status === 'mod-disabled') used.add(FEATURE_GROUPS[p.modId]?.[0] ?? p.modId)
  }
  return used
}

export function migrateFeatureMods(input: MigrationInput): string[] {
  if (!input.existingUser) return [...DEFAULT_ON_FEATURES].sort()
  const on = new Set<string>(input.rules ? featureModsUsedByRules(input.rules) : [])
  if (input.footLock) on.add('foot-lock')
  if (input.ttsEnabled) on.add('tts')
  if (input.hasMotionTags) on.add('motion-tags')
  return [...on].sort()
}
