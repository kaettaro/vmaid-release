import { describe, expect, it } from 'vitest'
import { BUILTIN_MOTION_TAGS } from '../motions/builtin'
import { ACTIONS, CONDITIONS, TRIGGERS } from './definitions'
import { normalizeText, RuleEngine, type EngineEnv } from './engine'
import { PRESET_RULES_YAML } from './presets'
import { parseRuleSet } from './schema'
import { formatIssue, parseRuleSetYaml, stringifyRuleSet } from './yaml'
import type { RuleSet } from './types'

const yamlOf = (rules: string): string => `version: 1\nrules:\n${rules}`
const load = (text: string): RuleSet => {
  const r = parseRuleSetYaml(text)
  expect(r.issues.map(formatIssue)).toEqual([])
  return r.ruleSet!
}

// ---------------------------------------------------------------- 定義レジストリ
describe('定義レジストリ', () => {
  it('種類名が重複せず、すべて日本語ラベルを持つ(GUIフォームの自動生成に使える)', () => {
    for (const defs of [TRIGGERS, CONDITIONS, ACTIONS]) {
      expect(new Set(defs.map((d) => d.type)).size).toBe(defs.length)
      for (const d of defs) {
        expect(d.label).not.toBe('')
        for (const p of d.params) expect(p.label).not.toBe('')
      }
    }
  })
  it('初版のトリガー・条件・アクションがそろっている(SPEC 6.2 + トリガーワード)', () => {
    expect(TRIGGERS.map((d) => d.type)).toEqual(
      expect.arrayContaining(['idle', 'click', 'hold', 'stroke', 'strokeEnd', 'startup', 'timeOfDay', 'replyDone', 'userMessage'])
    )
    expect(CONDITIONS.map((d) => d.type)).toEqual(['canTalk', 'probability', 'cooldown', 'recentTouches', 'affection', 'mood', 'state', 'emotion'])
    expect(ACTIONS.map((d) => d.type)).toEqual(['playMotion', 'setExpression', 'applyPreset', 'revertPreset', 'resetLook', 'wait', 'changeAffection', 'setMood', 'say', 'askAi', 'startState', 'endState', 'setEmotion', 'changeEmotion', 'playDance',
      'startGame', 'stopGame', 'stopMotion', 'playSound', 'showProp', 'hideProp', 'showOverlay', 'hideOverlay', 'moveTo', 'stopMove'])
  })
})

// ---------------------------------------------------------------- 検証
describe('検証と正規化', () => {
  it('SPECの例がそのまま読め、既定値が補われる', () => {
    const rs = load(`version: 1
rules:
  - id: idle-dance
    enabled: true
    when: { trigger: idle, afterSec: 300 }
    if:
      - { condition: probability, value: 0.8 }
      - { condition: cooldown, sec: 600 }
    do:
      - { action: playMotion, tag: ダンス, pick: random }
`)
    expect(rs.rules[0].do[0]).toEqual({ action: 'playMotion', tag: 'ダンス', pick: 'random' })
    expect(rs.rules[0].when).toEqual({ trigger: 'idle', afterSec: 300 })
    expect(rs.rules[0].if).toHaveLength(2)
  })
  it('省略した項目は定義の既定値になる(enabled=true、pick=random、match=contains…)', () => {
    const rs = load(yamlOf(`  - id: a
    when: { trigger: userMessage, keywords: ダンスして }
    do: [{ action: playMotion, tag: g }, { action: setExpression, name: happy }]
`))
    const r = rs.rules[0]
    expect(r.enabled).toBe(true)
    expect(r.when).toEqual({ trigger: 'userMessage', keywords: ['ダンスして'], match: 'contains', passToLlm: false })
    expect(r.do[0]).toEqual({ action: 'playMotion', tag: 'g', pick: 'random' })
    expect(r.do[1]).toEqual({ action: 'setExpression', name: 'happy', value: 1, durationSec: 3 })
  })
  it('不正な値は、場所と理由つきのエラーになり、複数まとめて返る', () => {
    const r = parseRuleSetYaml(yamlOf(`  - id: bad id!
    when: { trigger: idle, afterSec: -5 }
    if: [{ condition: probability, value: 2 }]
    do: [{ action: say }]
  - id: x
    when: { trigger: nothing }
    do: []
`))
    expect(r.ruleSet).toBeNull()
    const msgs = r.issues.map((i) => i.message).join('\n')
    expect(msgs).toContain('id は英数字')
    expect(msgs).toContain('1 以上')
    expect(msgs).toContain('1 以下')
    expect(msgs).toContain('必須')
    expect(msgs).toContain('「nothing」という種類はありません')
    expect(msgs).toContain('1つ以上')
    expect(r.issues.length).toBeGreaterThanOrEqual(5)
  })
  it('打ち間違いのキー(未知の項目)はエラー。使える項目が示される', () => {
    const r = parseRuleSetYaml(yamlOf(`  - id: a
    when: { trigger: idle, afterSecs: 300 }
    do: [{ action: say, text: hi }]
`))
    expect(r.ruleSet).toBeNull()
    expect(r.issues[0].message).toContain('afterSecs')
    expect(r.issues[0].message).toContain('afterSec')
  })
  it('playMotion は motion か tag のどちらか1つ', () => {
    expect(parseRuleSetYaml(yamlOf(`  - id: a\n    when: { trigger: click }\n    do: [{ action: playMotion }]\n`)).ruleSet).toBeNull()
    expect(parseRuleSetYaml(yamlOf(`  - id: a\n    when: { trigger: click }\n    do: [{ action: playMotion, motion: a, tag: g }]\n`)).ruleSet).toBeNull()
  })
  it('旧形式の group は、タグへの変更を知らせるエラーになる。motionGroups も同様', () => {
    const g = parseRuleSetYaml(yamlOf(`  - id: a\n    when: { trigger: click }\n    do: [{ action: playMotion, group: g }]\n`))
    expect(g.ruleSet).toBeNull()
    expect(g.issues.map(formatIssue).join('\n')).toContain('タグに変わっています')
    const m = parseRuleSetYaml('version: 1\nmotionGroups: { g: [a] }\nrules: []\n')
    expect(m.ruleSet).toBeNull()
    expect(m.issues.map(formatIssue).join('\n')).toContain('廃止されました')
  })
  it('tag は、1〜30文字のタグ。カンマ・空は不可', () => {
    const base = (tag: string): string => yamlOf(`  - id: a\n    when: { trigger: click }\n    do: [{ action: playMotion, tag: "${tag}" }]\n`)
    expect(parseRuleSetYaml(base('ダンス')).ruleSet).not.toBeNull()
    expect(parseRuleSetYaml(base('a,b')).ruleSet).toBeNull()
    expect(parseRuleSetYaml(base('x'.repeat(31))).ruleSet).toBeNull()
    expect(parseRuleSetYaml(base('')).ruleSet).toBeNull()
  })
  it('ルールに tags(整理用のタグ)を付けられる。重複は1つにまとまり、不正なら、エラー', () => {
    const ok = load(yamlOf(`  - id: a\n    tags: [朝, あいさつ, 朝]\n    when: { trigger: click }\n    do: [{ action: say, text: x }]\n`))
    expect(ok.rules[0].tags).toEqual(['朝', 'あいさつ'])
    expect(load(yamlOf(`  - id: a\n    tags: []\n    when: { trigger: click }\n    do: [{ action: say, text: x }]\n`)).rules[0].tags).toBeUndefined()
    for (const bad of ['tags: x', 'tags: ["a,b"]', 'tags: [1]']) {
      expect(parseRuleSetYaml(yamlOf(`  - id: a\n    ${bad}\n    when: { trigger: click }\n    do: [{ action: say, text: x }]\n`)).ruleSet).toBeNull()
    }
  })
  it('idが重複するとエラー', () => {
    const r = parseRuleSetYaml(yamlOf(`  - { id: a, when: { trigger: click }, do: [{ action: say, text: x }] }\n  - { id: a, when: { trigger: click }, do: [{ action: say, text: y }] }\n`))
    expect(r.issues.some((i) => i.message.includes('重複'))).toBe(true)
  })
  it('時刻は HH:MM、列挙は選択肢のどれか', () => {
    expect(parseRuleSetYaml(yamlOf(`  - { id: a, when: { trigger: timeOfDay, at: "25:00" }, do: [{ action: say, text: x }] }\n`)).ruleSet).toBeNull()
    expect(parseRuleSetYaml(yamlOf(`  - { id: a, when: { trigger: userMessage, keywords: [x], match: regex }, do: [{ action: say, text: x }] }\n`)).ruleSet).toBeNull()
  })
  it('version が違う・最上位が不正・rules が無い、でもクラッシュせずエラーを返す', () => {
    expect(parseRuleSet(null).ruleSet).toBeNull()
    expect(parseRuleSet({ version: 2, rules: [] }).issues[0].path).toBe('version')
    expect(parseRuleSet({ version: 1 }).issues.some((i) => i.path === 'rules')).toBe(true)
    expect(parseRuleSet([]).ruleSet).toBeNull()
  })
})

// ---------------------------------------------------------------- YAML
describe('YAML', () => {
  it('YAMLの構文エラーは、行番号つきで返り、適用されない', () => {
    const r = parseRuleSetYaml('version: 1\nrules:\n  - id: a\n   when: {')
    expect(r.ruleSet).toBeNull()
    expect(r.issues[0].line).toBeGreaterThanOrEqual(3)
    expect(r.issues[0].message).toContain('YAML')
  })
  it('検証エラーにも、該当する行番号が付く', () => {
    const text = `version: 1
rules:
  - id: a
    when: { trigger: click }
    do:
      - { action: say, text: ok }
  - id: b
    when: { trigger: idle, afterSec: 0 }
    do:
      - { action: say, text: ok }
`
    const r = parseRuleSetYaml(text)
    const issue = r.issues.find((i) => i.path.endsWith('afterSec'))!
    expect(issue.line).toBe(8)
    expect(formatIssue(issue)).toContain('8行目')
  })
  it('idle の秒数が上限(1日=86400秒)を超えるとエラー', () => {
    const r = parseRuleSetYaml(yamlOf(say('x', '{ trigger: idle, afterSec: 99999 }')))
    expect(r.ruleSet).toBeNull()
    expect(r.issues[0].message).toContain('86400 以下')
  })
  it('空のファイルや、コメントだけのファイルはエラーになる(落ちない)', () => {
    expect(parseRuleSetYaml('').ruleSet).toBeNull()
    expect(parseRuleSetYaml('# コメントだけ').ruleSet).toBeNull()
  })
  it('読み込んだルールをYAMLに戻して、もう一度読んでも同じになる(GUI編集の保存)', () => {
    const rs = load(PRESET_RULES_YAML)
    expect(load(stringifyRuleSet(rs))).toEqual(rs)
  })
  it('キーの重複はエラー(後勝ちで静かに上書きされない)', () => {
    expect(parseRuleSetYaml('version: 1\nversion: 1\nrules: []').ruleSet).toBeNull()
  })
})

// ---------------------------------------------------------------- プリセット
describe('プリセットのルール', () => {
  it('そのまま読め、7つのルールがあり、モーションをタグで選ぶルールがある', () => {
    const rs = load(PRESET_RULES_YAML)
    expect(rs.rules.map((r) => r.id)).toEqual(['startup-greeting', 'click-react', 'touch-head', 'touch-hand', 'touch-belly', 'idle-dance', 'word-wave'])
    const tags = rs.rules.flatMap((r) => r.do.flatMap((a) => (typeof a.tag === 'string' ? [a.tag] : [])))
    expect(tags).toEqual(expect.arrayContaining(['リアクション', 'ダンス']))
    expect(rs.rules.every((r) => r.enabled)).toBe(true)
  })
  it('プリセットが使うモーションは、すべて内蔵モーションの名前になっている', async () => {
    const { BUILTIN_MOTION_NAMES } = await import('../motions/builtin')
    const rs = load(PRESET_RULES_YAML)
    const used = new Set<string>()
    for (const r of rs.rules) for (const a of r.do) if (typeof a.motion === 'string') used.add(a.motion)
    for (const m of used) expect(BUILTIN_MOTION_NAMES).toContain(m)
    // タグで選ぶものは、そのタグが付いた内蔵モーションが、あること
    const { BUILTIN_MOTION_TAGS } = await import('../motions/builtin')
    const have = new Set(Object.values(BUILTIN_MOTION_TAGS).flat())
    for (const r of rs.rules) for (const a of r.do) if (typeof a.tag === 'string') expect(have.has(a.tag)).toBe(true)
  })
})

// ---------------------------------------------------------------- エンジン
function makeEnv(start = new Date(2026, 9, 14, 10, 0, 0).getTime()) {
  const state = { t: start, rand: 0 }
  const env: EngineEnv & { advance(sec: number): void } = {
    now: () => state.t,
    random: () => state.rand,
    // 内蔵モーションのタグ(リアクション・ダンスなど)で、タグを解決する
    motionsWithTag: (t) => Object.entries(BUILTIN_MOTION_TAGS).filter(([, tags]) => tags.includes(t)).map(([n]) => n),
    advance: (sec) => void (state.t += sec * 1000)
  }
  return { env, state }
}
const engineOf = (text: string, env: EngineEnv): RuleEngine => new RuleEngine(env, load(text))
const say = (id: string, when: string, extra = ''): string =>
  `  - id: ${id}\n    when: ${when}\n${extra}    do: [{ action: say, text: "${id}" }]\n`
const firedIds = (r: { fired: Array<{ ruleId: string }> }): string[] => r.fired.map((f) => f.ruleId)

describe('RuleEngine: イベントのトリガー', () => {
  it('startup / click / replyDone は、対応するイベントでだけ発火する', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf(say('s', '{ trigger: startup }') + say('c', '{ trigger: click }') + say('r', '{ trigger: replyDone }')), env)
    expect(firedIds(e.handle({ type: 'startup' }))).toEqual(['s'])
    expect(firedIds(e.handle({ type: 'click' }))).toEqual(['c'])
    expect(firedIds(e.handle({ type: 'replyDone' }))).toEqual(['r'])
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([])
  })
  it('enabled: false のルールは発火しない', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf(say('a', '{ trigger: click }', '    enabled: false\n')), env)
    expect(firedIds(e.handle({ type: 'click' }))).toEqual([])
  })
  it('同じイベントに一致するルールは、すべて(上から順に)発火する', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf(say('a', '{ trigger: click }') + say('b', '{ trigger: click }')), env)
    expect(firedIds(e.handle({ type: 'click' }))).toEqual(['a', 'b'])
  })
})

describe('RuleEngine: idle(放置)', () => {
  const text = yamlOf(say('idle', '{ trigger: idle, afterSec: 300 }'))
  it('指定秒数の放置で発火し、同じ放置期間では1回だけ', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    env.advance(299)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([])
    env.advance(2)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['idle'])
    env.advance(1000)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([]) // 同じ放置期間では再発火しない
  })
  it('操作(activity)で放置時間がリセットされ、再び放置すると、もう一度発火できる', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    env.advance(301)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['idle'])
    env.advance(100)
    e.handle({ type: 'activity' })
    env.advance(250)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([]) // リセットから250秒
    env.advance(60)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['idle'])
  })
  it('確率で外れたときは発火せず、同じ放置期間のうちに、あとから発火できる(外れ=発火ではない)', () => {
    const { env, state } = makeEnv()
    const e = engineOf(yamlOf(say('idle', '{ trigger: idle, afterSec: 10 }', '    if: [{ condition: probability, value: 0.5 }]\n')), env)
    env.advance(11)
    state.rand = 0.9 // 外れ
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([])
    state.rand = 0.1 // 当たり
    env.advance(1)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['idle'])
  })
})

describe('RuleEngine: interval(N 分ごと)と、話しかけ控え(canTalk)', () => {
  const text = yamlOf(say('talk', '{ trigger: interval, everyMin: 10 }', '    if: [{ condition: canTalk }]\n'))
  it('起動した(ルールを見つけた)直後には動かず、N 分ごとに動く', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([]) // 最初の tick で、数え始める
    env.advance(599)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([])
    env.advance(2)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['talk'])
    env.advance(300)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([]) // 動いた時刻から、また数える
    env.advance(301)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['talk'])
  })
  it('放置・操作とは関係なく動く(activity で、数え直さない)', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    e.handle({ type: 'tick' })
    env.advance(400)
    e.handle({ type: 'activity' })
    env.advance(201)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['talk'])
  })
  it('canTalk: 控えるときは動かず(間隔の時刻は、そのまま)、許されたとたんに動く。動いたら、1 回の話しかけとして数える', () => {
    const { env } = makeEnv()
    let allowed = false
    let spoke = 0
    env.talk = { allowed: () => allowed, spoke: () => void (spoke += 1) }
    const e = engineOf(text, env)
    e.handle({ type: 'tick' })
    env.advance(601)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([]) // 控え中
    expect(spoke).toBe(0)
    allowed = true
    env.advance(5)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['talk'])
    expect(spoke).toBe(1)
  })
  it('canTalk の無いルールは、話しかけとして数えない。env.talk が無ければ、canTalk は常に通る', () => {
    const { env } = makeEnv()
    let spoke = 0
    env.talk = { allowed: () => true, spoke: () => void (spoke += 1) }
    const e = engineOf(yamlOf(say('plain', '{ trigger: click }')), env)
    e.handle({ type: 'click' })
    expect(spoke).toBe(0)
    const { env: env2 } = makeEnv()
    const e2 = engineOf(text, env2)
    e2.handle({ type: 'tick' })
    env2.advance(601)
    expect(firedIds(e2.handle({ type: 'tick' }))).toEqual(['talk'])
  })
})

describe('RuleEngine: askAi(AI に頼んで言う)', () => {
  it('指示文を展開して、askAi のアクションにする(save の既定は true)', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf("  - id: a\n    when: { trigger: userMessage, keywords: [AIに頼んで] }\n    do: [{ action: askAi, instruction: \"次のことを、話しかけて: {{rest}}\" }]\n"), env)
    const r = e.handle({ type: 'userMessage', text: 'AIに頼んで 天気' })
    expect(r.fired[0]?.actions).toEqual([{ kind: 'askAi', instruction: '次のことを、話しかけて: 天気', save: true }])
  })
  it('save: false・指示が空のとき(空なら、何も出さない)', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf("  - id: a\n    when: { trigger: click }\n    do: [{ action: askAi, instruction: x, save: false }]\n"), env)
    expect(e.handle({ type: 'click' }).fired[0]?.actions).toEqual([{ kind: 'askAi', instruction: 'x', save: false }])
  })
})

describe('RuleEngine: 条件', () => {
  it('probability: 乱数が確率未満のときだけ発火(0なら常に外れ、1なら常に当たり)', () => {
    const { env, state } = makeEnv()
    const e = engineOf(yamlOf(say('p', '{ trigger: click }', '    if: [{ condition: probability, value: 0.3 }]\n') + say('z', '{ trigger: click }', '    if: [{ condition: probability, value: 0 }]\n') + say('o', '{ trigger: click }', '    if: [{ condition: probability, value: 1 }]\n')), env)
    state.rand = 0.29
    expect(firedIds(e.handle({ type: 'click' }))).toEqual(['p', 'o'])
    state.rand = 0.3
    expect(firedIds(e.handle({ type: 'click' }))).toEqual(['o'])
  })
  it('cooldown: 発火後、指定秒数が過ぎるまで発火しない。確率で外れた回はクールダウンを消費しない', () => {
    const { env, state } = makeEnv()
    const e = engineOf(yamlOf(say('c', '{ trigger: click }', '    if: [{ condition: probability, value: 0.5 }, { condition: cooldown, sec: 60 }]\n')), env)
    state.rand = 0.9 // 外れ
    expect(firedIds(e.handle({ type: 'click' }))).toEqual([])
    state.rand = 0.1 // 当たり → 発火
    expect(firedIds(e.handle({ type: 'click' }))).toEqual(['c'])
    env.advance(59)
    expect(firedIds(e.handle({ type: 'click' }))).toEqual([]) // クールダウン中
    env.advance(2)
    expect(firedIds(e.handle({ type: 'click' }))).toEqual(['c'])
  })
  it('ルールを編集(差し替え)しても、同じidのクールダウンは引き継がれる', () => {
    const { env } = makeEnv()
    const text = yamlOf(say('c', '{ trigger: click }', '    if: [{ condition: cooldown, sec: 60 }]\n'))
    const e = engineOf(text, env)
    e.handle({ type: 'click' })
    e.setRuleSet(load(text))
    env.advance(10)
    expect(firedIds(e.handle({ type: 'click' }))).toEqual([])
  })
})

describe('RuleEngine: timeOfDay(時刻・時間帯)', () => {
  const at = (h: number, m: number): number => new Date(2026, 9, 14, h, m, 0).getTime()
  it('指定時刻以降の最初のtickで、1日1回だけ発火する', () => {
    const { env, state } = makeEnv(at(11, 59))
    const e = engineOf(yamlOf(say('noon', '{ trigger: timeOfDay, at: "12:00" }')), env)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([])
    state.t = at(12, 0)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['noon'])
    state.t = at(12, 1)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([]) // 同じ日は1回だけ
    state.t = at(12, 0) + 24 * 3600 * 1000
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['noon']) // 翌日はまた発火
  })
  it('時間帯(at〜until)の中でだけ発火し、外では発火しない', () => {
    const { env, state } = makeEnv(at(8, 0))
    const e = engineOf(yamlOf(say('morning', '{ trigger: timeOfDay, at: "06:00", until: "09:00" }')), env)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['morning'])
    state.t = at(9, 30) + 24 * 3600 * 1000
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([]) // 翌日の時間帯の外
  })
  it('日をまたぐ時間帯(22:00〜02:00)で、夜と明け方を同じ「1日」として1回だけ発火する', () => {
    const { env, state } = makeEnv(at(21, 0))
    const e = engineOf(yamlOf(say('night', '{ trigger: timeOfDay, at: "22:00", until: "02:00" }')), env)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([])
    state.t = at(23, 0)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['night'])
    state.t = at(1, 0) + 24 * 3600 * 1000 // 翌日の午前1時(同じ夜の続き)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual([])
    state.t = at(23, 0) + 24 * 3600 * 1000 // 翌日の夜はまた
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['night'])
  })
})

describe('RuleEngine: トリガーワード(userMessage)', () => {
  const text = yamlOf(`  - id: dance
    when: { trigger: userMessage, keywords: ["ダンスして", "踊って"] }
    do: [{ action: say, text: "いくよ" }]
  - id: exact
    when: { trigger: userMessage, keywords: ["おはよう"], match: equals }
    do: [{ action: say, text: "おはよう!" }]
  - id: pass
    when: { trigger: userMessage, keywords: ["天気"], passToLlm: true }
    do: [{ action: say, text: "天気ね" }]
`)
  it('「ダンスしてくれる?」のように言葉の続きがあっても、含まれていれば一致する', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    expect(firedIds(e.handle({ type: 'userMessage', text: 'ねえ、ダンスしてくれる?' }))).toEqual(['dance'])
  })
  it('「ダンスして」を含む文で一致する(前後に別の言葉があってもよい)', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    const r = e.handle({ type: 'userMessage', text: 'ちょっと、ダンスしてよ' })
    expect(firedIds(r)).toEqual(['dance'])
    expect(r.consumed).toBe(true)
    expect(firedIds(e.handle({ type: 'userMessage', text: '踊って!' }))).toEqual(['dance'])
  })
  it('全角・半角・大文字小文字・空白・記号の違いを吸収する', () => {
    expect(normalizeText('ＤＡＮＣＥ　して！')).toBe('danceして')
    expect(normalizeText('ダンス して…')).toBe('ダンスして')
    const { env } = makeEnv()
    const e = engineOf(text, env)
    expect(firedIds(e.handle({ type: 'userMessage', text: 'ダ ン ス し て ！！' }))).toEqual(['dance'])
  })
  it('equals は完全一致のときだけ', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    expect(firedIds(e.handle({ type: 'userMessage', text: 'おはよう' }))).toEqual(['exact'])
    expect(firedIds(e.handle({ type: 'userMessage', text: 'おはようございます' }))).toEqual([])
  })
  it('passToLlm: true のルールは、アクションを実行しつつ、AIにも送る(consumed しない)', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    const r = e.handle({ type: 'userMessage', text: '今日の天気は?' })
    expect(firedIds(r)).toEqual(['pass'])
    expect(r.consumed).toBe(false)
  })
  it('一致しない入力、空の入力は何も発火せず、AIに送る', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    for (const t of ['こんにちは', '', '   ', '！！！']) {
      const r = e.handle({ type: 'userMessage', text: t })
      expect(r.fired).toEqual([])
      expect(r.consumed).toBe(false)
    }
  })
  it('キャラの返答(replyDone)や他のイベントでは、トリガーワードは発火しない(判定はユーザーの入力だけ)', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    expect(e.handle({ type: 'replyDone' }).fired).toEqual([])
    expect(e.handle({ type: 'click' }).fired).toEqual([])
  })
})

describe('調整のセットを適用(applyPreset)', () => {
  it('YAMLで書け、秒数の既定は0(戻さない)。セット名は必須', () => {
    const rs = load(yamlOf('  - { id: a, when: { trigger: click }, do: [{ action: applyPreset, name: 私服 }] }\n'))
    expect(rs.rules[0].do[0]).toEqual({ action: 'applyPreset', name: '私服', revertAfterSec: 0, mode: 'overlay' })
    expect(parseRuleSetYaml(yamlOf('  - { id: a, when: { trigger: click }, do: [{ action: applyPreset }] }\n')).ruleSet).toBeNull()
    expect(parseRuleSetYaml(yamlOf('  - { id: a, when: { trigger: click }, do: [{ action: applyPreset, name: x, revertAfterSec: -1 }] }\n')).ruleSet).toBeNull()
    expect(parseRuleSetYaml(yamlOf('  - { id: a, when: { trigger: click }, do: [{ action: applyPreset, name: x, revertAfterSec: 9999 }] }\n')).ruleSet).toBeNull()
  })
  it('発火すると、セット名と戻す秒数を持つアクションになる(日本語の名前もそのまま)', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf('  - { id: a, when: { trigger: click }, do: [{ action: applyPreset, name: "水着 \u2600", revertAfterSec: 30 }] }\n'), env)
    expect(e.handle({ type: 'click' }).fired[0].actions).toEqual([{ kind: 'applyPreset', name: '水着 \u2600', revertAfterSec: 30, mode: 'overlay' }])
  })
  it('トリガーワードと組み合わせられる(「着替えて」で私服)。AIには送らない', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf('  - { id: a, when: { trigger: userMessage, keywords: [着替えて] }, do: [{ action: applyPreset, name: 私服 }] }\n'), env)
    const r = e.handle({ type: 'userMessage', text: 'ちょっと着替えて!' })
    expect(r.consumed).toBe(true)
    expect(r.fired[0].actions[0]).toMatchObject({ kind: 'applyPreset', name: '私服' })
  })
  it('適用のしかた(重ねる/置き換える)を選べる。省略は重ねる', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf('  - { id: a, when: { trigger: click }, do: [{ action: applyPreset, name: x, mode: replace }, { action: applyPreset, name: y }] }\n'), env)
    const [first, second] = e.handle({ type: 'click' }).fired[0].actions
    expect(first).toMatchObject({ kind: 'applyPreset', name: 'x', mode: 'replace' })
    expect(second).toMatchObject({ kind: 'applyPreset', name: 'y', mode: 'overlay' })
    expect(parseRuleSetYaml(yamlOf('  - { id: a, when: { trigger: click }, do: [{ action: applyPreset, name: x, mode: foo }] }\n')).ruleSet).toBeNull()
  })
  it('元に戻す: 名前を指定すればそのセットだけ、空ならすべて', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf('  - { id: a, when: { trigger: click }, do: [{ action: revertPreset, name: 猫耳 }, { action: revertPreset }] }\n'), env)
    expect(e.handle({ type: 'click' }).fired[0].actions).toEqual([
      { kind: 'revertPreset', name: '猫耳' },
      { kind: 'revertPreset', name: '' }
    ])
  })
  it('GUIの新規ノードでは、セット名の候補の先頭が入る', async () => {
    const { newNode } = await import('./edit')
    expect(newNode('action', 'applyPreset', { presets: ['私服', '水着'] })).toEqual({ action: 'applyPreset', name: '私服', revertAfterSec: 0, mode: 'overlay' })
    expect(newNode('action', 'applyPreset')).toEqual({ action: 'applyPreset', name: '', revertAfterSec: 0, mode: 'overlay' })
  })
})

describe('RuleEngine: アクションの具体化', () => {
  it('タグからは、そのタグが付いた、登録済みのモーションだけが、乱数で選ばれる', () => {
    const { env, state } = makeEnv()
    const have = new Set(['dance1', 'dance3'])
    env.hasMotion = (n) => have.has(n)
    env.motionsWithTag = (t) => (t === 'ダンス' ? ['dance1', 'dance2', 'dance3'] : [])
    const e = engineOf(yamlOf(`  - id: d\n    when: { trigger: click }\n    do: [{ action: playMotion, tag: ダンス }]\n`), env)
    state.rand = 0
    expect(e.handle({ type: 'click' }).fired[0].actions).toEqual([{ kind: 'playMotion', motion: 'dance1' }])
    state.rand = 0.99
    expect(e.handle({ type: 'click' }).fired[0].actions).toEqual([{ kind: 'playMotion', motion: 'dance3' }])
  })
  it('pick: first は先頭(存在するもの)。存在するモーションが無ければ、アクションを出さない', () => {
    const { env } = makeEnv()
    env.hasMotion = (n) => n === 'b'
    env.motionsWithTag = (t) => (t === 'g' ? ['a', 'b'] : [])
    const e = engineOf(yamlOf(`  - id: d\n    when: { trigger: click }\n    do: [{ action: playMotion, tag: g, pick: first }, { action: playMotion, motion: zzz }]\n`), env)
    expect(e.handle({ type: 'click' }).fired[0].actions).toEqual([{ kind: 'playMotion', motion: 'b' }])
  })
  it('タグに該当するモーションが無ければ、何も再生しない(エラーにしない)', () => {
    const { env } = makeEnv()
    env.hasMotion = () => true
    env.motionsWithTag = () => []
    const e = engineOf(yamlOf(`  - id: d\n    when: { trigger: click }\n    do: [{ action: playMotion, tag: nothing }, { action: say, text: ok }]\n`), env)
    expect(e.handle({ type: 'click' }).fired[0].actions).toEqual([{ kind: 'say', text: 'ok' }])
  })
  it('(参考)pick: first でも、結果は変わらない', () => {
    const { env } = makeEnv()
    env.hasMotion = (n) => n === 'b'
    env.motionsWithTag = (t) => (t === 'g' ? ['a', 'b'] : [])
    const e = engineOf(yamlOf(`  - id: d\n    when: { trigger: click }\n    do: [{ action: playMotion, tag: g, pick: first }, { action: playMotion, motion: zzz }]\n`), env)
    expect(e.handle({ type: 'click' }).fired[0].actions).toEqual([{ kind: 'playMotion', motion: 'b' }])
  })
  it('say は複数セリフからランダムに1つ、setExpression は値をそのまま渡す', () => {
    const { env, state } = makeEnv()
    const e = engineOf(yamlOf(`  - id: x\n    when: { trigger: click }\n    do:\n      - { action: say, text: [a, b, c] }\n      - { action: setExpression, name: happy, value: 0.7, durationSec: 2 }\n`), env)
    state.rand = 0.5
    expect(e.handle({ type: 'click' }).fired[0].actions).toEqual([
      { kind: 'say', text: 'b' },
      { kind: 'setExpression', name: 'happy', value: 0.7, durationSec: 2 }
    ])
  })
  it('testFire は、トリガーも条件も無視して実行でき、クールダウンを消費しない', () => {
    const { env, state } = makeEnv()
    state.rand = 0.99
    const e = engineOf(yamlOf(say('x', '{ trigger: idle, afterSec: 86400 }', '    if: [{ condition: probability, value: 0 }]\n')), env)
    expect(e.testFire('x')!.actions).toEqual([{ kind: 'say', text: 'x' }])
    expect(e.testFire('none')).toBeNull()
  })
})

describe('プリセットが実際に動く(受け入れ条件: 放置でdance)', () => {
  it('5分放置すると、確率80%で dance1〜3 のどれかが再生され、10分は再発火しない', () => {
    const { env, state } = makeEnv()
    const e = new RuleEngine(env, load(PRESET_RULES_YAML))
    state.rand = 0.5
    env.advance(299)
    expect(e.handle({ type: 'tick' }).fired).toEqual([])
    env.advance(2)
    const r = e.handle({ type: 'tick' })
    expect(firedIds(r)).toEqual(['idle-dance'])
    expect(['dance1', 'dance2', 'dance3']).toContain((r.fired[0].actions[0] as { motion: string }).motion)
    e.handle({ type: 'activity' })
    env.advance(301) // 再び放置したが、クールダウン(600秒)中
    expect(e.handle({ type: 'tick' }).fired).toEqual([])
    env.advance(400)
    e.handle({ type: 'activity' })
    env.advance(301)
    expect(firedIds(e.handle({ type: 'tick' }))).toEqual(['idle-dance'])
  })
  it('「ダンスして」は、プリセットでは反応しない(ダンスは、公式のデータ Mod「ダンス」で)', () => {
    const { env } = makeEnv()
    const e = new RuleEngine(env, load(PRESET_RULES_YAML))
    expect(e.handle({ type: 'userMessage', text: 'ダンスして!' }).fired).toEqual([])
  })
  it('クリックで、リアクションのモーションと表情が出る', () => {
    const { env } = makeEnv()
    const e = new RuleEngine(env, load(PRESET_RULES_YAML))
    const r = e.handle({ type: 'click' })
    expect(r.fired[0].actions.map((a) => a.kind)).toEqual(['playMotion', 'setExpression'])
  })
})

describe('クリックの部位(触った場所による反応)', () => {
  const text = yamlOf(`  - { id: any, when: { trigger: click }, do: [{ action: say, text: 汎用 }] }
  - { id: head, when: { trigger: click, part: head }, do: [{ action: say, text: 頭 }] }
  - { id: lhand, when: { trigger: click, part: hand, side: left }, do: [{ action: say, text: 左手 }] }
  - { id: arm, when: { trigger: click, part: arm }, do: [{ action: say, text: 腕 }] }
  - { id: leftside, when: { trigger: click, side: right }, do: [{ action: say, text: 右側 }] }
`)
  const click = (e: RuleEngine, part?: string, side?: string): string[] => firedIds(e.handle({ type: 'click', part, side }))

  it('既定(part/side を書かない)は「どこでも」。YAMLで書け、形の不正な部位はエラー(Mod が宣言する部位の id は、形が正しければ書ける)', () => {
    const rs = load(text)
    expect(rs.rules[0].when).toEqual({ trigger: 'click', part: 'any', side: 'any' })
    expect(parseRuleSetYaml(yamlOf('  - { id: a, when: { trigger: click, part: Tail }, do: [{ action: say, text: x }] }\n')).ruleSet).toBeNull()
    expect(parseRuleSetYaml(yamlOf('  - { id: a, when: { trigger: click, part: "a b" }, do: [{ action: say, text: x }] }\n')).ruleSet).toBeNull()
    expect(parseRuleSetYaml(yamlOf('  - { id: a, when: { trigger: click, part: shoulder }, do: [{ action: say, text: x }] }\n')).ruleSet).not.toBeNull()
    expect(parseRuleSetYaml(yamlOf('  - { id: a, when: { trigger: click, side: up }, do: [{ action: say, text: x }] }\n')).ruleSet).toBeNull()
  })
  it('頭を触ると、頭のルールだけが動く(汎用の click は、部位指定のルールが動いたので動かない)', () => {
    const { env } = makeEnv()
    expect(click(engineOf(text, env), 'head', 'center')).toEqual(['head'])
  })
  it('左右を指定した部位は、その側のときだけ。左手は左手のルールだけで、「腕」「右側」には一致しない', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    expect(click(e, 'hand', 'left')).toEqual(['lhand'])
    expect(click(e, 'arm', 'left')).toEqual(['arm'])
    expect(click(e, 'arm', 'right')).toEqual(['arm', 'leftside']) // 腕(どちら側でも) と 右側(どの部位でも)
  })
  it('部位指定のルールに一致しなければ、汎用の click ルールが動く(胸など、反応を作っていない部位)', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    expect(click(e, 'chest', 'center')).toEqual(['any'])
    expect(click(e, 'belly', 'center')).toEqual(['any'])
  })
  it('部位が判定できなかった(体の外・不明)ときは、部位指定のルールは動かず、汎用が動く', () => {
    const { env } = makeEnv()
    const e = engineOf(text, env)
    expect(click(e)).toEqual(['any'])
    expect(click(e, undefined, undefined)).toEqual(['any'])
  })
  it('部位指定のルールが確率・クールダウンで動かなかったときは、汎用のルールが代わりに動く', () => {
    const { env, state } = makeEnv()
    const e = engineOf(
      yamlOf(`  - { id: any, when: { trigger: click }, do: [{ action: say, text: 汎用 }] }
  - { id: head, when: { trigger: click, part: head }, if: [{ condition: probability, value: 0.5 }], do: [{ action: say, text: 頭 }] }
`),
      env
    )
    state.rand = 0.9 // 外れ
    expect(click(e, 'head', 'center')).toEqual(['any'])
    state.rand = 0.1 // 当たり
    expect(click(e, 'head', 'center')).toEqual(['head'])
  })
  it('中央の部位(頭・胸など)に、左右を指定したルールを書いても、部位だけで判定される(左右は無視)', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf('  - { id: a, when: { trigger: click, part: head, side: left }, do: [{ action: say, text: x }] }\n'), env)
    expect(click(e, 'head', 'center')).toEqual(['a'])
  })
  it('click 以外のイベント・トリガーには影響しない', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf(say('s', '{ trigger: startup }') + say('c', '{ trigger: click, part: head }')), env)
    expect(firedIds(e.handle({ type: 'startup' }))).toEqual(['s'])
    expect(click(e, 'foot', 'left')).toEqual([])
  })
  it('プリセットのクリック反応(部位なし)は、これまでどおり動く', () => {
    const { env } = makeEnv()
    const e = new RuleEngine(env, load(PRESET_RULES_YAML))
    expect(firedIds(e.handle({ type: 'click' }))).toContain('click-react')
  })
})

describe('プリセット: 部位ごとのクリック', () => {
  it('頭 → touch-head のみ(汎用の click-react は動かない)、手 → touch-hand、お腹 → touch-belly', () => {
    const { env } = makeEnv()
    const e = new RuleEngine(env, load(PRESET_RULES_YAML))
    expect(firedIds(e.handle({ type: 'click', part: 'head', side: 'center' }))).toEqual(['touch-head'])
    expect(firedIds(e.handle({ type: 'click', part: 'hand', side: 'left' }))).toEqual(['touch-hand'])
    expect(firedIds(e.handle({ type: 'click', part: 'belly', side: 'center' }))).toEqual(['touch-belly'])
  })
  it('胸・腰・脚・足などは、部位ごとのルールを作っていないので、汎用の click-react が動く', () => {
    const { env } = makeEnv()
    const e = new RuleEngine(env, load(PRESET_RULES_YAML))
    for (const part of ['chest', 'hips', 'leg', 'foot', 'arm']) expect(firedIds(e.handle({ type: 'click', part, side: 'center' }))).toEqual(['click-react'])
    expect(firedIds(e.handle({ type: 'click' }))).toEqual(['click-react']) // 部位が判定できなかったとき
  })
})

describe('ルールの対象キャラ(characters)', () => {
  it('characters を指定したルールは、そのキャラのときだけ動く。指定なし・空は、全キャラで動く', () => {
    let who = 'a'
    const { env } = makeEnv()
    const e = engineOf(
      yamlOf(
        say('all', '{ trigger: startup }') +
          say('only-a', '{ trigger: startup }', '    characters: [a]\n') +
          say('only-b', '{ trigger: startup }', '    characters: [b, c]\n') +
          say('empty', '{ trigger: startup }', '    characters: []\n')
      ),
      { ...env, characterId: () => who }
    )
    expect(firedIds(e.handle({ type: 'startup' }))).toEqual(['all', 'only-a', 'empty'])
    who = 'c'
    expect(firedIds(e.handle({ type: 'startup' }))).toEqual(['all', 'only-b', 'empty'])
    who = 'zzz'
    expect(firedIds(e.handle({ type: 'startup' }))).toEqual(['all', 'empty'])
  })
  it('キャラを渡さない環境(テスト等)では、キャラの指定は見ない', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf(say('only-a', '{ trigger: startup }', '    characters: [a]\n')), env)
    expect(firedIds(e.handle({ type: 'startup' }))).toEqual(['only-a'])
  })
  it('click の汎用ルールを抑える判定は、対象外のキャラの部位ルールには影響されない', () => {
    let who = 'b'
    const { env } = makeEnv()
    const e = engineOf(
      yamlOf(
        say('head-a', '{ trigger: click, part: head }', '    characters: [a]\n') + say('generic', '{ trigger: click }')
      ),
      { ...env, characterId: () => who }
    )
    expect(firedIds(e.handle({ type: 'click', part: 'head', side: 'center' }))).toEqual(['generic'])
    who = 'a'
    expect(firedIds(e.handle({ type: 'click', part: 'head', side: 'center' }))).toEqual(['head-a'])
  })
  it('YAMLでの往復・不正な値のエラー', () => {
    const rs = load(yamlOf(say('r', '{ trigger: startup }', '    characters: [a, c2]\n')))
    expect(rs.rules[0].characters).toEqual(['a', 'c2'])
    expect(load(stringifyRuleSet(rs)).rules[0].characters).toEqual(['a', 'c2'])
    expect(load(yamlOf(say('r', '{ trigger: startup }', '    characters: []\n'))).rules[0].characters).toBeUndefined()
    const bad = parseRuleSetYaml(yamlOf(say('r', '{ trigger: startup }', '    characters: a\n')))
    expect(bad.ruleSet).toBeNull()
    expect(bad.issues[0].path).toBe('rules[0].characters')
  })
})

// ---------------------------------------------------------------- ふれあいの拡張(なでる・長押し・触り方・気分/親密度・連続再生)
describe('ふれあいの拡張', () => {
  const stroke = (sec: number, session = 1, part = 'head') => ({ type: 'stroke' as const, part, side: 'center', sec, session })

  it('stroke: 秒数(minSec)の段階ごとに、1回のなでの間に、各ルールが1度だけ発火する。なで直す(別の session)と、また動く', () => {
    const { env } = makeEnv()
    const e = engineOf(
      yamlOf(
        say('s0', '{ trigger: stroke, part: head }') +
          say('s3', '{ trigger: stroke, part: head, minSec: 3 }') +
          say('s8', '{ trigger: stroke, part: head, minSec: 8 }')
      ),
      env
    )
    expect(firedIds(e.handle(stroke(0.5)))).toEqual(['s0'])
    expect(firedIds(e.handle(stroke(1.0)))).toEqual([]) // 同じ session で、s0 は1度だけ
    expect(firedIds(e.handle(stroke(3.2)))).toEqual(['s3'])
    expect(firedIds(e.handle(stroke(9)))).toEqual(['s8'])
    expect(firedIds(e.handle(stroke(9.5)))).toEqual([])
    expect(firedIds(e.handle(stroke(0.5, 2)))).toEqual(['s0']) // なで直し
    expect(firedIds(e.handle(stroke(0.5, 3, 'hand')))).toEqual([]) // 部位が違う
  })
  it('hold / stroke: 部位を指定したルールが動いたら、部位を指定しない同じ種類のルールは動かない。click には反応しない', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf(say('any', '{ trigger: stroke }') + say('head', '{ trigger: stroke, part: head }') + say('click', '{ trigger: click }')), env)
    expect(firedIds(e.handle(stroke(0.5, 1, 'head')))).toEqual(['head'])
    expect(firedIds(e.handle(stroke(0.5, 2, 'belly')))).toEqual(['any'])
    expect(firedIds(e.handle({ type: 'click', part: 'head', side: 'center' }))).toEqual(['click']) // stroke のルールは click では動かない
  })
  it('hold は minSec の秒数以降に発火する。strokeEnd は、なでた秒数が minSec 以上のときだけ', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf(say('h', '{ trigger: hold, part: hand, minSec: 1 }') + say('end', '{ trigger: strokeEnd, minSec: 2 }')), env)
    expect(firedIds(e.handle({ type: 'hold', part: 'hand', side: 'left', sec: 0.6, session: 1 }))).toEqual([])
    expect(firedIds(e.handle({ type: 'hold', part: 'hand', side: 'left', sec: 1.1, session: 1 }))).toEqual(['h'])
    expect(firedIds(e.handle({ type: 'strokeEnd', part: 'head', side: 'center', sec: 1.5, session: 1 }))).toEqual([])
    expect(firedIds(e.handle({ type: 'strokeEnd', part: 'head', side: 'center', sec: 2.5, session: 1 }))).toEqual(['end'])
  })
  it('recentTouches: 直近N秒に M 回以上クリックされたとき(今回も数える)。部位を指定すると、その部位だけ数える', () => {
    const { env, state } = makeEnv()
    const e = engineOf(
      yamlOf(
        say('poke', '{ trigger: click }', '    if: [{ condition: recentTouches, count: 3, withinSec: 5 }]\n') +
          say('head3', '{ trigger: click }', '    if: [{ condition: recentTouches, part: head, count: 2, withinSec: 5 }]\n')
      ),
      env
    )
    const click = (part: string) => e.handle({ type: 'click', part, side: 'center' })
    expect(firedIds(click('belly'))).toEqual([])
    state.t += 1000
    expect(firedIds(click('head'))).toEqual([]) // 2回目。poke は3回必要 / head3 は head が1回だけ
    state.t += 1000
    expect(firedIds(click('head'))).toEqual(['poke', 'head3']) // 3回目(部位に関係なく3回)、head は2回
    state.t += 10_000
    expect(firedIds(click('head'))).toEqual([]) // 古い履歴は数えない
  })
  it('affection / mood の条件。状態を渡さない環境では、親密度30・ふつうとして扱う', () => {
    const { env } = makeEnv()
    let st = { affection: 80, mood: 'happy' }
    const e = engineOf(
      yamlOf(
        say('close', '{ trigger: startup }', '    if: [{ condition: affection, min: 60 }]\n') +
          say('far', '{ trigger: startup }', '    if: [{ condition: affection, max: 20 }]\n') +
          say('happy', '{ trigger: startup }', '    if: [{ condition: mood, is: happy }]\n')
      ),
      { ...env, state: () => st }
    )
    expect(firedIds(e.handle({ type: 'startup' }))).toEqual(['close', 'happy'])
    st = { affection: 10, mood: 'normal' }
    expect(firedIds(e.handle({ type: 'startup' }))).toEqual(['far'])
    const noState = engineOf(yamlOf(say('n', '{ trigger: startup }', '    if: [{ condition: mood, is: normal }, { condition: affection, min: 30, max: 30 }]\n')), env)
    expect(firedIds(noState.handle({ type: 'startup' }))).toEqual(['n'])
  })
  it('wait で、後ろのアクションが遅れる(delaySec は累積)。changeAffection / setMood / playMotion のオプションも出る', () => {
    const { env } = makeEnv()
    const e = engineOf(
      yamlOf(
        `  - id: seq
    when: { trigger: startup }
    do:
      - { action: say, text: ["a"] }
      - { action: wait, sec: 1.5 }
      - { action: playMotion, motion: wave, durationSec: 4, queue: true }
      - { action: wait, sec: 2 }
      - { action: changeAffection, delta: 5 }
      - { action: setMood, mood: shy, durationSec: 20 }
`
      ),
      env
    )
    const r = e.handle({ type: 'startup' })
    expect(r.fired[0].actions).toEqual([
      { kind: 'say', text: 'a' },
      { kind: 'playMotion', motion: 'wave', durationSec: 4, queue: true, delaySec: 1.5 },
      { kind: 'changeAffection', delta: 5, delaySec: 3.5 },
      { kind: 'setMood', mood: 'shy', durationSec: 20, delaySec: 3.5 }
    ])
  })
  it('playMotion の durationSec / queue を指定しないルールは、従来どおりの結果(キーが増えない)', () => {
    const { env } = makeEnv()
    const e = engineOf(yamlOf('  - id: m\n    when: { trigger: startup }\n    do: [{ action: playMotion, motion: wave }]\n'), env)
    expect(e.handle({ type: 'startup' }).fired[0].actions).toEqual([{ kind: 'playMotion', motion: 'wave' }])
    expect(stringifyRuleSet(load(yamlOf('  - id: m\n    when: { trigger: startup }\n    do: [{ action: playMotion, motion: wave }]\n')))).not.toContain('durationSec')
  })
  it('新しいトリガー・条件・アクションは、YAMLの往復で変わらない', () => {
    const text = yamlOf(
      `  - id: r
    when: { trigger: stroke, part: head, side: any, minSec: 3 }
    if:
      - { condition: recentTouches, part: any, count: 3, withinSec: 5 }
      - { condition: affection, min: 10, max: 90 }
      - { condition: mood, is: shy }
    do:
      - { action: wait, sec: 1 }
      - { action: setMood, mood: happy, durationSec: 0 }
`
    )
    const rs = load(text)
    expect(load(stringifyRuleSet(rs))).toEqual(rs)
  })
})

