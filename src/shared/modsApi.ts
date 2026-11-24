// 設定ウィンドウ・キャラウィンドウと main のやり取り(Mod)。

import type { RuleValues } from './rules/effective'
import type { RuleContribution } from './rules/registry'

export interface FeatureModView {
  id: string
  name: string
  description: string
  enabled: boolean
}

export interface ModsView {
  /** 公式の機能 Mod(本体に同梱。トグルで ON/OFF) */
  features: FeatureModView[]
  /** 開発者向け: スクリプト Mod(Tier 2)の導入を許す */
  developerMode: boolean
  /** Mod のスロットの値(modId → スロットid → 値。Mod の初期値を補った、全キャラ共通の値)。ルールの `{{slot:名前}}` に使う */
  slots: Record<string, Record<string, string>>
  /** キャラごとのスロットの値(modId → キャラid → スロットid → 値)。使っているキャラの分が、`slots` に優先する */
  characterSlots: Record<string, Record<string, Record<string, string>>>
  /** ルールの値の上書き(modId → ルールのローカル id → 場所 → 値)。全キャラ共通 */
  ruleValues: Record<string, Record<string, RuleValues>>
  /** キャラごとの、ルールの値の上書き(modId → キャラid → ルールのローカル id → 場所 → 値)。使っているキャラの分が、共通に優先する */
  characterRuleValues: Record<string, Record<string, Record<string, RuleValues>>>
  /** 有効なスクリプト Mod が宣言した、ルールのノード(トリガー・アクション) */
  contributions: RuleContribution[]
}

/** 「Mod としてエクスポート」の、選択肢(自分のルールと、自分が登録したモーション) */
export interface ModExportInfo {
  rules: Array<{ id: string; description: string }>
  /** 自分が登録したモーションだけ(内蔵・他の Mod のものは含められない) */
  motions: Array<{ name: string; tags: string[] }>
  /** いまのキャラの指示文(初期値の提案用。そのまま含めるかは、利用者が決める) */
  characterPrompt: string
}

export interface ModExportRequest {
  id: string
  name: string
  version: string
  description: string
  ruleIds: string[]
  motionNames: string[]
  promptText: string
  promptLayer: 'persona' | 'state'
}

export interface ModExportResult {
  ok: boolean
  message: string
  warnings: string[]
}
