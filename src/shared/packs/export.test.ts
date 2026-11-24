import { describe, expect, it } from 'vitest'
import { parseRuleSetYaml } from '../rules/yaml'
import { buildUserMod, motionsUsedByRules } from './export'
import { parsePackYaml } from './manifest'
import { unzipPack } from './transfer'

const rules = parseRuleSetYaml(`version: 1
rules:
  - id: hello
    when: { trigger: click }
    do:
      - { action: playMotion, motion: myDance }
      - { action: playMotion, motion: nod }
      - { action: playMotion, motion: lost }
      - { action: say, text: hi }
  - id: stroke
    when: { trigger: stroke, part: head }
    do: [{ action: say, text: ok }]
`).ruleSet!.rules

const base = { id: 'my-mod', name: 'テスト', version: '1.0', description: '説明', rules, motions: [{ name: 'myDance', tags: ['ダンス'], data: new Uint8Array([1, 2, 3]) }], promptText: '', promptLayer: 'persona' as const }

describe('Mod としてエクスポート', () => {
  it('ルールが使うモーションを拾う(変数展開のものは除く)', () => {
    expect(motionsUsedByRules(rules)).toEqual(['myDance', 'nod', 'lost'])
  })

  it('取り込みの検査に通る zip になり、ルール・モーション・必要な機能 Mod が入る', () => {
    const r = buildUserMod(base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const un = unzipPack(r.zip)
    expect(un.ok).toBe(true)
    if (!un.ok) return
    expect(Object.keys(un.files).sort()).toEqual(['mod.yaml', 'motions/001.vrma'])
    const p = parsePackYaml(new TextDecoder().decode(un.files['mod.yaml'])).pack!
    expect(p.distribution).toBe('private')
    expect(p.requires).toEqual(['touch-advanced'])
    expect(p.motions[0]).toMatchObject({ name: 'myDance', tags: ['ダンス'] })
    expect(p.ruleSet.rules.map((x) => x.id)).toEqual(['my-mod/hello', 'my-mod/stroke'])
    // ルールのモーション参照は、Mod の中のモーション名になる(内蔵は、そのまま)
    expect(p.ruleSet.rules[0].do[0]).toMatchObject({ motion: 'my-mod/myDance' })
    expect(p.ruleSet.rules[0].do[1]).toMatchObject({ motion: 'nod' })
  })

  it('含まれないモーションを使うルールは、警告する(内蔵は警告しない)', () => {
    const r = buildUserMod(base)
    expect(r.ok && r.warnings).toEqual(['ルールが使うモーション「lost」は含まれていません(相手の環境に同じ名前が無いと、再生されません)'])
  })

  it('指示文を、層つきで含められる。長すぎる・空の入力・不正な id は、エラー', () => {
    const r = buildUserMod({ ...base, rules: [], motions: [], promptText: 'やさしく話す', promptLayer: 'state' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const un = unzipPack(r.zip)
      const p = un.ok ? parsePackYaml(new TextDecoder().decode(un.files['mod.yaml'])).pack : null
      expect(p?.prompt).toEqual({ layer: 'state', text: 'やさしく話す' })
    }
    expect(buildUserMod({ ...base, promptText: 'あ'.repeat(2001) }).ok).toBe(false)
    expect(buildUserMod({ ...base, rules: [], motions: [] }).ok).toBe(false)
    expect(buildUserMod({ ...base, id: 'Bad Id' }).ok).toBe(false)
    expect(buildUserMod({ ...base, name: ' ' }).ok).toBe(false)
  })
})
