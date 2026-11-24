import { describe, expect, it } from 'vitest'
import { qualifyLocalNodes, parsePackYaml } from '../packs/manifest'
import { ScriptSchema, toNodeDefs } from '../scripts/spec'
import { RuleEngine } from './engine'
import { analyzeRuleSet, createRegistry, type RuleContribution } from './registry'
import { parseRuleSetYaml } from './yaml'

const script = ScriptSchema.parse({
  apiVersion: 1,
  contributes: {
    triggers: [{ type: 'ping', label: 'ping' }],
    actions: [
      {
        type: 'hello',
        label: 'こんにちは',
        params: [
          { name: 'who', label: '名前', kind: 'string', default: 'みなさん', template: true },
          { name: 'times', label: '回数', kind: 'number', min: 1, max: 5, default: 2 }
        ]
      }
    ]
  }
})
const contribution: RuleContribution = { modId: 's-mod', modName: 'S', triggers: toNodeDefs('s-mod', 'S', script.contributes.triggers), actions: toNodeDefs('s-mod', 'S', script.contributes.actions) }

const rules = (body: string) => {
  const r = parseRuleSetYaml(`version: 1\nrules:\n${body}`)
  if (!r.ruleSet) throw new Error(JSON.stringify(r.issues))
  return r.ruleSet
}
const RS = rules(`  - id: act
    when: { trigger: userMessage, keywords: [やあ] }
    do:
      - { action: s-mod/hello, who: "{{rest}}" }
  - id: on-ping
    when: { trigger: s-mod/ping }
    do: [{ action: say, text: pong }]
`)

describe('スクリプト Mod が宣言した、ルールのノード', () => {
  it('宣言したアクション・トリガーが、レジストリに出る(Mod が無いと、未解決で止まる)', () => {
    const reg = createRegistry([], [contribution])
    expect(reg.defs('action').map((d) => d.type)).toContain('s-mod/hello')
    expect(reg.defs('trigger').map((d) => d.type)).toContain('s-mod/ping')
    expect(reg.find('action', 's-mod/hello')?.params.map((p) => p.name)).toEqual(['who', 'times'])
    expect(analyzeRuleSet(RS, reg).size).toBe(0)
    const missing = analyzeRuleSet(RS, createRegistry([]))
    expect([...missing.keys()].sort()).toEqual(['act', 'on-ping'])
    expect(missing.get('act')?.[0]).toMatchObject({ status: 'missing-extension', modId: 's-mod' })
  })

  it('アクションは、既定値を補い、変数を展開して、extension として出る', () => {
    const e = new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry([], [contribution]) }, RS)
    const r = e.handle({ type: 'userMessage', text: 'やあ 世界' })
    expect(r.fired[0].actions).toEqual([{ kind: 'extension', modId: 's-mod', action: 'hello', params: { who: '世界', times: 2 } }])
  })

  it('スクリプトが起こしたイベントが、宣言したトリガーに届く。別の Mod・別の名前のイベントには、反応しない', () => {
    const e = new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry([], [contribution]) }, RS)
    expect(e.handle({ type: 'modEvent', modId: 's-mod', name: 'ping' }).fired.map((f) => f.ruleId)).toEqual(['on-ping'])
    expect(e.handle({ type: 'modEvent', modId: 'other-mod', name: 'ping' }).fired).toEqual([])
    expect(e.handle({ type: 'modEvent', modId: 's-mod', name: 'pong' }).fired).toEqual([])
  })

  it('Mod が無効(レジストリに無い)のとき、実行しない', () => {
    const e = new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry([]) }, RS)
    expect(e.handle({ type: 'modEvent', modId: 's-mod', name: 'ping' }).fired).toEqual([])
    expect(e.handle({ type: 'userMessage', text: 'やあ x' }).fired).toEqual([])
  })
})

describe('Mod の中のルールの、ローカル名', () => {
  it('自分が宣言したノードを、ローカル名で書ける(<Mod の id>/ が付く)。宣言していない名前は、そのまま', () => {
    const q = qualifyLocalNodes(
      [{ id: 'a', when: { trigger: 'ping' }, do: [{ action: 'hello' }, { action: 'say', text: 'x' }, { action: 'other' }] }],
      's-mod',
      script
    ) as Array<{ when: { trigger: string }; do: Array<{ action: string }> }>
    expect(q[0].when.trigger).toBe('s-mod/ping')
    expect(q[0].do.map((a) => a.action)).toEqual(['s-mod/hello', 'say', 'other'])
    expect(qualifyLocalNodes([{ when: { trigger: 'ping' } }], 's-mod', undefined)).toEqual([{ when: { trigger: 'ping' } }])
  })

  it('mod.yaml のルールで、ローカル名のまま書いて、読める(名前空間つきのルール id になる)', () => {
    const yaml = `id: s-mod
name: S
version: "1"
distribution: private
script:
  apiVersion: 1
  contributes:
    triggers: [{ type: ping, label: ping }]
    actions: [{ type: hello, label: hello }]
rules:
  - id: r
    when: { trigger: ping }
    do: [{ action: hello }]
`
    const r = parsePackYaml(yaml)
    expect(r.errors).toEqual([])
    expect(r.pack?.ruleSet.rules[0]).toMatchObject({ id: 's-mod/r', when: { trigger: 's-mod/ping' }, do: [{ action: 's-mod/hello' }] })
  })
})
