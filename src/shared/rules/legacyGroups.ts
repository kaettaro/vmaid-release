import { parseDocument } from 'yaml'
import { normalizeTag } from '../motionMeta'

// 旧形式の「モーショングループ」(motionGroups と、playMotion の group)を、モーションのタグへ変換する。
// グループ名がタグ名になり、メンバーのモーションに、そのタグが付く。ルールの `group: X` は `tag: X` になる。
// pick(random / first)は、そのまま残る(タグの場合、first は一覧の先頭=登録順)。

export interface LegacyGroups {
  /** タグ名 → そのタグを付けるモーション名 */
  assignments: Record<string, string[]>
  /** 変換した、グループの名前(タグ名にできなかったものは含まない) */
  tags: string[]
  /** タグにできなかったグループ(名前が不正)と、その理由 */
  skipped: string[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** motionGroups(名前 → モーション名のリスト)を、タグの割り当てにする。不正なものは、skipped に入れる */
export function groupsToAssignments(groups: unknown): LegacyGroups {
  const out: LegacyGroups = { assignments: {}, tags: [], skipped: [] }
  if (!isObject(groups)) return out
  for (const [name, list] of Object.entries(groups)) {
    const tag = normalizeTag(name)
    if (tag === null) {
      out.skipped.push(`グループ「${name}」: タグの名前として使えません`)
      continue
    }
    const members = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []
    out.assignments[tag] = [...new Set([...(out.assignments[tag] ?? []), ...members])]
    if (!out.tags.includes(tag)) out.tags.push(tag)
  }
  return out
}

/** パース済みのルールデータ(YAML/JSON をパースしたもの)に、旧形式が含まれているか */
export function hasLegacyGroups(raw: unknown): boolean {
  if (!isObject(raw)) return false
  if ('motionGroups' in raw) return true
  const rules = raw.rules
  if (!Array.isArray(rules)) return false
  return rules.some((r) => isObject(r) && Array.isArray(r.do) && r.do.some((a) => isObject(a) && typeof a.group === 'string'))
}

/**
 * パース済みのデータ(パックの pack.yaml など)の旧形式を、タグへ変換した、新しいデータを返す(元は変えない)。
 * motionGroups は取り除き、ルールの group は tag にする
 */
export function convertLegacyGroupsRaw(raw: unknown): { raw: unknown; legacy: LegacyGroups } {
  if (!isObject(raw) || !hasLegacyGroups(raw)) return { raw, legacy: { assignments: {}, tags: [], skipped: [] } }
  const legacy = groupsToAssignments(raw.motionGroups)
  const next: Record<string, unknown> = { ...raw }
  delete next.motionGroups
  if (Array.isArray(raw.rules)) {
    next.rules = raw.rules.map((r) => {
      if (!isObject(r) || !Array.isArray(r.do)) return r
      return {
        ...r,
        do: r.do.map((a) => {
          if (!isObject(a) || typeof a.group !== 'string') return a
          const { group, ...rest } = a
          // グループ名が、タグにできない名前なら、tag にはせず group のまま残す(検証でエラーになり、気づける)
          return normalizeTag(group) !== null ? { ...rest, tag: normalizeTag(group) } : a
        })
      }
    })
  }
  return { raw: next, legacy }
}

export interface LegacyYamlResult {
  /** 変換後の YAML(コメントはできるだけ残す) */
  text: string
  legacy: LegacyGroups
}

/** ルールの YAML 文字列の旧形式を、タグへ変換する。旧形式が無い・YAML として読めないなら null */
export function convertLegacyGroupsYaml(text: string): LegacyYamlResult | null {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) return null
  const js: unknown = doc.toJS()
  if (!hasLegacyGroups(js)) return null
  const legacy = groupsToAssignments((js as Record<string, unknown>).motionGroups)
  const rules = (js as Record<string, unknown>).rules
  if (Array.isArray(rules)) {
    rules.forEach((r, i) => {
      if (!isObject(r) || !Array.isArray(r.do)) return
      r.do.forEach((a, j) => {
        if (!isObject(a) || typeof a.group !== 'string') return
        const tag = normalizeTag(a.group)
        if (tag === null) return
        doc.setIn(['rules', i, 'do', j, 'tag'], tag)
        doc.deleteIn(['rules', i, 'do', j, 'group'])
      })
    })
  }
  doc.delete('motionGroups')
  return { text: doc.toString({ lineWidth: 0 }), legacy }
}
