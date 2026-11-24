import { z } from 'zod'
import { clampPitch, wrapDeg, type Orientation } from './character/yaw'

// 表情・衣装パネル(SPEC 3.4)の共通定義。Electron/Three.js 非依存の純粋ロジック。
// 項目はモデルから自動列挙し、値は key → number の単純な辞書で扱う(スライダー 0〜1 / トグル 0 or 1)。

export type AdjustGroup = 'expression' | 'morph' | 'visibility'

export const ADJUST_GROUPS: { id: AdjustGroup; label: string }[] = [
  { id: 'expression', label: '表情' },
  { id: 'morph', label: 'モーフ' },
  { id: 'visibility', label: '表示' }
]

export interface AdjustItem {
  /** 値の辞書のキー。`expr:名前` / `morph:メッシュ#モーフ` / `mesh:名前` / `mat:名前` */
  key: string
  group: AdjustGroup
  label: string
  /** 補足(例: 「表情 Joy でも使われています」) */
  hint?: string
  kind: 'slider' | 'toggle'
  /** スライダーの既定は 0、トグル(表示)の既定は 1(表示) */
  defaultValue: number
}

export interface AdjustSnapshot {
  modelHash: string
  modelName: string
  items: AdjustItem[]
  values: Record<string, number>
  /** このモデルで、名前をつけて保存した表情・衣装セット(プリセット)の名前 */
  presets: string[]
  /** 「標準」に決めたセットの名前(いつでも「標準に戻す」で、これに戻る)。決めていなければ null */
  defaultPreset?: string | null
  /** いま重ねて適用しているセット(ルールや「重ねる」で適用したもの。古い順)。無ければ省略 */
  layers?: LayerInfo[]
}

/** 重ねて適用しているセットの表示用の情報 */
export interface LayerInfo {
  id: string
  mode: LayerMode
}

/** 重ねる(変えた値だけを、基準値の上に足す)/ 置き換える(状態まるごと。セットに無い項目は既定値) */
export type LayerMode = 'overlay' | 'replace'

/** 基準値の上に重ねる、1つ分の差分。保存はしない(実行中だけ) */
export interface AdjustLayer {
  /** 同じ id のレイヤーは1つだけ(セット名)。もう一度適用すると、いちばん上に移る */
  id: string
  /** 適用した Mod(自分のルール・手動は null)。Mod が OFF になったら外すのに使う */
  source: string | null
  mode: LayerMode
  /** overlay は、セットで変えた項目の値だけ。replace は、すべての項目の値 */
  values: Record<string, number>
}

/** プリセット名の上限(文字数) */
export const MAX_PRESET_NAME = 40

/** プリセット名を整える。空・長すぎる・制御文字を含む場合は null */
export function normalizePresetName(raw: string): string | null {
  const name = raw.trim()
  // eslint-disable-next-line no-control-regex
  if (name === '' || [...name].length > MAX_PRESET_NAME || /[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

export interface AdjustApply {
  key: string
  value: number
}

// --- 表情名の日本語ラベル(VRM 1.0 のプリセット名。VRM 0.x は three-vrm が同名に変換する) ---
const EXPRESSION_LABELS: Record<string, string> = {
  neutral: '通常',
  happy: '喜び',
  angry: '怒り',
  sad: '悲しみ',
  relaxed: 'くつろぎ',
  surprised: '驚き',
  aa: '口「あ」',
  ih: '口「い」',
  ou: '口「う」',
  ee: '口「え」',
  oh: '口「お」',
  blink: 'まばたき',
  blinkLeft: 'まばたき(左)',
  blinkRight: 'まばたき(右)',
  lookUp: '視線 上',
  lookDown: '視線 下',
  lookLeft: '視線 左',
  lookRight: '視線 右'
}

export function expressionLabel(name: string): string {
  const ja = EXPRESSION_LABELS[name]
  return ja ? `${ja} (${name})` : name
}

export function defaultValues(items: AdjustItem[]): Record<string, number> {
  return Object.fromEntries(items.map((i) => [i.key, i.defaultValue]))
}

export function clampValue(item: AdjustItem, value: number): number {
  if (!Number.isFinite(value)) return item.defaultValue
  return item.kind === 'toggle' ? (value >= 0.5 ? 1 : 0) : Math.min(1, Math.max(0, value))
}

/** 既定値と違うものだけ(プロファイルに保存する内容) */
export function nonDefaultValues(items: AdjustItem[], values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of items) {
    const v = values[i.key]
    if (v !== undefined && v !== i.defaultValue) out[i.key] = v
  }
  return out
}

/** 保存済みプロファイルを、今のモデルに存在する項目だけに絞って検証する(別バージョンのモデル等で項目が減っても安全) */
export function sanitizeProfile(items: AdjustItem[], raw: unknown): Record<string, number> {
  const result = ProfileSchema.safeParse(raw)
  if (!result.success) return {}
  const parsed = result.data
  const byKey = new Map(items.map((i) => [i.key, i]))
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(parsed.values)) {
    const item = byKey.get(key)
    if (item) out[key] = clampValue(item, value)
  }
  return out
}

/** モデルごとの調整値ファイル(userData/model-profiles/<ハッシュ>.json)。基準値(values)と、名前つきのセット(presets) */
export const ProfileSchema = z.object({
  version: z.number().catch(1),
  values: z.record(z.string(), z.number()).catch({}),
  presets: z.record(z.string(), z.record(z.string(), z.number())).catch({}),
  /** 「標準」に決めたセットの名前(セットが無くなっていれば、読むときに無視する) */
  defaultPreset: z.string().nullable().catch(null),
  /** キャラの向き(度。0=正面、正=画面の右向き) */
  yaw: z.number().catch(0),
  /** キャラの上下の傾き(度。0=まっすぐ) */
  pitch: z.number().catch(0)
})

export type Presets = Record<string, Record<string, number>>

export function makeProfile(values: Record<string, number>, presets: Presets = {}, orientation: Orientation = { yaw: 0, pitch: 0 }, defaultPreset: string | null = null): z.infer<typeof ProfileSchema> {
  return { version: 1, values, presets, defaultPreset, yaw: orientation.yaw, pitch: orientation.pitch }
}

/** 保存済みプロファイルから、「標準」のセット名を取り出す(セットが存在しなければ null) */
export function readDefaultPreset(raw: unknown): string | null {
  const result = ProfileSchema.safeParse(raw)
  if (!result.success) return null
  const name = result.data.defaultPreset
  return name !== null && name in result.data.presets ? name : null
}

/** 保存済みプロファイルから、キャラの向き(度)を取り出す(壊れていれば 0。yaw は -180〜180、pitch は上限内に丸める) */
export function readOrientation(raw: unknown): Orientation {
  const result = ProfileSchema.safeParse(raw)
  return result.success ? { yaw: wrapDeg(result.data.yaw), pitch: clampPitch(result.data.pitch) } : { yaw: 0, pitch: 0 }
}

/** 保存済みプロファイルから、セットを取り出す(壊れていれば空) */
export function readPresets(raw: unknown): Presets {
  const result = ProfileSchema.safeParse(raw)
  return result.success ? result.data.presets : {}
}

/** 値の辞書を、今のモデルに存在する項目だけに絞って、範囲を丸める */
function sanitizeValues(items: AdjustItem[], values: Record<string, number>): Record<string, number> {
  const byKey = new Map(items.map((i) => [i.key, i]))
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(values)) {
    const item = byKey.get(key)
    if (item) out[key] = clampValue(item, value)
  }
  return out
}

/**
 * セットを適用したあとの、すべての項目の値。セットに書かれていない項目は既定値になる(セット = 状態まるごと)。
 * 別のバージョンのモデル等で、存在しない項目がセットに残っていても、無視する。
 */
export function presetToValues(items: AdjustItem[], preset: Record<string, number>): Record<string, number> {
  return { ...defaultValues(items), ...sanitizeValues(items, preset) }
}

/**
 * 基準値(手で調整した値)の上に、レイヤーを古い順に重ねた、すべての項目の値。
 * - overlay: スライダー(表情・モーフ)は、大きいほうを採る。トグル(表示)は、後から重ねたものが勝つ。
 * - replace: そのレイヤーの値で、すべての項目を置き換える(それまでに重ねたものは、見えなくなる)。
 * 存在しない項目は無視する。基準値・レイヤーは変えない。
 */
export function composeLayers(items: AdjustItem[], base: Record<string, number>, layers: AdjustLayer[]): Record<string, number> {
  const byKey = new Map(items.map((i) => [i.key, i]))
  let out: Record<string, number> = { ...defaultValues(items), ...sanitizeValues(items, base) }
  for (const layer of layers) {
    const values = sanitizeValues(items, layer.values)
    if (layer.mode === 'replace') {
      out = { ...defaultValues(items), ...values }
      continue
    }
    for (const [key, v] of Object.entries(values)) {
      const item = byKey.get(key)
      if (!item) continue
      out[key] = item.kind === 'toggle' ? v : Math.max(out[key] ?? item.defaultValue, v)
    }
  }
  return out
}

/** レイヤーを、同じ id があれば取り除いて、いちばん上に積む(新しい配列を返す) */
export function pushLayer(layers: AdjustLayer[], layer: AdjustLayer): AdjustLayer[] {
  return [...layers.filter((l) => l.id !== layer.id), layer]
}

/** レイヤーを外す。name を指定すればその名前、source を指定すればその Mod が重ねたもの、どちらも無ければすべて */
export function removeLayers(layers: AdjustLayer[], filter: { name?: string; source?: string }): AdjustLayer[] {
  if (filter.name === undefined && filter.source === undefined) return []
  return layers.filter((l) => !(filter.name !== undefined ? l.id === filter.name : l.source === filter.source))
}

/** 検索: 空白区切りの語がすべて、ラベルまたはキーに含まれる項目(大文字小文字を区別しない) */
export function filterItems(items: AdjustItem[], query: string): AdjustItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return items
  return items.filter((i) => {
    const text = `${i.label} ${i.key} ${i.hint ?? ''}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

/**
 * 表情の最終値を決める。優先順位: 一時上書き(ルールの setExpression) > 基準値と自動値の合成。
 * 自動値(まばたき・口パク)は「基準値に上乗せ」ではなく大きいほうを採る。
 * これで、ユーザーが基準を動かしても自動まばたきが壊れず、基準で目を閉じていれば開かない。
 */
export function composeExpression(base: number, override: number | undefined, auto: number | undefined): number {
  if (override !== undefined) return override
  return auto === undefined ? base : Math.max(base, auto)
}

/**
 * モーション(VRMA の表情トラック)が値を出している表情の合成。ルールの上書きがあれば、それが優先。
 * なければ、基準値・自動値(composeExpression の結果)と、モーションの値の大きいほうを採る
 * (MMD のモーションの、まばたき・口・表情が、自動まばたきに潰されないように)。
 */
export function composeWithMotion(composed: number, override: number | undefined, motion: number): number {
  return override !== undefined ? composed : Math.max(composed, motion)
}
