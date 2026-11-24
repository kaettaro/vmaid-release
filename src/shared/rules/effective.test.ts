import { describe, expect, it } from 'vitest'
import { BUILTIN_MOTION_TAGS } from '../motions/builtin'
import { applyRuleValues, checkSlotRefs, coerceSlotValue, effectiveRule, hasSlotRefs, listRuleFields, resolveSlotRefs, slotRefOf } from './effective'
import { RuleEngine, type EngineEnv } from './engine'
import { FULL_REGISTRY } from './registry'
import { parseRuleSetYaml } from './yaml'
import type { Rule, RuleSet } from './types'

const load = (rules: string): RuleSet => {
  const r = parseRuleSetYaml(`version: 1\nrules:\n${rules}`)
  expect(r.issues).toEqual([])
  return r.ruleSet!
}
const find = (k: Parameters<typeof FULL_REGISTRY.find>[0], t: string) => FULL_REGISTRY.find(k, t)
const idle = (extra = ''): Rule =>
  load(`  - id: idle-talk\n    when: { trigger: idle, afterSec: 300 }\n    if:\n      - { condition: probability, value: 0.8 }\n      - { condition: cooldown, sec: 600 }\n    do:\n      - { action: say, text: ["やあ", "ねえ"] }\n${extra}`).rules[0]!

describe('スロットの値の型変換', () => {
  const p = (kind: string, extra: object = {}) => ({ name: 'x', label: 'x', kind, ...extra }) as never
  it('number: 範囲に丸める。数でなければ undefined', () => {
    expect(coerceSlotValue(p('number', { min: 1, max: 10 }), '5')).toBe(5)
    expect(coerceSlotValue(p('number', { min: 1, max: 10 }), '99')).toBe(10)
    expect(coerceSlotValue(p('number', { min: 1, max: 10 }), '0')).toBe(1)
    expect(coerceSlotValue(p('number'), 'abc')).toBeUndefined()
    expect(coerceSlotValue(p('number'), '')).toBeUndefined()
  })
  it('boolean・time・enum・stringList', () => {
    expect(coerceSlotValue(p('boolean'), 'true')).toBe(true)
    expect(coerceSlotValue(p('boolean'), 'オフ')).toBe(false)
    expect(coerceSlotValue(p('boolean'), 'x')).toBeUndefined()
    expect(coerceSlotValue(p('time'), '09:30')).toBe('09:30')
    expect(coerceSlotValue(p('time'), '9:30')).toBeUndefined()
    expect(coerceSlotValue(p('enum', { options: [{ value: 'a', label: 'A' }] }), 'a')).toBe('a')
    expect(coerceSlotValue(p('enum', { options: [{ value: 'a', label: 'A' }] }), 'b')).toBeUndefined()
    expect(coerceSlotValue(p('stringList'), 'こんにちは\n\n  やあ \n')).toEqual(['こんにちは', 'やあ'])
    expect(coerceSlotValue(p('stringList'), '  \n ')).toBeUndefined()
  })
  it('{{slot:id}} の判定(ちょうどの形だけ)', () => {
    expect(slotRefOf('{{slot:idle-sec}}')).toBe('idle-sec')
    expect(slotRefOf(' {{slot:a}} ')).toBe('a')
    expect(slotRefOf('x {{slot:a}}')).toBeNull()
    expect(slotRefOf(300)).toBeNull()
  })
})

describe('層 B: スロットの差し込み', () => {
  const ref = load(
    `  - id: r\n    when: { trigger: idle, afterSec: "{{slot:idle-sec}}" }\n    if:\n      - { condition: probability, value: "{{slot:chance}}" }\n      - { condition: cooldown, sec: "{{slot:gap}}" }\n    do:\n      - { action: say, text: ["{{slot:lines}}"] }\n      - { action: setExpression, name: happy, value: 1, durationSec: "{{slot:sec}}" }\n`
  ).rules[0]!
  it('数値・確率・セリフの一覧が、スロットの値になる(範囲に丸める)', () => {
    expect(hasSlotRefs(ref)).toBe(true)
    const r = resolveSlotRefs(ref, find, { 'idle-sec': '120', chance: '2', gap: '30', lines: 'A\nB\nC', sec: '4' })
    expect(r.when.afterSec).toBe(120)
    expect(r.if[0]!.value).toBe(1) // 確率は 0〜1 に丸める
    expect(r.if[1]!.sec).toBe(30)
    expect(r.do[0]!.text).toEqual(['A', 'B', 'C'])
    expect(r.do[1]!.durationSec).toBe(4)
  })
  it('値が空・壊れているときは、パラメータの既定値になる(ルールが止まらない)', () => {
    const r = resolveSlotRefs(ref, find, { 'idle-sec': 'あ', chance: '', gap: '' })
    expect(r.when.afterSec).toBe(300) // idle の既定
    expect(r.if[0]!.value).toBe(1)
    expect(r.do[0]!.text).toEqual(['…'])
  })
  it('自分のルール(スロットが渡されない)は、セリフの {{slot}} を、そのままにする', () => {
    expect(resolveSlotRefs(ref, find, undefined).do[0]!.text).toEqual(['{{slot:lines}}'])
  })
  it('スロットの無いルールは、そのまま返す(複製しない)', () => {
    const r = idle()
    expect(hasSlotRefs(r)).toBe(false)
    expect(resolveSlotRefs(r, find, {})).toBe(r)
  })
  it('キーワードの {{slot}} は、別の仕組み(カンマ区切り)なので、触らない', () => {
    const k = load('  - id: k\n    when: { trigger: userMessage, keywords: ["{{slot:words}}"] }\n    do: [{ action: say, text: x }]\n').rules[0]!
    expect(hasSlotRefs(k)).toBe(false)
    expect(resolveSlotRefs(k, find, { words: 'a,b' })).toBe(k)
  })
})

describe('層 A: ルールの値の上書き', () => {
  it('調整できる値の一覧: number・stringList など。種類・モーション名は出ない。{{slot}} の値は出ない', () => {
    const fields = listRuleFields(idle(), find).map((f) => f.path)
    expect(fields).toEqual(expect.arrayContaining(['when.afterSec', 'if.0.value', 'if.1.sec', 'do.0.text']))
    expect(fields.some((p) => p.endsWith('.trigger') || p.endsWith('.action'))).toBe(false)
    const withRef = load('  - id: r\n    when: { trigger: idle, afterSec: "{{slot:s}}" }\n    do: [{ action: say, text: x }]\n').rules[0]!
    expect(listRuleFields(withRef, find).map((f) => f.path)).not.toContain('when.afterSec')
  })

  it('上書きは、検査して差し込む。場所が無い・範囲外・型違いは、無視する。元のルールは、変えない', () => {
    const r = idle()
    const out = applyRuleValues(r, find, { 'when.afterSec': 60, 'if.1.sec': 1, 'do.0.text': ['A', 'B'], 'when.nothing': 5, 'if.0.value': 9 })
    expect(out.when.afterSec).toBe(60)
    expect(out.if[1]!.sec).toBe(1)
    expect(out.do[0]!.text).toEqual(['A', 'B'])
    expect(out.if[0]!.value).toBe(0.8) // 範囲外(0〜1)は、無視
    expect(r.when.afterSec).toBe(300) // 元は、そのまま
    expect(applyRuleValues(r, find, {})).toBe(r)
    expect(applyRuleValues(r, find, { 'do.0.text': 5 as never })).toEqual(r)
  })

  it('優先順位: スロットが決める値は、上書きされない', () => {
    const ref = load('  - id: r\n    when: { trigger: idle, afterSec: "{{slot:s}}" }\n    do: [{ action: say, text: ["x"] }]\n').rules[0]!
    const out = effectiveRule(ref, find, { s: '77' }, { 'when.afterSec': 5, 'do.0.text': ['上書き'] })
    expect(out.when.afterSec).toBe(77)
    expect(out.do[0]!.text).toEqual(['上書き'])
  })
})

describe('Mod の読み込み時の検査', () => {
  const rs = load('  - id: r\n    when: { trigger: idle, afterSec: "{{slot:s}}" }\n    if: [{ condition: probability, value: "{{slot:p}}" }]\n    do: [{ action: say, text: ["{{slot:l}}"] }]\n')
  it('存在しないスロット・種類の合わないスロットは、問題として返す', () => {
    expect(checkSlotRefs(rs, [{ id: 's', kind: 'number' }, { id: 'p', kind: 'number' }, { id: 'l', kind: 'lines' }], find)).toEqual([])
    const bad = checkSlotRefs(rs, [{ id: 's', kind: 'time' }, { id: 'l', kind: 'number' }], find)
    expect(bad.some((x) => x.includes('スロット「s」'))).toBe(true)
    expect(bad.some((x) => x.includes('宣言していないスロット「p」'))).toBe(true)
    expect(bad.some((x) => x.includes('スロット「l」'))).toBe(true)
  })
})

describe('エンジンで、設定が効く', () => {
  const NOW = new Date(2026, 9, 14, 10, 0, 0).getTime()
  /** mod = true なら、Mod のルールとして、id に `mod/` を付ける(Mod のルールは、読み込み後、`<Mod の id>/<ルール id>` になる) */
  const make = (text: string, env: Partial<EngineEnv> & { now?: () => number }, mod = true) => {
    const state = { t: NOW }
    const rs = load(text)
    const set = mod ? { ...rs, rules: rs.rules.map((r) => ({ ...r, id: `mod/${r.id}` })) } : rs
    const e = new RuleEngine({ now: () => state.t, random: () => 0, motionsWithTag: (t) => Object.entries(BUILTIN_MOTION_TAGS).filter(([, v]) => v.includes(t)).map(([n]) => n), ...env }, set)
    return { e, advance: (sec: number) => void (state.t += sec * 1000) }
  }
  const text = (afterSec: string) => `  - id: idle\n    when: { trigger: idle, afterSec: ${afterSec} }\n    do: [{ action: say, text: ["{{slot:lines}}"] }]\n`

  it('スロット: afterSec とセリフが、設定で変わる。値を変えると、すぐ効く', () => {
    let slots: Record<string, string> = { sec: '60', lines: 'A\nB' }
    const { e, advance } = make(text('"{{slot:sec}}"'), { slots: () => slots })
    advance(61)
    const r = e.handle({ type: 'tick' })
    expect(r.fired[0]?.actions[0]).toMatchObject({ kind: 'say' })
    expect(['A', 'B']).toContain((r.fired[0]!.actions[0] as { text: string }).text)
    slots = { sec: '600', lines: 'C' }
    e.handle({ type: 'activity' })
    advance(120)
    expect(e.handle({ type: 'tick' }).fired).toEqual([]) // 600 秒に変えたので、120 秒では、動かない
    advance(500)
    expect((e.handle({ type: 'tick' }).fired[0]!.actions[0] as { text: string }).text).toBe('C')
  })

  it('上書き(層 A): Mod が書いた afterSec 300 を、60 に。キャラごとの値は、呼ぶ側が重ねて渡す', () => {
    let values: Record<string, Record<string, number>> = { idle: { 'when.afterSec': 60 } }
    const { e, advance } = make(text('300').replace('{{slot:lines}}', 'やあ'), { ruleValues: () => values as never })
    advance(61)
    expect(e.handle({ type: 'tick' }).fired).toHaveLength(1)
    values = {}
    e.handle({ type: 'activity' })
    advance(61)
    expect(e.handle({ type: 'tick' }).fired).toEqual([]) // 上書きを消すと、300 秒に戻る
  })

  it('自分のルール(Mod ではない)には、上書きもスロットも、効かない', () => {
    const { e, advance } = make('  - id: mine\n    when: { trigger: idle, afterSec: 300 }\n    do: [{ action: say, text: x }]\n', { ruleValues: () => ({ mine: { 'when.afterSec': 1 } }) as never }, false)
    advance(5)
    expect(e.handle({ type: 'tick' }).fired).toEqual([])
  })
})
