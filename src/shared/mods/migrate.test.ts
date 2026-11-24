import { describe, expect, it } from 'vitest'
import { parseRuleSetYaml } from '../rules/yaml'
import { migrateFeatureMods } from './migrate'

const rules = (body: string) => {
  const r = parseRuleSetYaml(`version: 1\nrules:\n${body}`)
  if (!r.ruleSet) throw new Error(JSON.stringify(r.issues))
  return r.ruleSet
}
const base = { existingUser: true, footLock: false, ttsEnabled: false, rules: null, hasMotionTags: false }

describe('機能 Mod の初回の移行', () => {
  it('新規インストールは、追いかけ・モーションのタグだけ ON(ほかは OFF)', () => {
    expect(migrateFeatureMods({ ...base, existingUser: false, footLock: true, ttsEnabled: true })).toEqual(['chase', 'motion-tags'])
  })

  it('使っていた機能だけを ON にする', () => {
    expect(migrateFeatureMods(base)).toEqual([])
    expect(migrateFeatureMods({ ...base, footLock: true, ttsEnabled: true, hasMotionTags: true })).toEqual(['foot-lock', 'motion-tags', 'tts'])
  })

  it('ルールが使っている機能を拾う(部位なしの click・標準のノードは拾わない)', () => {
    const rs = rules(`  - id: a
    when: { trigger: click }
    do: [{ action: say, text: hi }]
  - id: b
    when: { trigger: stroke, part: head }
    if: [{ condition: affection, min: 10 }]
    do: [{ action: playMotion, tag: ダンス }]
`)
    expect(migrateFeatureMods({ ...base, rules: rs })).toEqual(['affection-mood', 'motion-tags', 'touch-advanced'])
    expect(migrateFeatureMods({ ...base, rules: rules('  - id: a\n    when: { trigger: click }\n    do: [{ action: say, text: hi }]\n') })).toEqual([])
  })
})
