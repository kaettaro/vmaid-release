import { describe, expect, it } from 'vitest'
import { RuleEngine } from './engine'
import { analyzeRuleSet, createRegistry } from './registry'
import { parseRuleSetYaml } from './yaml'
import type { RuleSet } from './types'

const parse = (yaml: string): RuleSet => {
  const r = parseRuleSetYaml(`version: 1\nrules:\n${yaml}`)
  if (!r.ruleSet) throw new Error(JSON.stringify(r.issues))
  return r.ruleSet
}
const asMod = (rs: RuleSet, modId: string): RuleSet => ({ ...rs, rules: rs.rules.map((r) => ({ ...r, id: `${modId}/${r.id}` })) })

describe('状態・感情・小道具のノード', () => {
  it('Mod「状態と感情」「小道具」が OFF なら、使うルールは止まる。ON なら動く', () => {
    const rs = parse(`  - id: a
    when: { trigger: click }
    do:
      - { action: startState, name: ねむい, durationSec: 30 }
      - { action: setEmotion, name: joy, value: 80 }
      - { action: showProp, prop: pendulum }
`)
    expect(analyzeRuleSet(rs, createRegistry([])).get('a')?.map((p) => p.status === 'mod-disabled' && p.modId)).toEqual(['emotion-state', 'emotion-state', 'props'])
    expect(analyzeRuleSet(rs, createRegistry(['emotion-state', 'props'])).size).toBe(0)
  })

  it('条件 state / emotion は、実行中の状態と感情値で判定する', () => {
    const rs = parse(`  - id: sleepy
    when: { trigger: click }
    if: [{ condition: state, is: ねむい }]
    do: [{ action: say, text: zzz }]
  - id: awake
    when: { trigger: click }
    if: [{ condition: state, is: ねむい, active: false }]
    do: [{ action: say, text: awake }]
  - id: happy
    when: { trigger: click }
    if: [{ condition: emotion, name: joy, min: 50 }]
    do: [{ action: say, text: joy }]
`)
    let modes = new Set<string>()
    let joy = 0
    const e = new RuleEngine({ now: () => 1, random: () => 0, runtime: () => ({ modes, emotion: (n) => (n === 'joy' ? joy : 0) }) }, rs)
    const ids = () => e.handle({ type: 'click' }).fired.map((f) => f.ruleId)
    expect(ids()).toEqual(['awake'])
    modes = new Set(['ねむい'])
    joy = 60
    expect(ids().sort()).toEqual(['happy', 'sleepy'])
    joy = 10
    expect(ids()).toEqual(['sleepy'])
  })

  it('トリガー emotionTag は、AI の感情タグに、大文字小文字を区別せず反応する', () => {
    const rs = parse(`  - id: joy
    when: { trigger: emotionTag, emotion: Joy }
    do: [{ action: setExpression, name: happy }]
`)
    const e = new RuleEngine({ now: () => 1, random: () => 0 }, rs)
    expect(e.handle({ type: 'llmEmotion', emotion: ' joy ' }).fired).toHaveLength(1)
    expect(e.handle({ type: 'llmEmotion', emotion: 'sad' }).fired).toHaveLength(0)
    expect(e.handle({ type: 'click' }).fired).toHaveLength(0)
  })

  it('Mod のルールの効果には source(Mod の id)が付き、小道具の id は、Mod の名前空間つきになる', () => {
    const rs = asMod(
      parse(`  - id: r
    when: { trigger: click }
    do:
      - { action: showProp, prop: pendulum, durationSec: 20 }
      - { action: hideProp, prop: other/lamp }
      - { action: startState, name: trance }
      - { action: changeEmotion, name: joy, delta: 5 }
`),
      'hypno'
    )
    const a = new RuleEngine({ now: () => 1, random: () => 0 }, rs).handle({ type: 'click' }).fired[0].actions
    expect(a).toEqual([
      { kind: 'showProp', prop: 'hypno/pendulum', durationSec: 20, source: 'hypno' },
      { kind: 'hideProp', prop: 'other/lamp', source: 'hypno' },
      { kind: 'startState', name: 'trance', durationSec: 0, source: 'hypno' },
      { kind: 'changeEmotion', name: 'joy', delta: 5, source: 'hypno' }
    ])
    // 自分のルールには、source も名前空間も付かない
    const mine = new RuleEngine({ now: () => 1, random: () => 0 }, parse(`  - id: r\n    when: { trigger: click }\n    do: [{ action: showProp, prop: pendulum }]\n`)).handle({ type: 'click' }).fired[0].actions
    expect(mine).toEqual([{ kind: 'showProp', prop: 'pendulum', durationSec: 0 }])
  })
})

describe('画面効果のノード', () => {
  const yaml = `  - id: r
    when: { trigger: click }
    do:
      - { action: showOverlay, effect: vignette, intensity: 0.4, durationSec: 30 }
      - { action: showOverlay }
      - { action: hideOverlay }
`

  it('Mod「画面効果」が OFF なら止まり、ON なら動く', () => {
    const rs = parse(yaml)
    expect(analyzeRuleSet(rs, createRegistry([])).get('r')?.map((p) => p.status === 'mod-disabled' && p.modId)).toEqual(['overlay', 'overlay', 'overlay'])
    expect(analyzeRuleSet(rs, createRegistry(['overlay'])).size).toBe(0)
  })

  it('既定値を補って展開し、Mod のルールには source が付く', () => {
    const a = new RuleEngine({ now: () => 1, random: () => 0 }, asMod(parse(yaml), 'hypno')).handle({ type: 'click' }).fired[0].actions
    expect(a).toEqual([
      { kind: 'showOverlay', effect: 'vignette', scope: 'screen', intensity: 0.4, color: '', durationSec: 30, source: 'hypno' },
      { kind: 'showOverlay', effect: 'spiral', scope: 'screen', intensity: 0.6, color: '', durationSec: 0, source: 'hypno' },
      { kind: 'hideOverlay', source: 'hypno' }
    ])
  })
})

describe('スロットを使うルール(合言葉・表情・セット名・セットを戻す)', () => {
  const yaml = `  - id: r
    when: { trigger: userMessage, keywords: ["{{slot:words}}"], match: contains }
    do:
      - { action: applyPreset, name: "{{slot:set}}" }
      - { action: setExpression, name: "{{slot:face}}", value: 1, durationSec: 5 }
      - { action: revertPreset }
`
  const engine = (slots: Record<string, string>): RuleEngine => new RuleEngine({ now: () => 1, random: () => 0, slots: () => slots }, asMod(parse(yaml), 'hypno'))

  it('合言葉のスロットは、カンマ・読点・改行で区切った複数の言葉になる', () => {
    const e = engine({ words: 'ねむれ、ふりこ\nおやすみ', set: 'trance', face: 'blink' })
    for (const text of ['ねむれ', 'ふりこを見て', 'おやすみ!']) expect(e.handle({ type: 'userMessage', text }).fired).toHaveLength(1)
    expect(e.handle({ type: 'userMessage', text: 'こんにちは' }).fired).toHaveLength(0)
  })
  it('合言葉のスロットが空なら、そのルールは動かない', () => {
    expect(engine({ words: '', set: 'trance' }).handle({ type: 'userMessage', text: 'ねむれ' }).fired).toHaveLength(0)
  })
  it('セット名・表情名は展開され、空のスロットのアクションは出ない。revertPreset はそのまま出る', () => {
    const a = engine({ words: 'ねむれ', set: 'trance', face: '' }).handle({ type: 'userMessage', text: 'ねむれ' }).fired[0].actions
    expect(a).toEqual([
      { kind: 'applyPreset', name: 'trance', revertAfterSec: 0, mode: 'overlay', source: 'hypno' },
      { kind: 'revertPreset', name: '', source: 'hypno' }
    ])
  })
})

describe('画面効果のスロット(効果・範囲・色)', () => {
  const yaml = `  - id: r
    when: { trigger: click }
    do:
      - { action: showOverlay, effect: "{{slot:fx}}", scope: "{{slot:area}}", color: "{{slot:tint}}" }
`
  const run = (slots: Record<string, string>) => new RuleEngine({ now: () => 1, random: () => 0, slots: () => slots }, asMod(parse(yaml), 'hypno')).handle({ type: 'click' }).fired[0]?.actions

  it('効果・範囲・色は、スロットの値に展開される', () => {
    expect(run({ fx: 'pink-fog', area: 'character', tint: '#ff8ac8' })).toEqual([{ kind: 'showOverlay', effect: 'pink-fog', scope: 'character', intensity: 0.6, color: '#ff8ac8', durationSec: 0, source: 'hypno' }])
  })
  it('範囲・色が空なら、既定(画面全体・効果の色)。効果が空なら、何も出さない', () => {
    expect(run({ fx: 'spiral', area: '', tint: '' })).toEqual([{ kind: 'showOverlay', effect: 'spiral', scope: 'screen', intensity: 0.6, color: '', durationSec: 0, source: 'hypno' }])
    expect(run({ fx: '', area: 'screen', tint: '' })).toEqual([])
  })
  it('範囲に、スロット以外の知らない値を直接書くと、検証でエラーになる', () => {
    const r = parseRuleSetYaml(`version: 1
rules:
  - id: r
    when: { trigger: click }
    do: [{ action: showOverlay, effect: spiral, scope: galaxy }]
`)
    expect(r.ruleSet).toBeNull()
  })
})

describe('小道具のスロット(出す・出さない、秒数)', () => {
  const yaml = `  - id: r
    when: { trigger: click }
    do:
      - { action: showProp, prop: "{{slot:coin}}", durationSec: "{{slot:coin-sec}}" }
`
  const run = (slots: Record<string, string>) => new RuleEngine({ now: () => 1, random: () => 0, slots: () => slots }, asMod(parse(yaml), 'hypno')).handle({ type: 'click' }).fired[0]?.actions

  it('小道具の id と秒数は、スロットの値に展開される(Mod の名前空間つき)', () => {
    expect(run({ coin: 'pendulum', 'coin-sec': '5' })).toEqual([{ kind: 'showProp', prop: 'hypno/pendulum', durationSec: 5, source: 'hypno' }])
  })
  it('id が空なら出さず、秒数が数字でなければ 0(消すまで)、範囲外は丸める', () => {
    expect(run({ coin: '', 'coin-sec': '5' })).toEqual([])
    expect(run({ coin: 'pendulum', 'coin-sec': 'abc' })?.[0]).toMatchObject({ durationSec: 0 })
    expect(run({ coin: 'pendulum', 'coin-sec': '99999' })?.[0]).toMatchObject({ durationSec: 3600 })
    expect(run({ coin: 'pendulum', 'coin-sec': '-3' })?.[0]).toMatchObject({ durationSec: 0 })
  })
})

describe('状態と見た目の連動・標準の表情・衣装', () => {
  const engine = (yaml: string): RuleEngine => new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry(['emotion-state']) }, parse(yaml))

  it('「状態を始める」に見た目のセットを付けると、アクションに載る(付けなければ載らない)', () => {
    const e = engine(`  - id: r
    when: { trigger: click }
    do:
      - { action: startState, name: ねこ, durationSec: 30, preset: 猫耳, presetMode: replace }
      - { action: startState, name: ふつう }
      - { action: resetLook }
`)
    expect(e.handle({ type: 'click' }).fired[0].actions).toEqual([
      { kind: 'startState', name: 'ねこ', durationSec: 30, preset: '猫耳', presetMode: 'replace' },
      { kind: 'startState', name: 'ふつう', durationSec: 0 },
      { kind: 'resetLook' }
    ])
  })

  it('トリガー「状態が終わったとき」は、状態の名前で絞れる(空ならどの状態でも)', () => {
    const e = engine(`  - id: any
    when: { trigger: stateEnd }
    do: [{ action: say, text: [おわり] }]
  - id: only
    when: { trigger: stateEnd, name: ねこ }
    do: [{ action: say, text: [ねこおわり] }]
`)
    expect(e.handle({ type: 'stateEnd', name: 'ねこ' }).fired.map((f) => f.ruleId)).toEqual(['any', 'only'])
    expect(e.handle({ type: 'stateEnd', name: 'ほか' }).fired.map((f) => f.ruleId)).toEqual(['any'])
  })
})

describe('移動のノード(機能 Mod「より自由な移動」)', () => {
  const engine = (yaml: string, mods: string[] = ['move']): RuleEngine => new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry(mods) }, parse(yaml))

  it('「移動する」「移動をやめる」: 行き先と動き方がアクションに載る(動き方の既定は、歩く)', () => {
    const e = engine(`  - id: r
    when: { trigger: click }
    do:
      - { action: moveTo, target: left, mode: warp }
      - { action: moveTo, target: cursor }
      - { action: stopMove }
`)
    expect(e.handle({ type: 'click' }).fired[0].actions).toEqual([
      { kind: 'moveTo', target: 'left', mode: 'warp' },
      { kind: 'moveTo', target: 'cursor', mode: 'walk' },
      { kind: 'stopMove' }
    ])
  })

  it('トリガー「移動が終わったとき」は、動き方で絞れる(どちらでも = 既定)', () => {
    const e = engine(`  - id: any
    when: { trigger: moveEnd }
    do: [{ action: say, text: [着いた] }]
  - id: warp
    when: { trigger: moveEnd, mode: warp }
    do: [{ action: say, text: [出た] }]
`)
    expect(e.handle({ type: 'moveEnd', mode: 'walk' }).fired.map((f) => f.ruleId)).toEqual(['any'])
    expect(e.handle({ type: 'moveEnd', mode: 'warp' }).fired.map((f) => f.ruleId)).toEqual(['any', 'warp'])
  })

  it('Mod が OFF なら、移動を使うルールは止まる', () => {
    const rs = parse('  - id: r\n    when: { trigger: click }\n    do: [{ action: moveTo, target: left }]\n')
    expect(analyzeRuleSet(rs, createRegistry([])).size).toBeGreaterThan(0)
    expect(analyzeRuleSet(rs, createRegistry(['move'])).size).toBe(0)
  })
})
