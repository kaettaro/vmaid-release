import { describe, expect, it } from 'vitest'
import { convertLegacyGroupsRaw, convertLegacyGroupsYaml, groupsToAssignments, hasLegacyGroups } from './legacyGroups'
import { formatIssue, parseRuleSetYaml } from './yaml'

const LEGACY = `# 自分のルール(コメントは残る)
version: 1

# モーションをまとめるグループ
motionGroups:
  reaction: [wave, nod]
  dance: [dance1, dance2, 手振り]

rules:
  - id: click-react
    when: { trigger: click }
    do:
      - { action: playMotion, group: reaction, pick: random }
      - { action: say, text: やあ }
  - id: idle-dance
    when: { trigger: idle, afterSec: 300 }
    do:
      - { action: playMotion, group: dance, pick: first, durationSec: 5 }
      - { action: playMotion, motion: wave }
`

describe('hasLegacyGroups', () => {
  it('motionGroups か、playMotion の group があれば true', () => {
    expect(hasLegacyGroups({ version: 1, motionGroups: {}, rules: [] })).toBe(true)
    expect(hasLegacyGroups({ version: 1, rules: [{ do: [{ action: 'playMotion', group: 'g' }] }] })).toBe(true)
    expect(hasLegacyGroups({ version: 1, rules: [{ do: [{ action: 'playMotion', tag: 'g' }] }] })).toBe(false)
    expect(hasLegacyGroups({ version: 1, rules: [] })).toBe(false)
    for (const bad of [null, 3, 'x', [], { rules: 'x' }]) expect(hasLegacyGroups(bad)).toBe(false)
  })
})

describe('groupsToAssignments', () => {
  it('グループ名がタグ名、メンバーがモーション名。不正な名前のグループは skipped に入る', () => {
    const r = groupsToAssignments({ reaction: ['wave', ' nod '], 'a,b': ['x'], empty: [], dup: ['m', 'm'], bad: 'x' })
    expect(r.assignments).toEqual({ reaction: ['wave', 'nod'], empty: [], dup: ['m'], bad: [] })
    expect(r.tags).toEqual(['reaction', 'empty', 'dup', 'bad'])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]).toContain('a,b')
  })
  it('グループが無い・形が違うなら、空', () => {
    expect(groupsToAssignments(undefined)).toEqual({ assignments: {}, tags: [], skipped: [] })
    expect(groupsToAssignments([1, 2]).tags).toEqual([])
  })
})

describe('convertLegacyGroupsYaml(rules.yaml の自動変換)', () => {
  it('group は tag になり、motionGroups は消える。pick・durationSec・コメントは残り、変換後は検証に通る', () => {
    const r = convertLegacyGroupsYaml(LEGACY)!
    expect(r).not.toBeNull()
    expect(r.text).not.toContain('motionGroups')
    expect(r.text).not.toContain('group:')
    expect(r.text).toContain('# 自分のルール(コメントは残る)')
    const parsed = parseRuleSetYaml(r.text)
    expect(parsed.issues.map(formatIssue)).toEqual([])
    const rules = parsed.ruleSet!.rules
    expect(rules[0].do[0]).toEqual({ action: 'playMotion', tag: 'reaction', pick: 'random' })
    expect(rules[1].do[0]).toEqual({ action: 'playMotion', tag: 'dance', pick: 'first', durationSec: 5 })
    expect(rules[1].do[1]).toMatchObject({ action: 'playMotion', motion: 'wave' })
  })
  it('グループ → タグの割り当てを返す(メンバーのモーションに、あとでタグを付ける)', () => {
    const r = convertLegacyGroupsYaml(LEGACY)!
    expect(r.legacy.assignments).toEqual({ reaction: ['wave', 'nod'], dance: ['dance1', 'dance2', '手振り'] })
    expect(r.legacy.tags).toEqual(['reaction', 'dance'])
  })
  it('旧形式が無ければ null。YAML として読めなくても null(元のファイルは触らない)', () => {
    expect(convertLegacyGroupsYaml('version: 1\nrules:\n  - id: a\n    when: { trigger: click }\n    do: [{ action: say, text: x }]\n')).toBeNull()
    expect(convertLegacyGroupsYaml('version: 1\nrules: [\n')).toBeNull()
    expect(convertLegacyGroupsYaml('')).toBeNull()
  })
  it('motionGroups だけで、group を使うルールが無くても、変換される(グループの定義がタグの割り当てになる)', () => {
    const r = convertLegacyGroupsYaml('version: 1\nmotionGroups: { g: [a, b] }\nrules: []\n')!
    expect(r.legacy.assignments).toEqual({ g: ['a', 'b'] })
    expect(parseRuleSetYaml(r.text).ruleSet).toEqual({ version: 1, rules: [] })
  })
  it('変換を2回かけても、2回目は何もしない(冪等)', () => {
    const once = convertLegacyGroupsYaml(LEGACY)!
    expect(convertLegacyGroupsYaml(once.text)).toBeNull()
  })
  it('タグにできない名前の group は、そのまま残す(検証で、タグへの変更を知らせるエラーになる)', () => {
    const text = 'version: 1\nrules:\n  - id: a\n    when: { trigger: click }\n    do: [{ action: playMotion, group: "a,b" }]\n'
    const r = convertLegacyGroupsYaml(text)!
    expect(r.text).toContain('group')
    expect(parseRuleSetYaml(r.text).ruleSet).toBeNull()
  })
})

describe('convertLegacyGroupsRaw(パックなど、パース済みのデータ)', () => {
  it('新しいデータを返し、元は変えない', () => {
    const raw = { version: 1, motionGroups: { g: ['a'] }, rules: [{ id: 'r', do: [{ action: 'playMotion', group: 'g', pick: 'first' }] }] }
    const copy = JSON.parse(JSON.stringify(raw))
    const out = convertLegacyGroupsRaw(raw)
    expect(raw).toEqual(copy)
    expect(out.raw).toEqual({ version: 1, rules: [{ id: 'r', do: [{ action: 'playMotion', tag: 'g', pick: 'first' }] }] })
    expect(out.legacy.assignments).toEqual({ g: ['a'] })
  })
  it('旧形式が無ければ、同じものを返す', () => {
    const raw = { version: 1, rules: [] }
    expect(convertLegacyGroupsRaw(raw).raw).toBe(raw)
    expect(convertLegacyGroupsRaw(null).raw).toBeNull()
  })
})
