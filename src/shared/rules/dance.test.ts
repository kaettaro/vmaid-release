import { describe, expect, it } from 'vitest'
import { RuleEngine } from './engine'
import { analyzeRuleSet, createRegistry, FULL_REGISTRY } from './registry'
import { parseRuleSetYaml } from './yaml'
import type { ActionRequest, RuleSet } from './types'

const parse = (yaml: string): RuleSet => {
  const r = parseRuleSetYaml(`version: 1\nrules:\n${yaml}`)
  if (!r.ruleSet) throw new Error(JSON.stringify(r.issues))
  return r.ruleSet
}

const SONGS = JSON.stringify([
  { name: 'ワルツ', motion: 'waltz', bgm: 'C:/m/waltz.mp3', offsetSec: 2, volume: 0.7 },
  { name: 'ロック', motion: 'rock', bgm: '' }
])

// ダンス Mod と同じルール(Mod の名前空間つき)
const DANCE_RULES = `  - id: named
    when: { trigger: userMessage, keywords: ["踊って"] }
    do:
      - { action: playDance, songs: "{{slot:songs}}", name: "{{message}}", fallback: "{{rest}}" }
`

function run(text: string, motions: string[], songs = SONGS): ActionRequest[] {
  const engine = new RuleEngine({
    now: () => 0,
    random: () => 0,
    hasMotion: (n) => motions.includes(n),
    registry: FULL_REGISTRY,
    slots: (modId) => (modId === 'dance' ? { songs } : undefined)
  })
  const rs = parse(DANCE_RULES)
  engine.setRuleSet({ ...rs, rules: rs.rules.map((r) => ({ ...r, id: `dance/${r.id}` })) })
  return engine.handle({ type: 'userMessage', text }).fired.flatMap((f) => f.actions)
}

describe('アクション playDance(ダンスの楽曲の表)', () => {
  it('楽曲の名前に合う行のモーションを、BGM つきで再生する', () => {
    expect(run('踊って ワルツ', ['waltz', 'rock'])).toEqual([
      { kind: 'playMotion', motion: 'waltz', bgm: { path: 'C:/m/waltz.mp3', offsetSec: 2, volume: 0.7 }, source: 'dance' }
    ])
  })
  it('「○○を踊って」「踊って ○○を」のような言い方でも合う', () => {
    expect(run('ワルツを踊って', ['waltz'])[0]).toMatchObject({ motion: 'waltz', bgm: { path: 'C:/m/waltz.mp3' } })
    expect(run('踊って ワルツを', ['waltz'])[0]).toMatchObject({ motion: 'waltz' })
  })
  it('BGM が空の行は、モーションだけ', () => {
    const a = run('踊って ロック', ['rock'])
    expect(a).toEqual([{ kind: 'playMotion', motion: 'rock', source: 'dance' }])
  })
  it('表に無い名前は、モーション名として、BGM なしで再生する(従来の動き)', () => {
    expect(run('踊って dance1', ['dance1'])).toEqual([{ kind: 'playMotion', motion: 'dance1', source: 'dance' }])
  })
  it('モーションが登録されていなければ、何もしない', () => {
    expect(run('踊って ワルツ', [])).toEqual([])
    expect(run('踊って タンゴ', ['waltz'])).toEqual([])
  })
  it('表が空・壊れていても、動く(モーション名として扱う)', () => {
    expect(run('踊って waltz', ['waltz'], '')).toEqual([{ kind: 'playMotion', motion: 'waltz', source: 'dance' }])
    expect(run('踊って waltz', ['waltz'], '{broken')).toEqual([{ kind: 'playMotion', motion: 'waltz', source: 'dance' }])
  })
})

describe('アクション playSound(機能 Mod「効果音」)', () => {
  const rs = parse(`  - id: a
    when: { trigger: click }
    do:
      - { action: playSound, name: ぴこん }
`)
  it('Mod「効果音」が OFF なら、使うルールは止まる。ON なら動く', () => {
    expect(analyzeRuleSet(rs, createRegistry([])).get('a')?.map((p) => p.status === 'mod-disabled' && p.modId)).toEqual(['se'])
    expect(analyzeRuleSet(rs, createRegistry(['se'])).size).toBe(0)
  })
  it('名前を、効果音のアクションとして出す。名前が空なら、何もしない', () => {
    const engine = new RuleEngine({ now: () => 0, random: () => 0, registry: createRegistry(['se']) })
    engine.setRuleSet(rs)
    expect(engine.handle({ type: 'click' }).fired.flatMap((f) => f.actions)).toEqual([{ kind: 'playSound', name: 'ぴこん' }])
  })
})
