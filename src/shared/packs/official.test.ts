import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_MOTION_NAMES } from '../motions/builtin'
import { buildSystemPrompt, DEFAULT_CHARACTER } from '../llm/prompt'
import { RuleEngine } from '../rules/engine'
import { effectiveRule } from '../rules/effective'
import { analyzeRuleSet, createRegistry, FULL_REGISTRY } from '../rules/registry'
import type { Rule } from '../rules/types'
import { parsePackYaml, pickManifest, type ParsedPack } from './manifest'
import { resolveSlots, withDefaults } from './slots'

const ROOT = join(__dirname, '../../../resources/mods/official')
const load = (id: string): ParsedPack => {
  const dir = join(ROOT, id)
  const file = pickManifest(Object.fromEntries(readdirSync(dir).map((f) => [f, 1])))!
  const r = parsePackYaml(readFileSync(join(dir, file), 'utf-8'), { category: 'official' })
  expect(r.errors).toEqual([])
  return r.pack!
}

describe('公式に同梱する Mod', () => {
  const ids = readdirSync(ROOT).filter((n) => existsSync(join(ROOT, n)))

  it('すべて検証に通り、フォルダ名が id と一致し、配布用で、素材(モーション)を含まない', () => {
    for (const id of ids) {
      const p = load(id)
      expect(p.id).toBe(id)
      expect(p.distribution).toBe('distributable')
      expect(p.motions).toEqual([])
    }
  })

  it('話しかけ Mod: 機能 talk と結びつき、どのルールにも「話しかけてよいとき」が付き、通信・モーション・素材を含まない', () => {
    const p = load('talk')
    expect(p.feature).toBe('talk')
    expect(p.motions).toEqual([])
    expect(p.script ?? null).toBeNull()
    expect(p.ruleSet.rules.length).toBeGreaterThan(0)
    for (const r of p.ruleSet.rules) expect(r.if.some((c) => c.condition === 'canTalk')).toBe(true)
    // Mod が ON のときは、すべてのルールが使える。OFF のときは、interval / canTalk を使うルールが使えない
    expect(analyzeRuleSet(p.ruleSet, createRegistry(['talk'])).size).toBe(0)
    expect(analyzeRuleSet(p.ruleSet, createRegistry([])).size).toBeGreaterThan(0)
  })

  it('話しかけ(AI)Mod: 話しかけ Mod を必要とし、すべてのルールが、askAi と canTalk を使い、通信・素材を含まない', () => {
    const p = load('talk-ai')
    expect(p.requires).toEqual(['talk'])
    expect(p.script ?? null).toBeNull()
    expect(p.motions).toEqual([])
    for (const r of p.ruleSet.rules) {
      expect(r.if.some((c) => c.condition === 'canTalk')).toBe(true)
      expect(r.do.some((a) => a.action === 'askAi')).toBe(true)
    }
    expect(analyzeRuleSet(p.ruleSet, createRegistry(['talk'])).size).toBe(0)
  })

  it('設定(スロット)を持つ公式 Mod: 初期値のままなら、これまでと同じ値になる(話しかけ・話しかけ(AI))', () => {
    const resolved = (id: string): Map<string, Rule> => {
      const p = load(id)
      const slots = withDefaults(p.slots, undefined)
      return new Map(p.ruleSet.rules.map((r) => [r.id.slice(id.length + 1), effectiveRule(r, (k, t) => FULL_REGISTRY.find(k, t), slots, undefined)]))
    }
    const talk = resolved('talk')
    expect(talk.get('murmur')!.when.everyMin).toBe(30)
    expect(talk.get('idle-talk')!.when.afterSec).toBe(1200)
    expect(talk.get('morning')!.when).toMatchObject({ at: '07:00', until: '10:00' })
    expect(talk.get('noon')!.when).toMatchObject({ at: '12:00', until: '13:30' })
    expect(talk.get('evening')!.when).toMatchObject({ at: '18:00', until: '21:00' })
    expect(talk.get('hello')!.do[0]!.text).toEqual(['おはよう。今日もよろしくね', 'あ、来てくれたんだ', '今日は何をしようか?'])
    expect(talk.get('murmur')!.do[0]!.text).toHaveLength(5)
    const ai = resolved('talk-ai')
    expect(ai.get('ai-murmur')!.when.everyMin).toBe(45)
    expect(ai.get('ai-idle')!.when.afterSec).toBe(1800)
    expect(ai.get('ai-murmur')!.do[0]!.save).toBe(true)
  })

  it('基本 Mod: 初期値のままなら、これまでと同じ値になる', () => {
    const p = load('basic')
    const slots = withDefaults(p.slots, undefined)
    const r = new Map(p.ruleSet.rules.map((x) => [x.id.slice(6), effectiveRule(x, (k, t) => FULL_REGISTRY.find(k, t), slots, undefined)]))
    expect(r.get('startup-greeting')!.do[1]!.text).toEqual(['こんにちは!', 'おはよう!', '今日もよろしくね'])
    expect(r.get('idle-dance')!.when.afterSec).toBe(300)
    expect(r.get('idle-dance')!.if).toEqual([{ condition: 'probability', value: 0.8 }, { condition: 'cooldown', sec: 600 }])
    expect(r.get('word-wave')!.when.keywords).toEqual(['{{slot:wave-words}}']) // 合言葉は、照合のときに展開される
    expect(slots['wave-words']).toBe('手を振って,手ふって,バイバイ,ばいばい')
  })

  it('性格 Mod: 初期値のままなら、放置は 600 秒・間隔 1800 秒・セリフは各 3 つ(これまでと同じ)', () => {
    for (const id of ['persona-cool', 'persona-genki', 'persona-ottori', 'persona-yandere']) {
      const p = load(id)
      const slots = withDefaults(p.slots, undefined)
      const r = new Map(p.ruleSet.rules.map((x) => [x.id.slice(id.length + 1), effectiveRule(x, (k, t) => FULL_REGISTRY.find(k, t), slots, undefined)]))
      expect(r.get('idle')!.when.afterSec).toBe(600)
      expect(r.get('idle')!.if).toEqual([{ condition: 'cooldown', sec: 1800 }])
      expect(r.get('click')!.do[1]!.text).toHaveLength(3)
      expect(r.get('idle')!.do[1]!.text).toHaveLength(3)
    }
  })

  it('状態と感情 Mod: 初期値のままなら、表情 4 秒・感情値 +15・クリックは 40 以上で 20 秒あける(これまでと同じ)', () => {
    const p = load('emotion-state')
    const slots = withDefaults(p.slots, undefined)
    const r = new Map(p.ruleSet.rules.map((x) => [x.id.slice(14), effectiveRule(x, (k, t) => FULL_REGISTRY.find(k, t), slots, undefined)]))
    expect(r.get('joy')!.do).toMatchObject([{ durationSec: 4 }, { delta: 15 }])
    expect(r.get('joyful-click')!.if).toMatchObject([{ condition: 'emotion', name: 'joy', min: 40 }, { condition: 'cooldown', sec: 20 }])
    expect(r.get('joyful-click')!.do[1]!.text).toHaveLength(3)
  })

  it('高度な触れ合い Mod: 初期値のままなら、段階の秒数・突かれる回数・さみしがる条件は、これまでと同じ', () => {
    const p = load('touch-advanced')
    const slots = withDefaults(p.slots, undefined)
    const r = new Map(p.ruleSet.rules.map((x) => [x.id.slice(15), effectiveRule(x, (k, t) => FULL_REGISTRY.find(k, t), slots, undefined)]))
    expect(r.get('pet-head-more')!.when.minSec).toBe(3)
    expect(r.get('pet-head-long')!.when.minSec).toBe(9)
    expect(r.get('poke-annoyed')!.if).toMatchObject([{ condition: 'recentTouches', count: 4, withinSec: 4 }, { condition: 'cooldown', sec: 10 }])
    expect(r.get('lonely')!.when.afterSec).toBe(900)
    expect(r.get('lonely')!.if).toMatchObject([{ condition: 'affection', min: 40 }, { condition: 'cooldown', sec: 1800 }])
    expect(r.get('pet-head-start')!.do[2]!.text).toEqual(['なでなで…', 'えへへ', 'ん…'])
    expect(r.get('pet-hand')!.do[1]!.text).toEqual(['えへへ、手をつなぐの?', 'うれしいな'])
  })

  it('ゲーム Mod: 初期値のままなら、セリフは、これまでと同じ', () => {
    for (const id of ['game', 'game-chess', 'game-connect4', 'game-reversi']) {
      const p = load(id)
      const slots = withDefaults(p.slots, undefined)
      const r = new Map(p.ruleSet.rules.map((x) => [x.id.slice(id.length + 1), effectiveRule(x, (k, t) => FULL_REGISTRY.find(k, t), slots, undefined)]))
      expect((r.get('start')!.do[0]!.text as string[]).length).toBeGreaterThanOrEqual(2)
      expect(r.get('draw')!.do[0]!.text).toContain('引き分けだね')
      expect((r.get('user-lose')!.do[0]!.text as string[]).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('性格 Mod(おっとり・元気・クール・ヤンデレ)は、基本のノードだけで書かれ、Mod がすべて OFF でもルールが動く', () => {
    for (const id of ['persona-ottori', 'persona-genki', 'persona-cool', 'persona-yandere']) {
      const p = load(id)
      expect(p.prompt?.layer).toBe('persona')
      expect(p.ruleSet.rules.length).toBeGreaterThan(0)
      expect(analyzeRuleSet(p.ruleSet, createRegistry([])).size).toBe(0)
    }
  })

  it('ヤンデレの指示文は、暴力・脅し・自傷を禁じ、つらそうなときは心配するよう指示している', () => {
    const t = load('persona-yandere').prompt!.text
    for (const w of ['暴力', '脅し', '自傷', '心配']) expect(t).toContain(w)
  })

  it('性格 Mod を重ねると、システムプロンプトに、順に入る', () => {
    const a = load('persona-ottori').prompt!.text
    const b = load('persona-cool').prompt!.text
    const p = buildSystemPrompt(DEFAULT_CHARACTER, [a, b])
    expect(p.indexOf('おっとり')).toBeLessThan(p.indexOf('クール'))
  })

  it('ダンス Mod: 「踊って ワルツ」「ワルツを踊って」で、ワルツが再生される。名前が無ければ、セリフだけ', () => {
    const p = load('dance')
    const rs = p.ruleSet
    const slots = { 'start-words': '踊って,ダンスして,おどって', 'stop-words': 'ストップ,中止', songs: '' }
    const mk = (names: string[]) => new RuleEngine({ now: () => 1, random: () => 0, hasMotion: (n) => names.includes(n), slots: () => slots }, rs)
    expect(mk(['ワルツ']).handle({ type: 'userMessage', text: 'ワルツを踊って' }).fired[0].actions[1]).toMatchObject({ motion: 'ワルツ' })
    expect(mk(['ワルツ']).handle({ type: 'userMessage', text: 'ワルツを踊って!' }).fired[0].actions[1]).toMatchObject({ motion: 'ワルツ' })
    const r = mk(['ワルツ']).handle({ type: 'userMessage', text: '踊って ワルツ' })
    expect(r.consumed).toBe(true)
    expect(r.fired[0].actions.map((a) => a.kind)).toEqual(['say', 'playMotion'])
    expect(r.fired[0].actions[1]).toMatchObject({ motion: 'ワルツ' })
    expect(mk([]).handle({ type: 'userMessage', text: '踊って ワルツ' }).fired[0].actions.map((a) => a.kind)).toEqual(['say'])
  })
})

describe('ダンス Mod: 止める言葉・始める言葉(設定項目)', () => {
  const p = load('dance')
  const engineWith = (slots: Record<string, string>, names: string[] = ['ワルツ']) =>
    new RuleEngine({ now: () => 1, random: () => 0, hasMotion: (n) => names.includes(n), slots: () => slots }, p.ruleSet)
  const defaults = resolveSlots(p.slots, undefined, undefined)

  it('「ストップ」「中止」などで、モーションと BGM を止める(AI には送らない)', () => {
    for (const text of ['ストップ', 'ストップ!', '中止して', 'ダンスを止めて', '踊るのをやめて', '曲を止めて']) {
      const r = engineWith(defaults).handle({ type: 'userMessage', text })
      expect(r.consumed).toBe(true)
      expect(r.fired.map((f) => f.ruleId)).toEqual(['dance/stop'])
      expect(r.fired[0].actions[0]).toMatchObject({ kind: 'stopMotion', bgm: true })
    }
  })

  it('始める言葉の既定でも、「ワルツを踊って」「踊って ワルツ」が動く。ふだんの会話は消費しない', () => {
    expect(engineWith(defaults).handle({ type: 'userMessage', text: 'ワルツを踊って' }).fired[0].actions[1]).toMatchObject({ motion: 'ワルツ' })
    expect(engineWith(defaults).handle({ type: 'userMessage', text: '踊って ワルツ' }).fired[0].actions[1]).toMatchObject({ motion: 'ワルツ' })
    const chat = engineWith(defaults).handle({ type: 'userMessage', text: '今日はいい天気だね' })
    expect(chat.consumed).toBe(false)
  })

  it('言葉は設定で変えられる(カンマ区切りで複数)。空にすると、その動きは無効', () => {
    const custom = { ...defaults, 'stop-words': 'おしまい,終わり', 'start-words': '踊れ' }
    expect(engineWith(custom).handle({ type: 'userMessage', text: 'おしまい' }).fired[0].ruleId).toBe('dance/stop')
    expect(engineWith(custom).handle({ type: 'userMessage', text: 'ストップ' }).fired).toEqual([])
    expect(engineWith(custom).handle({ type: 'userMessage', text: 'ワルツを踊れ' }).fired[0].actions[1]).toMatchObject({ motion: 'ワルツ' })
    expect(engineWith({ ...defaults, 'stop-words': '' }).handle({ type: 'userMessage', text: 'ストップ' }).fired).toEqual([])
  })
})

describe('ゲーム基本 Mod(○×)', () => {
  const p = load('game')
  const slots = { 'start-words': 'まるばつ,三目並べ' }
  const engine = (features: string[]) =>
    new RuleEngine({ now: () => 1, random: () => 0, hasMotion: () => true, registry: createRegistry(features), slots: () => slots }, p.ruleSet)

  it('機能 Mod「ゲーム」を使う。OFF の間は止まり、ON なら動く', () => {
    expect(p.feature).toBe('game')
    expect(analyzeRuleSet(p.ruleSet, createRegistry([])).size).toBeGreaterThan(0)
    expect(analyzeRuleSet(p.ruleSet, createRegistry(['game'])).size).toBe(0)
  })

  it('「まるばつしよう」でゲームが始まる(AI には送らない)。ふだんの会話は、そのまま', () => {
    const r = engine(['game']).handle({ type: 'userMessage', text: 'まるばつしよう' })
    expect(r.consumed).toBe(true)
    expect(r.fired[0].actions.map((a) => a.kind)).toEqual(['say', 'startGame'])
    expect(engine(['game']).handle({ type: 'userMessage', text: '今日はいい天気' }).consumed).toBe(false)
    expect(engine([]).handle({ type: 'userMessage', text: 'まるばつしよう' }).fired).toEqual([])
  })

  it('手・結果に、キャラが反応する(勝ち・負け・引き分けで、別のルール)', () => {
    const e = (event: Parameters<ReturnType<typeof engine>['handle']>[0]) => engine(['game']).handle(event).fired.map((f) => f.ruleId)
    expect(e({ type: 'gameMove', who: 'char', game: 'tictactoe' })).toEqual(['game/char-move'])
    expect(e({ type: 'gameMove', who: 'user', game: 'tictactoe' })).toEqual([])
    expect(e({ type: 'gameResult', result: 'win', game: 'tictactoe' })).toEqual(['game/user-win'])
    expect(e({ type: 'gameResult', result: 'lose', game: 'tictactoe' })).toEqual(['game/user-lose'])
    expect(e({ type: 'gameResult', result: 'draw', game: 'tictactoe' })).toEqual(['game/draw'])
  })

  it('○× の Mod の反応は、○× の手・結果にだけ動く(ほかのゲームでは、動かない)', () => {
    expect(engine(['game']).handle({ type: 'gameMove', who: 'char', game: 'chess' }).fired).toEqual([])
    expect(engine(['game']).handle({ type: 'gameResult', result: 'win', game: 'connect4' }).fired).toEqual([])
  })
})

describe('ゲームごとの公式 Mod(コネクト 4・リバーシ・チェス)', () => {
  const cases: Array<{ id: string; game: 'connect4' | 'reversi' | 'chess'; words: string; say: string; text: string }> = [
    { id: 'game-connect4', game: 'connect4', words: 'コネクト4,四目並べ', say: 'コネクト4しよう', text: 'もうひとつ遊ぼう' },
    { id: 'game-reversi', game: 'reversi', words: 'リバーシ,オセロ', say: 'オセロしよう', text: 'もうひとつ遊ぼう' },
    { id: 'game-chess', game: 'chess', words: 'チェス', say: 'チェスしよう', text: 'もうひとつ遊ぼう' }
  ]
  for (const c of cases) {
    const p = load(c.id)
    const engine = (features: string[]) => new RuleEngine({ now: () => 1, random: () => 0, hasMotion: () => true, registry: createRegistry(features), slots: () => ({ 'start-words': c.words }) }, p.ruleSet)

    it(`${c.id}: 機能 Mod と結びつき、OFF の間は止まり、ON なら動く。始める言葉でゲーム(${c.game})を始める`, () => {
      expect(p.feature).toBe(c.id)
      expect(analyzeRuleSet(p.ruleSet, createRegistry([])).size).toBeGreaterThan(0)
      expect(analyzeRuleSet(p.ruleSet, createRegistry([c.id])).size).toBe(0)
      const r = engine([c.id]).handle({ type: 'userMessage', text: c.say })
      expect(r.consumed).toBe(true)
      expect(r.fired[0].actions.map((a) => a.kind)).toEqual(['say', 'startGame'])
      expect(r.fired[0].actions[1]).toMatchObject({ kind: 'startGame', game: c.game })
      expect(engine([c.id]).handle({ type: 'userMessage', text: c.text }).consumed).toBe(false)
    })

    it(`${c.id}: 手・結果に反応する。自分のゲームだけ(○× や、ほかのゲームでは、動かない)`, () => {
      const e = (event: Parameters<ReturnType<typeof engine>['handle']>[0]) => engine([c.id]).handle(event).fired.map((f) => f.ruleId)
      expect(e({ type: 'gameMove', who: 'char', game: c.game })).toEqual([`${c.id}/char-move`])
      expect(e({ type: 'gameResult', result: 'win', game: c.game })).toEqual([`${c.id}/user-win`])
      expect(e({ type: 'gameResult', result: 'lose', game: c.game })).toEqual([`${c.id}/user-lose`])
      expect(e({ type: 'gameResult', result: 'draw', game: c.game })).toEqual([`${c.id}/draw`])
      expect(e({ type: 'gameMove', who: 'char', game: 'tictactoe' })).toEqual([])
    })
  }

  it('ゲームの Mod が複数 ON でも、トリガー・アクションは使える(どれか 1 つが ON なら出る)', () => {
    const rs = load('game-chess').ruleSet
    expect(analyzeRuleSet(rs, createRegistry(['game-chess'])).size).toBe(0)
    expect(analyzeRuleSet(rs, createRegistry(['game-reversi'])).size).toBe(0) // 別のゲームの Mod だけでも、ゲームのトリガー・アクションの種類は、使える(Mod のルールを動かすかは、Mod の ON/OFF で決まる)
  })
})

describe('公式の性格 Mod のスロット', () => {
  it('クリック・放置のモーションは、スロットで選ぶ(空のままなら、モーションは再生されない)', () => {
    for (const id of ['persona-ottori', 'persona-genki', 'persona-cool', 'persona-yandere']) {
      const p = load(id)
      expect(p.slots.filter((s) => s.kind === 'motion').map((s) => s.id)).toEqual(['tap-motion', 'idle-motion'])
      const e = new RuleEngine({ now: () => 1, random: () => 0, hasMotion: (n) => n === 'wave', slots: () => ({ 'tap-motion': 'wave' }) }, p.ruleSet)
      const click = e.handle({ type: 'click' }).fired[0].actions.map((a) => a.kind)
      expect(click).toEqual(['playMotion', 'say'])
      const empty = new RuleEngine({ now: () => 1, random: () => 0, hasMotion: () => true, slots: () => ({}) }, p.ruleSet)
      expect(empty.handle({ type: 'click' }).fired[0].actions.map((a) => a.kind)).toEqual(['say'])
    }
  })
})

describe('公式の「感情反応」Mod', () => {
  it('機能 Mod「状態と感情」を使う。OFF の間は止まり、ON なら感情タグに反応する', () => {
    const p = load('emotion-state')
    expect(p.feature).toBe('emotion-state')
    expect(analyzeRuleSet(p.ruleSet, createRegistry([])).size).toBeGreaterThan(0)
    expect(analyzeRuleSet(p.ruleSet, createRegistry(['emotion-state'])).size).toBe(0)
    const e = new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry(['emotion-state']), runtime: () => ({ modes: new Set(), emotion: () => 0 }) }, p.ruleSet)
    const r = e.handle({ type: 'llmEmotion', emotion: 'joy' })
    expect(r.fired.map((f) => f.ruleId)).toEqual(['emotion-state/joy'])
    expect(r.fired[0].actions.map((a) => a.kind)).toEqual(['setExpression', 'changeEmotion'])
    expect(r.fired[0].actions[0]).toMatchObject({ source: 'emotion-state' })
  })
})

describe('公式の「基本」Mod', () => {
  const p = load('basic')

  it('読め、機能 Mod が すべて OFF でも、止まるルールがない', () => {
    expect(p.ruleSet.rules.length).toBeGreaterThan(0)
    expect(analyzeRuleSet(p.ruleSet, createRegistry([])).size).toBe(0)
  })

  it('使うモーションは、すべて内蔵モーション', () => {
    for (const r of p.ruleSet.rules) for (const a of r.do) if (typeof a.motion === 'string') expect(BUILTIN_MOTION_NAMES).toContain(a.motion)
  })
})
