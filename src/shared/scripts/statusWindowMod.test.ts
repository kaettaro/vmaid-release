import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePackYaml } from '../packs/manifest'
import { RuleEngine } from '../rules/engine'
import { createRegistry } from '../rules/registry'
import { toNodeDefs } from './spec'
import type { UiList } from './uiList'

// 公式サンプル「状態表示ウィンドウ Mod」(examples/mods/status-window)の契約テスト。
// ルール(本体のトリガー・モーション生成 Mod の通知 → note アクション)と、スクリプト(出来事 → 一覧の窓)を、偽の host で確かめる。
const DIR = join(__dirname, '../../../examples/mods/status-window')
const YAML = readFileSync(join(DIR, 'mod.yaml'), 'utf-8')
const CODE = readFileSync(join(DIR, 'main.js'), 'utf-8')
const GEN_YAML = readFileSync(join(__dirname, '../../../examples/mods/motion-gen-textvrma/mod.yaml'), 'utf-8')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-18T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('状態表示ウィンドウ Mod: マニフェストとルール', () => {
  const engine = (): RuleEngine => {
    const gen = parsePackYaml(GEN_YAML).pack!
    const st = parsePackYaml(YAML).pack!
    const contributions = [
      { modId: gen.id, modName: gen.name, triggers: toNodeDefs(gen.id, gen.name, gen.script!.contributes.triggers), actions: toNodeDefs(gen.id, gen.name, gen.script!.contributes.actions) },
      { modId: st.id, modName: st.name, triggers: [], actions: toNodeDefs(st.id, st.name, st.script!.contributes.actions) }
    ]
    return new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry([], contributions) }, st.ruleSet)
  }
  const note = (r: ReturnType<RuleEngine['handle']>) => r.fired.flatMap((f) => f.actions).map((a) => (a.kind === 'extension' ? a.params : null))

  it('読め、一覧の窓と保存の権限だけを宣言している(通信・ほかの権限は無い)', () => {
    const r = parsePackYaml(YAML)
    expect(r.errors).toEqual([])
    const p = r.pack!.script!.permissions
    expect(p.network).toEqual([])
    expect(p.ui).toEqual({ list: true, openLink: false })
    expect(p.storage).toBe(true)
    expect(p.say).toBe(false)
    expect(p.ai).toBe(false)
  })

  it('返答の開始・終了・動きの指定は、入力・返答・説明を持って、note に届く', () => {
    const e = engine()
    expect(note(e.handle({ type: 'replyStart', text: 'こんにちは' }))).toEqual([{ kind: 'user', text: 'こんにちは' }])
    expect(note(e.handle({ type: 'replyDone', text: 'やあ!' }))).toEqual([{ kind: 'reply', text: 'やあ!' }])
    expect(note(e.handle({ type: 'llmPose', pose: '両手を上げて喜ぶ' }))).toEqual([{ kind: 'pose', text: '両手を上げて喜ぶ' }])
  })

  it('モーション生成 Mod の通知(生成を始めた・前の動きを使った・終わった・失敗)も、note に届く', () => {
    const e = engine()
    const fire = (name: string) => note(e.handle({ type: 'modEvent', modId: 'motion-gen-textvrma', name }))
    expect(fire('generating')).toEqual([{ kind: 'genStart' }])
    expect(fire('cached')).toEqual([{ kind: 'genCached' }])
    expect(fire('generated')).toEqual([{ kind: 'genDone' }])
    expect(fire('failed')).toEqual([{ kind: 'genFail' }])
  })

  it('モーション生成 Mod が無いとき(未導入)は、その通知のルールだけが動かず、会話のルールは動く', () => {
    const st = parsePackYaml(YAML).pack!
    const own = [{ modId: st.id, modName: st.name, triggers: [], actions: toNodeDefs(st.id, st.name, st.script!.contributes.actions) }]
    const e = new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry([], own) }, st.ruleSet)
    expect(e.handle({ type: 'modEvent', modId: 'motion-gen-textvrma', name: 'generating' }).fired).toEqual([])
    expect(e.handle({ type: 'replyStart', text: 'a' }).fired).toHaveLength(1)
  })
})

describe('状態表示ウィンドウ Mod: スクリプトの振る舞い', () => {
  interface Fake {
    lists: UiList[]
    logs: string[]
    storage: Map<string, unknown>
    action: (a: string, p: Record<string, unknown>) => void
  }
  function load(storage = new Map<string, unknown>()): Fake {
    const h: Fake = { lists: [], logs: [], storage, action: () => {} }
    const host = {
      log: (_l: string, m: string) => h.logs.push(m),
      onAction: (fn: Fake['action']) => (h.action = fn),
      storage: { get: async (k: string) => h.storage.get(k) ?? null, set: async (k: string, v: unknown) => (h.storage.set(k, JSON.parse(JSON.stringify(v))), true) },
      ui: { list: { set: (l: UiList) => h.lists.push(l) } }
    }
    new Function('host', 'setTimeout', CODE)(host, setTimeout)
    return h
  }
  const settle = async (ms = 0): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  const last = (h: Fake): UiList => h.lists[h.lists.length - 1]!
  const title = (h: Fake, id: string): string => last(h).items.find((x) => x.id === id)!.title

  it('起動直後は、待機中を出す', async () => {
    const h = load()
    await settle()
    expect(title(h, 'chat')).toBe('会話: 待機中')
    expect(title(h, 'gen')).toBe('モーション: 待機中')
    expect(last(h).empty).toBeTruthy()
  })

  it('入力して考え始めたら「考え中… N秒」を出し、1 秒ごとに更新して、返答が終わったら待機に戻る', async () => {
    const h = load()
    h.action('note', { kind: 'user', text: 'こんにちは' })
    await settle()
    expect(title(h, 'chat')).toBe('会話: 考え中… 0秒')
    expect(last(h).items.find((x) => x.id === 'chat')!.subtitle).toBe('あなた: こんにちは')
    await settle(3000)
    expect(title(h, 'chat')).toBe('会話: 考え中… 3秒')
    h.action('note', { kind: 'reply', text: 'やあ' })
    await settle()
    expect(title(h, 'chat')).toBe('会話: 待機中')
    await settle(1500) // 予約済みの更新が、最後に 1 回だけ走る
    const n = h.lists.length
    await settle(5000)
    expect(h.lists.length).toBe(n) // 待機に戻ったら、更新を止める
  })

  it('動きの指定 → 生成開始 → 完了で、「生成中… N秒 + 動きの説明」から、完了の記録まで進む', async () => {
    const h = load()
    h.action('note', { kind: 'user', text: 'うれしい' })
    h.action('note', { kind: 'pose', text: '両手を上げて喜ぶ' })
    h.action('note', { kind: 'genStart', text: '' })
    await settle(2000)
    expect(title(h, 'gen')).toBe('モーション: 生成中… 2秒')
    expect(last(h).items.find((x) => x.id === 'gen')!.subtitle).toBe('両手を上げて喜ぶ')
    h.action('note', { kind: 'genDone', text: '' })
    h.action('note', { kind: 'reply', text: 'やった!' })
    await settle()
    expect(title(h, 'gen')).toBe('モーション: 待機中')
    const titles = last(h).items.map((x) => x.title)
    expect(titles.some((t) => t.startsWith('動きを生成しました'))).toBe(true)
    expect(title(h, 'stat')).toBe('ポーズ指定: 返答 1 回中 1 回(100%)')
  })

  it('動きの指定のあと、生成も再利用も始まらなければ、「見送り」と記録する。再利用なら、見送りにしない', async () => {
    const h = load()
    h.action('note', { kind: 'pose', text: '手を振る' })
    await settle(4000)
    expect(last(h).items.some((x) => x.title.startsWith('見送り: 手を振る'))).toBe(true)
    const h2 = load()
    h2.action('note', { kind: 'pose', text: '手を振る' })
    h2.action('note', { kind: 'genCached', text: '' })
    await settle(4000)
    expect(last(h2).items.some((x) => x.title.startsWith('見送り'))).toBe(false)
    expect(last(h2).items.some((x) => x.title.startsWith('作らずに'))).toBe(true)
  })

  it('動きの指定が無い返答は、「付けなかった」と記録して、割合に数える。失敗も記録する', async () => {
    const h = load()
    h.action('note', { kind: 'user', text: 'a' })
    h.action('note', { kind: 'reply', text: 'b' })
    h.action('note', { kind: 'user', text: 'c' })
    h.action('note', { kind: 'reply', text: 'd' })
    h.action('note', { kind: 'genStart', text: '' })
    h.action('note', { kind: 'genFail', text: '' })
    await settle()
    expect(title(h, 'stat')).toBe('ポーズ指定: 返答 2 回中 0 回(0%)')
    expect(last(h).items.some((x) => x.title.includes('[pose:…] を付けなかった'))).toBe(true)
    expect(last(h).items.some((x) => x.title.startsWith('動きの生成に失敗'))).toBe(true)
  })

  it('履歴は 12 件まで。保存した回数・履歴は、次に起動したときも出る。知らない種類は、無視する', async () => {
    const h = load()
    for (let i = 0; i < 20; i++) h.action('note', { kind: 'reply', text: `返答${i}` })
    h.action('note', { kind: 'unknown', text: 'x' })
    await settle()
    expect(last(h).items.filter((x) => x.id.startsWith('log-'))).toHaveLength(12)
    const h2 = load(h.storage)
    await settle()
    expect(title(h2, 'stat')).toContain('返答 20 回中 0 回')
    expect(last(h2).items.filter((x) => x.id.startsWith('log-'))).toHaveLength(12)
  })

  it('考え中のまま完了が来なくても、3 分たてば、待機に戻す', async () => {
    const h = load()
    h.action('note', { kind: 'user', text: 'a' })
    await settle(181_000)
    expect(title(h, 'chat')).toBe('会話: 待機中')
  })
})
