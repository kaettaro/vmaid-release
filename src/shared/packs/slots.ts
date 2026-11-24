// Mod のスロット(利用者が決める値)の解決。値の優先順位: キャラごとの値 → 全キャラ共通の値 → Mod が書いた初期値 → 空。
// Electron 非依存。レンダラー(ルールの `{{slot:…}}`)と main(指示文の `{{slot:…}}`)の両方で同じ規則を使う。

export type SlotValues = Record<string, string>

export interface SlotDef {
  id: string
  default?: string
}

/** 全キャラ共通の値に、Mod の初期値を補う */
export function withDefaults(defs: readonly SlotDef[], common: SlotValues | undefined): SlotValues {
  const out: SlotValues = {}
  for (const d of defs) out[d.id] = common?.[d.id] || d.default || ''
  return out
}

/** キャラごとの値で上書きする(空の値は、上書きしない) */
export function overrideForCharacter(base: SlotValues, perCharacter: SlotValues | undefined): SlotValues {
  if (!perCharacter) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(perCharacter)) if (v !== '' && k in out) out[k] = v
  return out
}

export function resolveSlots(defs: readonly SlotDef[], common: SlotValues | undefined, perCharacter: SlotValues | undefined): SlotValues {
  return overrideForCharacter(withDefaults(defs, common), perCharacter)
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
/** lines スロット(セリフの一覧)の、行数と、1 行の長さの上限 */
export const MAX_LINES = 30
export const MAX_LINE_LENGTH = 300

export interface SlotValueDef {
  kind: string
  min?: number
  max?: number
}

/**
 * スロットの値を、種類に合わせて、検査・整える(保存する前に)。空は、そのまま空(= 解除)。
 * 不正なら null(保存しない)。number は、範囲に丸める・time は HH:MM・boolean は true / false・lines は行ごとに整える
 */
export function normalizeSlotValue(def: SlotValueDef, raw: string): string | null {
  const v = raw.trim()
  if (v === '') return ''
  switch (def.kind) {
    case 'number': {
      const n = Number(v)
      if (!Number.isFinite(n)) return null
      return String(Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n)))
    }
    case 'time':
      return TIME_RE.test(v) ? v : null
    case 'boolean':
      return v === 'true' || v === 'false' ? v : null
    case 'lines': {
      const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '')
      if (lines.length === 0) return ''
      if (lines.length > MAX_LINES || lines.some((s) => s.length > MAX_LINE_LENGTH)) return null
      return lines.join('\n')
    }
    default:
      return v
  }
}
