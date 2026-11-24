import type { Distribution, ModCategory, SlotKind } from './packs/manifest'
import type { RuleValue } from './rules/effective'

// 設定ウィンドウと main のやり取り(パック)。

export interface PackMotionInfo {
  /** 登録される名前(`<パックid>/<名前>`) */
  name: string
  source?: string
  license?: string
  redistributable?: boolean
  attribution?: string
}

/** ルールの調整できる値 1 つ(層 A。ADR 0005 §22) */
export interface RuleFieldInfo {
  /** ルールの、Mod の中での id(`<Mod の id>/` を除いたもの) */
  ruleId: string
  ruleDescription: string
  /** 場所(`when.afterSec` / `if.0.sec` / `do.1.text`) */
  path: string
  /** ノードの種類名(例: idle / say)と、日本語の名前 */
  nodeType: string
  nodeLabel: string
  label: string
  kind: 'number' | 'time' | 'boolean' | 'enum' | 'stringList'
  min?: number
  max?: number
  options?: Array<{ value: string; label: string }>
  hint?: string
  /** Mod が書いた値 */
  base: RuleValue
  /** 全キャラ共通の上書き(無ければ undefined) */
  value?: RuleValue
  /** キャラごとの上書き(キャラ id → 値) */
  charValues: Record<string, RuleValue>
}

export interface PackInfo {
  id: string
  name: string
  version: string
  description: string
  distribution: Distribution
  /** 区分(置き場所で決まる): official / community / individual */
  category: ModCategory
  /** 結びつく本体の機能(あれば。この Mod の ON/OFF が、その機能の ON/OFF) */
  feature?: string
  /** 検証に失敗したパック(読み込まれない)。理由は errors */
  valid: boolean
  errors: string[]
  enabled: boolean
  /** 使う公式の機能 Mod と、いま ON か(OFF のものがあれば、その機能を使う部分は動かない) */
  requires: Array<{ id: string; name: string; enabled: boolean }>
  /** 一覧窓(host.ui.list)を持つ Mod の、窓の状態。持たなければ null */
  uiWindow: { visible: boolean; follow: boolean } | null
  /** 会話の指示文の層(指示文を持たない Mod は null) */
  promptLayer: 'persona' | 'state' | null
  /** スクリプトを含む Mod の、権限(日本語)と、いま使えない理由(「開発者向け」が OFF など)。含まなければ null */
  script: {
    permissions: Array<{ text: string; danger: boolean }>
    blocked: string | null
    /** 外部ツールの起動(launcher)を宣言していれば、その名前。設定画面に「起動」ボタンを出す */
    launcher: { label: string } | null
    /** 利用者が入力する設定項目(secret は、値を返さず、設定済みかだけ) */
    settings: Array<{ name: string; label: string; kind: string; hint?: string; value: string; isSet: boolean; default?: string; options?: Array<{ value: string; label: string }> }>
  } | null
  /** この Mod が持つ小道具の id(`<Mod の id>/<id>`) */
  props: string[]
  /** 利用者が差し替えるスロットと、いまの値(空なら、その反応は動かない) */
  slots: Array<{
    id: string
    label: string
    kind: SlotKind
    /** kind: choice の選択肢 */
    options?: Array<{ value: string; label: string }>
    hint?: string
    /** Mod が書いた初期値 */
    default?: string
    /** kind: number の最小・最大・刻み・単位 */
    min?: number
    max?: number
    step?: number
    unit?: string
    /** 設定画面の見出し(同じ名前のものを、折りたたみにまとめる) */
    group?: string
    /** 全キャラ共通の値 */
    value: string
    /** キャラごとの値(キャラid → 値) */
    charValues: Record<string, string>
  }>
  /** ルールの調整できる値(「詳しい設定」。Mod の作者が何も書かなくても、利用者が上書きできる) */
  ruleFields: RuleFieldInfo[]
  motions: PackMotionInfo[]
  /** パックのルール(読み取り専用の一覧) */
  rules: Array<{ id: string; description: string; enabled: boolean }>
  /** 場所(表示用) */
  dir: string
}

export interface PacksView {
  packs: PackInfo[]
  /** 自作 Mod を置くフォルダ(individual) */
  individualDir: string
  /** 取り込んだ Mod を置くフォルダ(community) */
  communityDir: string
}

export interface PackActionResult {
  ok: boolean
  message: string
  view: PacksView
}
