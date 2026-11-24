import { describe, expect, it } from 'vitest'
import {
  addRuleTags,
  deleteRule,
  deleteRules,
  duplicateRule,
  filterRules,
  mergeRuleSets,
  motionReferences,
  moveRule,
  newNode,
  newRule,
  NO_RULE_FILTER,
  removeRuleTags,
  renameMotionInRuleSet,
  renameTagInRuleSet,
  replaceRule,
  ruleTagCounts,
  rulesUsingTag,
  setEnabledMany,
  toggleRule,
  uniqueId
} from './edit'
import { lintRuleSet } from './lint'
import { PRESET_RULES_YAML } from './presets'
import { parseRuleSet } from './schema'
import { parseRuleSetYaml, stringifyRuleSet, YAML_HEADER } from './yaml'
import type { RuleSet } from './types'

const preset = (): RuleSet => parseRuleSetYaml(PRESET_RULES_YAML).ruleSet!
const idsOf = (rs: RuleSet): string[] => rs.rules.map((r) => r.id)

describe('uniqueId', () => {
  it('被らなければそのまま、被れば連番。不正な文字は - にする', () => {
    expect(uniqueId('a', ['b'])).toBe('a')
    expect(uniqueId('a', ['a'])).toBe('a-2')
    expect(uniqueId('a', ['a', 'a-2'])).toBe('a-3')
    expect(uniqueId('日本語 id!', [])).toBe('id')
    expect(uniqueId('', [])).toBe('rule')
  })
})

describe('ルールの並べ替え・複製・削除・切替', () => {
  it('toggleRule は対象のenabledだけを変え、元のデータは変えない', () => {
    const rs = preset()
    const next = toggleRule(rs, 'click-react', false)
    expect(next.rules.find((r) => r.id === 'click-react')!.enabled).toBe(false)
    expect(rs.rules.find((r) => r.id === 'click-react')!.enabled).toBe(true)
  })
  it('moveRule は1つ上下に動かし、端では何もしない', () => {
    const rs = preset()
    expect(idsOf(moveRule(rs, 'click-react', -1)).slice(0, 2)).toEqual(['click-react', 'startup-greeting'])
    expect(idsOf(moveRule(rs, 'startup-greeting', 1)).slice(0, 2)).toEqual(['click-react', 'startup-greeting'])
    expect(moveRule(rs, 'startup-greeting', -1)).toBe(rs)
    expect(moveRule(rs, 'word-wave', 1)).toBe(rs)
    expect(moveRule(rs, 'none', 1)).toBe(rs)
  })
  it('duplicateRule は元のすぐ下に、新しいidのコピーを入れる(中身は独立)', () => {
    const rs = preset()
    const { ruleSet, newId } = duplicateRule(rs, 'click-react')
    expect(newId).toBe('click-react-copy')
    expect(idsOf(ruleSet).slice(1, 3)).toEqual(['click-react', 'click-react-copy'])
    ruleSet.rules[2].do.length = 0
    expect(rs.rules[1].do.length).toBeGreaterThan(0)
    expect(duplicateRule(ruleSet, 'click-react').newId).toBe('click-react-copy-2')
    expect(duplicateRule(rs, 'nope').newId).toBeNull()
  })
  it('deleteRule / replaceRule', () => {
    const rs = preset()
    expect(idsOf(deleteRule(rs, 'idle-dance'))).not.toContain('idle-dance')
    const edited = { ...rs.rules[0], enabled: false }
    expect(replaceRule(rs, rs.rules[0].id, edited).rules[0].enabled).toBe(false)
  })
})

describe('newNode / newRule(定義から初期値を作る)', () => {
  it('既定値と、必須項目の空の値が入る', () => {
    expect(newNode('trigger', 'idle')).toEqual({ trigger: 'idle', afterSec: 300 })
    expect(newNode('condition', 'cooldown')).toEqual({ condition: 'cooldown', sec: 60 })
    expect(newNode('trigger', 'timeOfDay')).toEqual({ trigger: 'timeOfDay', at: '12:00' })
    expect(newNode('trigger', 'userMessage')).toEqual({ trigger: 'userMessage', keywords: [''], match: 'contains', passToLlm: false })
    expect(newNode('action', 'say')).toEqual({ action: 'say', text: [''] })
  })
  it('playMotion は、登録済みの先頭のモーションを入れる。表情は文脈の先頭', () => {
    expect(newNode('action', 'playMotion', { motions: ['wave', 'nod'] })).toMatchObject({ action: 'playMotion', motion: 'wave', pick: 'random' })
    expect(newNode('action', 'playMotion', { tags: ['ダンス'] })).toMatchObject({ tag: 'ダンス' })
    expect(newNode('action', 'setExpression', { expressions: ['joy'] })).toMatchObject({ name: 'joy', value: 1, durationSec: 3 })
  })
  it('未知の種類でも落ちず、種類キーだけの node になる', () => {
    expect(newNode('trigger', 'nothing')).toEqual({ trigger: 'nothing' })
  })
  it('newRule は重複しないidで作られ、(セリフを空にした以外は)検証に通る形になる', () => {
    const rs = preset()
    const r = newRule(rs)
    expect(idsOf(rs)).not.toContain(r.id)
    r.do = [{ action: 'say', text: ['こんにちは'] }]
    expect(parseRuleSet({ ...rs, rules: [...rs.rules, r] }).issues).toEqual([])
  })
})

describe('タグ(playMotion の tag)', () => {
  it('rulesUsingTag は、使っているルールのidを返す(名前変更・削除前の確認用)', () => {
    expect(rulesUsingTag(preset(), 'ダンス').sort()).toEqual(['idle-dance'])
    expect(rulesUsingTag(preset(), 'リアクション')).toEqual(['click-react'])
    expect(rulesUsingTag(preset(), 'none')).toEqual([])
  })
  it('renameTagInRuleSet は、そのタグを使うルールの参照を、一緒に変える。変換後も検証に通る', () => {
    const rs = renameTagInRuleSet(preset(), 'ダンス', 'パーティ')
    expect(rs.rules.find((r) => r.id === 'idle-dance')!.do[0].tag).toBe('パーティ')
    expect(rulesUsingTag(rs, 'ダンス')).toEqual([])
    expect(parseRuleSet(rs).issues).toEqual([])
    expect(renameTagInRuleSet(rs, 'x', 'x')).toBe(rs)
  })
})

describe('mergeRuleSets(共有ルールの取り込み)', () => {
  it('idが被るルールは別のidにして追加する', () => {
    const base = preset()
    const incoming = parseRuleSetYaml(`version: 1
rules:
  - { id: click-react, when: { trigger: click }, do: [{ action: say, text: x }] }
  - { id: brand-new, when: { trigger: startup }, do: [{ action: say, text: y }] }
`).ruleSet!
    const r = mergeRuleSets(base, incoming)
    expect(idsOf(r.ruleSet)).toEqual([...idsOf(base), 'click-react-2', 'brand-new'])
    expect(r.renamed).toEqual([{ from: 'click-react', to: 'click-react-2' }])
    expect(parseRuleSet(r.ruleSet).issues).toEqual([])
  })
  it('取り込み元自身の中でidが重なっても壊れない', () => {
    const base = parseRuleSetYaml('version: 1\nrules: []\n').ruleSet!
    const inc = preset()
    expect(idsOf(mergeRuleSets(base, inc).ruleSet)).toEqual(idsOf(inc))
  })
})

describe('lintRuleSet(警告)', () => {
  it('存在しないキャラを指定したルールは警告する(キャラの一覧を渡したときだけ)', () => {
    const rs = parseRuleSet({ version: 1, rules: [{ id: 'r', characters: ['a', 'gone'], when: { trigger: 'startup' }, do: [{ action: 'say', text: 'hi' }] }] }).ruleSet!
    expect(lintRuleSet(rs, { motions: [], characterIds: ['a', 'b'] }).map((w) => w.path)).toEqual(['rules[0].characters'])
    expect(lintRuleSet(rs, { motions: [], characterIds: ['a', 'gone'] })).toEqual([])
    expect(lintRuleSet(rs, { motions: [] })).toEqual([])
  })
  const motions = ['idle', 'wave', 'nod', 'dance1', 'dance2', 'dance3']
  const tagCounts = [
    { tag: 'ダンス', count: 3 },
    { tag: 'リアクション', count: 2 }
  ]
  it('プリセットは、内蔵モーションとタグがあれば警告なし', () => {
    expect(lintRuleSet(preset(), { motions, tagCounts })).toEqual([])
  })
  it('登録されていないモーション、モーションが1つも無いタグ、重複するキーワードを警告する', () => {
    const rs = parseRuleSetYaml(`version: 1
rules:
  - { id: a, when: { trigger: click }, do: [{ action: playMotion, motion: missing }, { action: playMotion, tag: notag }] }
  - { id: b, when: { trigger: userMessage, keywords: [x, x] }, do: [{ action: say, text: hi }] }
`).ruleSet!
    const msgs = lintRuleSet(rs, { motions, tagCounts }).map((w) => w.message).join('\n')
    expect(msgs).toContain('モーション「missing」は登録されていない')
    expect(msgs).toContain('タグ「notag」が付いたモーションが1つも無い')
    expect(msgs).toContain('同じ言葉が重複')
  })
  it('tagCounts を渡さなければ、タグは調べない', () => {
    expect(lintRuleSet(preset(), { motions }).length).toBe(0)
  })
})

describe('YAMLの保存形式', () => {
  it('先頭に説明コメントが付き、読み直しても同じ内容(GUI編集の往復)', () => {
    const rs = preset()
    const text = stringifyRuleSet(rs)
    expect(text.startsWith(YAML_HEADER)).toBe(true)
    expect(parseRuleSetYaml(text).ruleSet).toEqual(rs)
  })
  it('GUIで編集した内容(複製・並べ替え・タグ名変更・ルールのタグ)も、保存して読み直せる', () => {
    let rs = preset()
    rs = duplicateRule(rs, 'click-react').ruleSet
    rs = moveRule(rs, 'word-wave', -1)
    rs = renameTagInRuleSet(rs, 'ダンス', 'パーティ')
    rs = toggleRule(rs, 'idle-dance', false)
    rs = addRuleTags(rs, new Set(['idle-dance']), ['夜', '放置'])
    const again = parseRuleSetYaml(stringifyRuleSet(rs))
    expect(again.issues).toEqual([])
    expect(again.ruleSet).toEqual(rs)
  })
})

describe('モーション名の変更とルールの参照', () => {
  const rs = (): RuleSet =>
    parseRuleSetYaml(`version: 1
rules:
  - { id: a, when: { trigger: click }, do: [{ action: playMotion, motion: step1 }, { action: playMotion, tag: g }] }
  - { id: b, when: { trigger: startup }, do: [{ action: playMotion, motion: step3 }] }
`).ruleSet!
  it('参照しているルールを調べられる', () => {
    expect(motionReferences(rs(), 'step1')).toEqual({ rules: ['a'] })
    expect(motionReferences(rs(), 'step3')).toEqual({ rules: ['b'] })
    expect(motionReferences(rs(), 'none')).toEqual({ rules: [] })
  })
  it('名前を変えると、ルールの motion が一緒に変わり、変換後も検証に通る(tag の参照は変わらない)', () => {
    const next = renameMotionInRuleSet(rs(), 'step1', '元気な手振り')
    expect(next.rules[0].do[0].motion).toBe('元気な手振り')
    expect(next.rules[0].do[1].tag).toBe('g')
    expect(next.rules[1].do[0].motion).toBe('step3')
    expect(parseRuleSetYaml(stringifyRuleSet(next)).ruleSet).toEqual(next)
  })
  it('同じ名前・使われていない名前なら、内容は変わらない', () => {
    expect(renameMotionInRuleSet(rs(), 'a', 'a')).toEqual(rs())
    expect(renameMotionInRuleSet(rs(), 'none', 'x')).toEqual(rs())
  })
})

// ---------------------------------------------------------------- ルールの一括操作と絞り込み
const manyRules = (): RuleSet =>
  parseRuleSetYaml(`version: 1
rules:
  - { id: morning-hi, description: 朝のあいさつ, tags: [あいさつ, 朝], when: { trigger: startup }, do: [{ action: say, text: おはよう }] }
  - { id: night-hi, description: 夜のあいさつ, tags: [あいさつ, 夜], enabled: false, when: { trigger: startup }, do: [{ action: say, text: おやすみ }] }
  - { id: dance-idle, tags: [ダンス], when: { trigger: idle, afterSec: 60 }, do: [{ action: playMotion, tag: ダンス }] }
  - { id: wave-click, when: { trigger: click }, do: [{ action: playMotion, motion: wave }] }
`).ruleSet!

describe('ルールの一括操作', () => {
  it('setEnabledMany: 指定したルールだけ、まとめて有効/無効にする。変更が無ければ同じオブジェクト', () => {
    const rs = manyRules()
    const off = setEnabledMany(rs, new Set(['morning-hi', 'dance-idle']), false)
    expect(off.rules.map((r) => [r.id, r.enabled])).toEqual([['morning-hi', false], ['night-hi', false], ['dance-idle', false], ['wave-click', true]])
    expect(setEnabledMany(off, new Set(['morning-hi']), false)).toBe(off)
    expect(setEnabledMany(rs, new Set(), false)).toBe(rs)
    expect(rs.rules[0].enabled).toBe(true) // 元は変わらない
  })
  it('deleteRules: 指定したルールを、まとめて消す。該当が無ければ同じオブジェクト', () => {
    const rs = manyRules()
    expect(idsOf(deleteRules(rs, new Set(['night-hi', 'wave-click'])))).toEqual(['morning-hi', 'dance-idle'])
    expect(deleteRules(rs, new Set(['none']))).toBe(rs)
  })
  it('addRuleTags / removeRuleTags: タグをまとめて足す・外す(重複なし。空になったら tags 自体を持たない)', () => {
    const rs = manyRules()
    const added = addRuleTags(rs, new Set(['wave-click', 'morning-hi']), ['あいさつ', '手'])
    expect(added.rules.find((r) => r.id === 'wave-click')!.tags).toEqual(['あいさつ', '手'])
    expect(added.rules.find((r) => r.id === 'morning-hi')!.tags).toEqual(['あいさつ', '朝', '手'])
    expect(addRuleTags(rs, new Set(['morning-hi']), ['あいさつ'])).toBe(rs)
    const removed = removeRuleTags(added, new Set(['wave-click']), ['あいさつ', '手'])
    expect('tags' in removed.rules.find((r) => r.id === 'wave-click')!).toBe(false)
    expect(parseRuleSet(removed).issues).toEqual([])
    expect(removeRuleTags(rs, new Set(['morning-hi']), ['none'])).toBe(rs)
  })
  it('ruleTagCounts: タグごとの件数(多い順)', () => {
    const counts = ruleTagCounts(manyRules())
    expect(counts[0]).toEqual({ tag: 'あいさつ', count: 2 })
    expect(counts.map((c) => c.count)).toEqual([2, 1, 1, 1]) // 件数の多い順
    expect(counts.map((c) => c.tag).sort()).toEqual(['あいさつ', 'ダンス', '夜', '朝'].sort())
  })
})

describe('filterRules(ルール一覧の絞り込み)', () => {
  const rules = manyRules().rules
  const ids = (l: typeof rules): string[] => l.map((r) => r.id)
  it('条件なしなら、全件(順序もそのまま)', () => {
    expect(ids(filterRules(rules, NO_RULE_FILTER))).toEqual(ids(rules))
  })
  it('検索語は、id・説明・タグ・動作の中身(モーション名・タグ・セリフ)が対象。すべての語を含むもの', () => {
    expect(ids(filterRules(rules, { ...NO_RULE_FILTER, query: 'あいさつ' }))).toEqual(['morning-hi', 'night-hi'])
    expect(ids(filterRules(rules, { ...NO_RULE_FILTER, query: 'おやすみ' }))).toEqual(['night-hi'])
    expect(ids(filterRules(rules, { ...NO_RULE_FILTER, query: 'wave' }))).toEqual(['wave-click'])
    expect(ids(filterRules(rules, { ...NO_RULE_FILTER, query: 'ダンス idle' }))).toEqual(['dance-idle'])
    expect(ids(filterRules(rules, { ...NO_RULE_FILTER, query: 'ＤＡＮＣＥ' }))).toEqual(['dance-idle'])
  })
  it('タグ・有効/無効で絞れる', () => {
    expect(ids(filterRules(rules, { ...NO_RULE_FILTER, tags: ['あいさつ', '夜'] }))).toEqual(['night-hi'])
    expect(ids(filterRules(rules, { ...NO_RULE_FILTER, enabled: 'off' }))).toEqual(['night-hi'])
    expect(ids(filterRules(rules, { ...NO_RULE_FILTER, enabled: 'on', tags: ['あいさつ'] }))).toEqual(['morning-hi'])
  })
  it('数千件でも速い', () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({ ...rules[0], id: `r${i}`, tags: [`t${i % 20}`] }))
    const t0 = performance.now()
    const r = filterRules(big, { query: 'r49 あいさつ', tags: ['t9'], enabled: 'on' })
    expect(performance.now() - t0).toBeLessThan(300)
    expect(r.length).toBeGreaterThan(0)
  })
})
