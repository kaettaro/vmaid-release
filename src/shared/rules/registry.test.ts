import { describe, expect, it } from 'vitest'
import { RuleEngine } from './engine'
import { lintRuleSet } from './lint'
import { analyzeRuleSet, createRegistry, FULL_REGISTRY, isNamespacedType } from './registry'
import { parseRuleSetYaml, stringifyRuleSet } from './yaml'
import { expandTemplate, restAfterKeyword, subjectOf } from './template'
import type { RuleSet } from './types'

const parse = (yaml: string): RuleSet => {
  const r = parseRuleSetYaml(yaml)
  if (!r.ruleSet) throw new Error(JSON.stringify(r.issues))
  return r.ruleSet
}

const engineOf = (rs: RuleSet, enabledMods?: string[]): RuleEngine => {
  let t = 0
  return new RuleEngine({ now: () => (t += 1000), random: () => 0, registry: createRegistry(enabledMods), motionsWithTag: () => ['wave'] }, rs)
}

describe('種類名の判定', () => {
  it('名前空間つきだけを通す', () => {
    expect(isNamespacedType('motion-gen-textvrma/generateMotion')).toBe(true)
    expect(isNamespacedType('dance')).toBe(false)
    expect(isNamespacedType('Abc/x')).toBe(false)
    expect(isNamespacedType('a/b')).toBe(false)
    expect(isNamespacedType('abc/x/y')).toBe(false)
    expect(isNamespacedType('abc/')).toBe(false)
  })
})

describe('未導入の Mod のノードの保持', () => {
  const yaml = `version: 1
rules:
  - id: ext
    when: { trigger: startup }
    do:
      - action: some-mod/doThing
        n: 3
        s: こんにちは
        b: true
        nothing: null
        list: [1, a]
        deep: { x: { y: 1 } }
      - { action: say, text: hi }
  - id: normal
    when: { trigger: startup }
    do: [{ action: say, text: ok }]
`
  it('エラーにならず、往復しても中身が変わらない', () => {
    const rs = parse(yaml)
    const again = parse(stringifyRuleSet(rs))
    expect(again).toEqual(rs)
    expect(rs.rules[0].do[0]).toMatchObject({ action: 'some-mod/doThing', n: 3, s: 'こんにちは', b: true, nothing: null, list: [1, 'a'], deep: { x: { y: 1 } } })
    // 他のノードは、検証・正規化される(既定値が入る)
    expect(rs.rules[1].when).toMatchObject({ trigger: 'startup' })
  })

  it('名前空間のない未知の種類は、エラーのまま', () => {
    expect(parseRuleSetYaml('version: 1\nrules:\n  - id: a\n    when: { trigger: startup }\n    do: [{ action: dance }]\n').ruleSet).toBeNull()
  })

  it('深すぎる・大きすぎる中身はエラー', () => {
    const deep = '{ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }'
    expect(parseRuleSetYaml(`version: 1\nrules:\n  - id: a\n    when: { trigger: startup }\n    do: [{ action: some-mod/x, v: ${deep} }]\n`).ruleSet).toBeNull()
    const big = 'x'.repeat(21 * 1024)
    expect(parseRuleSetYaml(`version: 1\nrules:\n  - id: a\n    when: { trigger: startup }\n    do: [{ action: some-mod/x, v: ${big} }]\n`).ruleSet).toBeNull()
  })

  it('未解決のルールは発火せず、他のルールは動く', () => {
    const rs = parse(yaml)
    const e = engineOf(rs)
    expect(e.isBlocked('ext')).toBe(true)
    const res = e.handle({ type: 'startup' })
    expect(res.fired.map((f) => f.ruleId)).toEqual(['normal'])
    expect(e.testFire('ext')).toBeNull()
    expect(analyzeRuleSet(rs, FULL_REGISTRY).get('ext')?.[0]).toMatchObject({ status: 'missing-extension', modId: 'some-mod' })
  })

  it('未解決の条件があるルールも発火しない', () => {
    const rs = parse('version: 1\nrules:\n  - id: c\n    when: { trigger: startup }\n    if: [{ condition: some-mod/cond }]\n    do: [{ action: say, text: hi }]\n')
    expect(engineOf(rs).handle({ type: 'startup' }).fired).toEqual([])
  })
})

describe('機能 Mod の ON/OFF', () => {
  const rs = parse(`version: 1
rules:
  - id: tagged
    when: { trigger: startup }
    do: [{ action: playMotion, tag: ダンス }]
  - id: plain-click
    when: { trigger: click }
    do: [{ action: say, text: hi }]
  - id: head-click
    when: { trigger: click, part: head }
    do: [{ action: say, text: head }]
  - id: stroke
    when: { trigger: stroke }
    do: [{ action: say, text: s }]
  - id: aff
    when: { trigger: startup }
    if: [{ condition: affection, min: 10 }]
    do: [{ action: changeAffection, delta: 1 }]
`)

  it('すべて ON なら、いまのとおり動く', () => {
    const e = engineOf(rs)
    expect(analyzeRuleSet(rs, FULL_REGISTRY).size).toBe(0)
    expect(e.handle({ type: 'startup' }).fired.map((f) => f.ruleId)).toEqual(['tagged', 'aff'])
  })

  it('OFF の Mod の種類・パラメータを使うルールだけが止まる(データは消えない)', () => {
    const reg = createRegistry([])
    const problems = analyzeRuleSet(rs, reg)
    expect([...problems.keys()].sort()).toEqual(['aff', 'head-click', 'stroke', 'tagged'])
    expect(problems.get('tagged')?.[0]).toMatchObject({ status: 'mod-disabled', modId: 'motion-tags', param: 'tag' })
    // 部位なしの click(既定値の part: any)は、高度な触れ合いなしでも動く
    expect(problems.has('plain-click')).toBe(false)
    const e = engineOf(rs, [])
    expect(e.handle({ type: 'startup' }).fired).toEqual([])
    expect(e.handle({ type: 'click' }).fired.map((f) => f.ruleId)).toEqual(['plain-click'])
    // 保存した内容は変わらない
    expect(parse(stringifyRuleSet(rs))).toEqual(rs)
  })

  it('Mod を ON にすると、すぐ動く(setRegistry)', () => {
    const e = engineOf(rs, [])
    expect(e.isBlocked('tagged')).toBe(true)
    e.setRegistry(createRegistry(['motion-tags']))
    expect(e.isBlocked('tagged')).toBe(false)
    expect(e.isBlocked('aff')).toBe(true)
  })

  it('画面に出す定義は、ON の Mod のものだけ', () => {
    const reg = createRegistry(['touch-advanced'])
    expect(reg.defs('trigger').map((d) => d.type)).toContain('hold')
    expect(reg.defs('condition').map((d) => d.type)).not.toContain('affection')
    const playMotion = reg.find('action', 'playMotion')!
    expect(reg.params(playMotion).map((p) => p.name)).not.toContain('tag')
    expect(FULL_REGISTRY.params(playMotion).map((p) => p.name)).toContain('tag')
  })

  it('lint が、動かないルールを理由つきで警告する', () => {
    const w = lintRuleSet(rs, { motions: [], registry: createRegistry([]) })
    expect(w.some((x) => x.message.includes('「tagged」') && x.message.includes('モーションのタグ'))).toBe(true)
    expect(lintRuleSet(rs, { motions: [] }).some((x) => x.message.includes('いまは動きません'))).toBe(false)
  })
})

describe('変数展開({{message}} / {{rest}})', () => {
  it('展開は1回だけ。知らない変数は残す', () => {
    expect(expandTemplate('{{rest}}と{{x}}', { message: 'm', rest: '{{message}}' })).toBe('{{message}}と{{x}}')
  })

  it('一致した言葉のあとを、元の入力から切り出す', () => {
    expect(subjectOf('踊って ワルツ', '踊って')).toBe('ワルツ')
    expect(subjectOf('ワルツを踊って', '踊って')).toBe('ワルツ')
    expect(subjectOf('ワルツを踊って!', '踊って')).toBe('ワルツ')
    expect(subjectOf('踊って ワルツ!', '踊って')).toBe('ワルツ')
    expect(subjectOf('ワルツ、ダンスして', 'ダンスして')).toBe('ワルツ')
    expect(subjectOf('踊って', '踊って')).toBe('')
    expect(subjectOf('ワルツ', '踊って')).toBe('')
    expect(expandTemplate('{{subject}}', { message: 'x', rest: '', subject: 'ワルツ' })).toBe('ワルツ')
    expect(restAfterKeyword('ダンスして: ワルツ', 'ダンスして')).toBe('ワルツ')
    expect(restAfterKeyword('ダンス して!ワルツ', 'ダンスして')).toBe('!ワルツ')
    expect(restAfterKeyword('ＤＡＮＣＥ ワルツ', 'dance')).toBe('ワルツ') // 全角・大文字小文字の揺れ
    expect(restAfterKeyword('おどって', 'おどって')).toBe('')
    expect(restAfterKeyword('がを踊って タンゴ', 'がを踊って')).toBe('タンゴ') // 結合文字
  })

  const ruleYaml = (match: string, motion: string): RuleSet =>
    parse(`version: 1
rules:
  - id: dance
    when: { trigger: userMessage, keywords: [踊って], match: ${match} }
    do:
      - { action: playMotion, motion: "${motion}" }
      - { action: say, text: "{{rest}}を踊るね({{message}})" }
`)
  const motionEnv = (names: string[]) => ({ now: () => 1, random: () => 0, hasMotion: (n: string) => names.includes(n) })

  it('モーション名と、セリフに使える', () => {
    const e = new RuleEngine(motionEnv(['ワルツ']), ruleYaml('contains', '{{rest}}'))
    const r = e.handle({ type: 'userMessage', text: '踊って ワルツ' })
    expect(r.fired[0].actions).toEqual([
      { kind: 'playMotion', motion: 'ワルツ' },
      { kind: 'say', text: 'ワルツを踊るね(踊って ワルツ)' }
    ])
  })

  it('存在しないモーション名のときは、再生しない', () => {
    const e = new RuleEngine(motionEnv(['ワルツ']), ruleYaml('contains', '{{rest}}'))
    expect(e.handle({ type: 'userMessage', text: '踊って タンゴ' }).fired[0].actions.map((a) => a.kind)).toEqual(['say'])
  })

  it('equals のときは rest が空。テスト発火は入力例を使う', () => {
    const e = new RuleEngine(motionEnv(['ワルツ']), ruleYaml('equals', 'ワルツ'))
    expect(e.handle({ type: 'userMessage', text: '踊って' }).fired[0].actions[1]).toEqual({ kind: 'say', text: 'を踊るね(踊って)' })
    const e2 = new RuleEngine(motionEnv(['ワルツ']), ruleYaml('contains', '{{rest}}'))
    expect(e2.testFire('dance', '踊って ワルツ')?.actions[0]).toEqual({ kind: 'playMotion', motion: 'ワルツ' })
    expect(e2.testFire('dance')?.actions.map((a) => a.kind)).toEqual(['say']) // 入力例なし → rest は空
  })

  it('入力文の中の {{message}} は、再展開されない', () => {
    const e = new RuleEngine(motionEnv([]), ruleYaml('contains', 'x'))
    const a = e.handle({ type: 'userMessage', text: '踊って {{message}}' }).fired[0].actions
    expect(a[a.length - 1]).toEqual({ kind: 'say', text: '{{message}}を踊るね(踊って {{message}})' })
  })
})

describe('スロット({{slot:名前}})', () => {
  const rs = parse(`version: 1
rules:
  - id: tap
    when: { trigger: click }
    do:
      - { action: playMotion, motion: "{{slot:tap-motion}}" }
      - { action: say, text: "{{slot:line}}ね" }
  - id: user-rule
    when: { trigger: click }
    do: [{ action: say, text: "{{slot:line}}" }]
`)
  // Mod のルールは、取り込み時に、id が <modId>/… になる
  const modRules: RuleSet = { version: 1, rules: rs.rules.map((r) => (r.id === 'tap' ? { ...r, id: 'my-mod/tap' } : r)) }
  const mk = (slots: Record<string, Record<string, string>>) =>
    new RuleEngine({ now: () => 1, random: () => 0, hasMotion: (n) => n === 'wave', slots: (m) => slots[m] }, modRules)

  it('展開: スロットが無い(自分のルール)なら、そのまま残す。空のスロットは、空文字', () => {
    expect(expandTemplate('{{slot:a}}', { message: '', rest: '' })).toBe('{{slot:a}}')
    expect(expandTemplate('x{{slot:a}}y', { message: '', rest: '', slots: {} })).toBe('xy')
    expect(expandTemplate('{{slot:a}}', { message: '', rest: '', slots: { a: 'ok' } })).toBe('ok')
  })

  it('Mod のルールは、選ばれたモーション・文で動く。自分のルールには、スロットを渡さない', () => {
    const r = mk({ 'my-mod': { 'tap-motion': 'wave', line: 'はい' } }).handle({ type: 'click' })
    expect(r.fired.find((f) => f.ruleId === 'my-mod/tap')?.actions).toEqual([
      { kind: 'playMotion', motion: 'wave', source: 'my-mod' },
      { kind: 'say', text: 'はいね', source: 'my-mod' }
    ])
    expect(r.fired.find((f) => f.ruleId === 'user-rule')?.actions).toEqual([{ kind: 'say', text: '{{slot:line}}' }])
  })

  it('空のスロットの反応は、動かない(モーションなし。セリフは「ね」だけになる)', () => {
    const r = mk({}).handle({ type: 'click' })
    expect(r.fired.find((f) => f.ruleId === 'my-mod/tap')?.actions).toEqual([{ kind: 'say', text: 'ね', source: 'my-mod' }])
  })
})
