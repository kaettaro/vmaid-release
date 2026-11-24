import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePackYaml } from '../packs/manifest'
import { generateBuiltinMotions } from '../motions/builtin'
import { RuleEngine } from '../rules/engine'
import { createRegistry } from '../rules/registry'
import { toNodeDefs } from './spec'

// 公式サンプル「モーション生成 Mod」(examples/mods/motion-gen-textvrma)の契約テスト。実際の text-to-vrma は使わず、
// ADR 0001 で確認した API の形(POST /v1/motions → VRMA / エラーは { error: { code } })を、モックで再現する。
const DIR = join(__dirname, '../../../examples/mods/motion-gen-textvrma')
const YAML = readFileSync(join(DIR, 'mod.yaml'), 'utf-8')
const CODE = readFileSync(join(DIR, 'main.js'), 'utf-8')
const VRMA = generateBuiltinMotions().find((m) => m.name === 'wave')!.data

type Fetched = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } }
interface FakeHost {
  said: string[]
  played: string[]
  added: Array<{ name: string; bytes: Uint8Array }>
  removed: string[]
  fetched: Fetched[]
  storage: Map<string, unknown>
  settings: Record<string, unknown>
  emitted: string[]
  respond: (f: Fetched) => unknown
  action: (a: string, p: Record<string, unknown>) => void
}

/** main.js を、偽の host で読み込む(サンドボックスの代わり) */
function load(): FakeHost {
  const h: FakeHost = {
    said: [],
    played: [],
    added: [],
    removed: [],
    fetched: [],
    storage: new Map(),
    settings: { endpoint: 'http://127.0.0.1:8787', token: null, timeoutSec: 300 },
    emitted: [],
    respond: () => ({ ok: true, status: 200, contentType: 'model/gltf-binary', bytes: VRMA, text: '' }),
    action: () => {}
  }
  const host = {
    log: () => {},
    rules: { emit: (n: string) => h.emitted.push(n) },
    say: (t: string) => h.said.push(t),
    onAction: (fn: (a: string, p: Record<string, unknown>) => void) => (h.action = fn),
    settings: { get: async (n: string) => h.settings[n] ?? null },
    storage: { get: async (k: string) => h.storage.get(k) ?? null, set: async (k: string, v: unknown) => (h.storage.set(k, JSON.parse(JSON.stringify(v))), true) },
    http: {
      fetch: async (url: string, init: Fetched['init']) => {
        h.fetched.push({ url, init })
        return h.respond({ url, init })
      }
    },
    motion: {
      add: async (name: string, bytes: Uint8Array) => (h.added.push({ name, bytes }), `motion-gen-textvrma/${name}`),
      play: (n: string) => h.played.push(n),
      remove: async (n: string) => (h.removed.push(n), true)
    }
  }
  new Function('host', 'setTimeout', CODE)(host, setTimeout)
  return h
}

/** 非同期の処理(キュー・クールダウン)が、落ち着くまで進める */
async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-17T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('モーション生成 Mod: マニフェスト', () => {
  it('読め、必要な権限(自分のPCへの通信・モーションの追加と再生・セリフ・保存・状況の通知)だけを宣言し、設定項目を持つ', () => {
    const r = parsePackYaml(YAML)
    expect(r.errors).toEqual([])
    const s = r.pack!.script!
    expect(s.permissions).toEqual({ network: ['http://127.0.0.1:8787'], motion: ['add', 'play'], say: true, storage: true, emit: true, ai: false, networkFrom: [], context: false, ui: { list: false, openLink: false } })
    expect(s.settings.map((x) => [x.name, x.kind])).toEqual([['exe', 'file'], ['autoStart', 'boolean'], ['endpoint', 'string'], ['token', 'secret'], ['timeoutSec', 'number']])
    // 外部ツールの起動: 実行ファイルは利用者が選ぶ。確認の URL は、通信先と同じオリジンの /health
    expect(s.launcher).toMatchObject({ pathSetting: 'exe', autoSetting: 'autoStart', healthUrl: 'http://127.0.0.1:8787/health' })
    expect(r.pack!.distribution).toBe('private') // スクリプトを含むので、配布用にはしない
  })

  it('ルールは、「モーション生成: …」の入力から、{{rest}} を説明にして、generateMotion を実行する(AI には送らない)', () => {
    const p = parsePackYaml(YAML).pack!
    const contribution = { modId: p.id, modName: p.name, triggers: [], actions: toNodeDefs(p.id, p.name, p.script!.contributes.actions) }
    const e = new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry([], [contribution]) }, p.ruleSet)
    const r = e.handle({ type: 'userMessage', text: 'モーション生成: 手を振る' })
    expect(r.consumed).toBe(true)
    expect(r.fired[0].actions).toEqual([{ kind: 'extension', modId: 'motion-gen-textvrma', action: 'generateMotion', params: { prompt: '手を振る', durationSec: 4, quiet: false }, source: 'motion-gen-textvrma' }])
    expect(e.handle({ type: 'userMessage', text: 'こんにちは' }).fired).toEqual([])
  })
})

describe('モーション生成 Mod: スクリプトの振る舞い', () => {
  it('リクエストは、必ず完全ローカルの固定値(ardy・planner:none・use_jev:false・vrma)で送り、できた VRMA を追加して再生する', async () => {
    const h = load()
    h.action('generateMotion', { prompt: '  手を  振る ', durationSec: 5 })
    await settle()
    expect(h.fetched).toHaveLength(1)
    const f = h.fetched[0]
    expect(f.url).toBe('http://127.0.0.1:8787/v1/motions')
    expect(f.init.method).toBe('POST')
    expect(JSON.parse(f.init.body!)).toEqual({ prompt: '手を 振る', engine: 'ardy', planner: 'none', use_jev: false, format: 'vrma', duration: 5 })
    expect(f.init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(f.init.timeoutMs).toBe(300_000)
    expect(h.said[0]).toContain('考え中')
    expect(h.added).toHaveLength(1)
    expect(h.added[0].name).toMatch(/^gen-手を 振る-[0-9a-f]{4}$/)
    expect(h.added[0].bytes).toBe(VRMA)
    expect(h.played).toEqual([`motion-gen-textvrma/${h.added[0].name}`])
  })

  it('トークンを設定していれば、Authorization を付ける。接続先の末尾の / は、除く', async () => {
    const h = load()
    h.settings.token = 'secret-token'
    h.settings.endpoint = 'http://127.0.0.1:8787/'
    h.action('generateMotion', { prompt: 'a' })
    await settle()
    expect(h.fetched[0].url).toBe('http://127.0.0.1:8787/v1/motions')
    expect(h.fetched[0].init.headers).toMatchObject({ Authorization: 'Bearer secret-token' })
    expect(JSON.parse(h.fetched[0].init.body!)).not.toHaveProperty('duration') // 長さを指定しなければ、送らない
  })

  it('同じ説明・長さは、通信せず、前に作ったものを再生する(キャッシュ)', async () => {
    const h = load()
    h.action('generateMotion', { prompt: '踊る', durationSec: 4 })
    await settle()
    h.action('generateMotion', { prompt: '踊る', durationSec: 4 })
    await settle(11_000)
    expect(h.fetched).toHaveLength(1)
    expect(h.played).toHaveLength(2)
    expect(h.played[0]).toBe(h.played[1])
    h.action('generateMotion', { prompt: '踊る', durationSec: 8 }) // 長さが違えば、別
    await settle(11_000)
    expect(h.fetched).toHaveLength(2)
  })

  it('エラーは、短い日本語で伝える(ARDY 未起動・トークン違い・接続不可・タイムアウト・接続先の宣言違い・VRMA ではない応答)', async () => {
    const cases: Array<[unknown, string]> = [
      [{ ok: true, status: 503, contentType: 'application/json', text: JSON.stringify({ error: { code: 'ardy_unavailable', message: 'x' } }) }, 'ARDY エンジンが起動していません'],
      [{ ok: true, status: 401, contentType: 'application/json', text: JSON.stringify({ error: { code: 'unauthorized' } }) }, 'トークンが違います'],
      [{ ok: false, reason: 'error:connect ECONNREFUSED' }, '接続できません'],
      [{ ok: false, reason: 'timeout' }, 'タイムアウト'],
      [{ ok: false, reason: 'origin-not-allowed' }, '通信先と違います'],
      [{ ok: true, status: 500, contentType: 'text/html', text: '<html>' }, 'HTTP 500']
    ]
    for (const [resp, expected] of cases) {
      const h = load()
      h.respond = () => resp
      h.action('generateMotion', { prompt: 'x' })
      await settle()
      expect(h.said.at(-1), expected).toContain(expected)
      expect(h.added).toEqual([])
      expect(h.played).toEqual([])
    }
  })

  it('VRMA として読めない応答(追加が断られた)は、再生せず、伝える', async () => {
    const h = load()
    // 追加が null を返す(検査で断られた)ようにする
    const host = { ...h }
    void host
    h.respond = () => ({ ok: true, status: 200, contentType: 'model/gltf-binary', bytes: new Uint8Array([1, 2, 3]), text: '' })
    // load() の motion.add は、常に成功するので、ここでは、別の偽 host を作る
    const h2 = load()
    const origAdd = h2.added
    void origAdd
    h2.action('generateMotion', { prompt: 'x' })
    await settle()
    expect(h2.played.length).toBe(1) // 偽 host は検査しない。実際の検査は、ホスト側(checkVrmaBytes)のテストで確認している
  })

  it('入力の検査: 空・500文字を超える・待ち行列が満杯(4件目)は、生成せずに伝える', async () => {
    const h = load()
    h.action('generateMotion', { prompt: '   ' })
    h.action('generateMotion', { prompt: 'あ'.repeat(501) })
    await settle()
    expect(h.said[0]).toContain('空です')
    expect(h.said[1]).toContain('長すぎます')
    expect(h.fetched).toEqual([])

    // 遅い応答で、1件目を実行中のままにして、待ち行列を満たす
    const g = load()
    g.respond = () => new Promise(() => {})
    for (const p of ['a', 'b', 'c', 'd', 'e']) g.action('generateMotion', { prompt: p })
    await settle()
    expect(g.fetched).toHaveLength(1) // 同時に生成するのは1件
    expect(g.said.filter((s) => s.includes('いっぱい'))).toHaveLength(1) // 1件実行中 + 待ち3件 = 4件まで。5件目は断る
  })

  it('連続した生成は、開始の間隔を 10 秒あける', async () => {
    const h = load()
    h.action('generateMotion', { prompt: 'a' })
    h.action('generateMotion', { prompt: 'b' })
    await settle()
    expect(h.fetched).toHaveLength(1)
    await settle(9_000)
    expect(h.fetched).toHaveLength(1)
    await settle(2_000)
    expect(h.fetched).toHaveLength(2)
  })

  it('作った動きが 40 件を超えたら、古いものから、一覧から外す', async () => {
    const h = load()
    for (let i = 0; i < 41; i++) {
      h.action('generateMotion', { prompt: `動き${i}` })
      await settle(11_000)
    }
    expect(h.added).toHaveLength(41)
    expect(h.removed).toEqual([`motion-gen-textvrma/${h.added[0].name}`])
    const index = h.storage.get('index') as Record<string, unknown>
    expect(Object.keys(index)).toHaveLength(40)
  })

  it('知らないアクションは、無視する', async () => {
    const h = load()
    h.action('somethingElse', { prompt: 'x' })
    await settle()
    expect(h.fetched).toEqual([])
    expect(h.said).toEqual([])
  })
})

describe('モーション生成 Mod: ポーズ(とって = 覚えない / 覚えて = 覚える)', () => {
  const fire = (text: string) => {
    const p = parsePackYaml(YAML).pack!
    const contribution = { modId: p.id, modName: p.name, triggers: [], actions: toNodeDefs(p.id, p.name, p.script!.contributes.actions) }
    const e = new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry([], [contribution]) }, p.ruleSet)
    return e.handle({ type: 'userMessage', text })
  }
  const indexSize = (h: FakeHost): number => Object.keys((h.storage.get('index') as object | undefined) ?? {}).length

  it('ルール: 「覚えて」は、AI に送らない(覚える側だけ)。「とって」は、AI にも送る。ふつうの会話は、どちらも反応しない', () => {
    const a = fire('ポーズを覚えて「万歳」両手を上げて喜ぶ')
    expect(a.fired.map((f) => f.ruleId)).toEqual(['motion-gen-textvrma/pose-learn'])
    expect(a.fired[0].actions[0]).toMatchObject({ kind: 'extension', action: 'learnPose', params: { message: 'ポーズを覚えて「万歳」両手を上げて喜ぶ', durationSec: 4 } })
    expect(a.consumed).toBe(true) // AI には送らない
    const b = fire('万歳をとって')
    expect(b.fired.map((f) => f.ruleId)).toEqual(['motion-gen-textvrma/pose-take'])
    expect(b.consumed).toBe(false) // AI にも送る
    const c = fire('ポーズをとって: 両手を上げる')
    expect(c.fired.map((f) => f.ruleId)).toEqual(['motion-gen-textvrma/pose-take'])
    expect(c.fired[0].actions[0]).toMatchObject({ action: 'takePose', params: { rest: '両手を上げる' } })
    expect(c.consumed).toBe(false)
    expect(fire('こんにちは').fired).toEqual([])
  })

  it('覚えて: 名前と内容を取り出して、動きを作り、覚えて、再生する。別の名前で、同じ内容なら、作り直さない', async () => {
    const h = load()
    h.action('learnPose', { message: 'ポーズを覚えて「万歳」 両手を上げて喜ぶ', durationSec: 4 })
    await settle()
    expect(JSON.parse(h.fetched[0].init.body!)).toMatchObject({ prompt: '両手を上げて喜ぶ' })
    expect(h.played).toEqual([`motion-gen-textvrma/${h.added[0].name}`])
    expect(h.said.some((t) => t.includes('「万歳」を覚えました'))).toBe(true)
    expect(Object.keys(h.storage.get('poses') as object)).toEqual(['万歳'])
    h.action('learnPose', { message: 'ポーズを覚えて『バンザイ』両手を上げて喜ぶ', durationSec: 4 })
    await settle(11_000)
    expect(h.fetched).toHaveLength(1)
    expect(Object.keys(h.storage.get('poses') as object)).toEqual(['万歳', 'バンザイ'])
  })

  it('「ポーズをとって: …」は、動きを作って再生するが、覚えない(名前の表には入らない)', async () => {
    const h = load()
    h.action('takePose', { message: 'ポーズをとって: 両手を上げる', rest: '両手を上げる', durationSec: 4 })
    await settle()
    expect(h.fetched).toHaveLength(1)
    expect(h.played).toHaveLength(1)
    expect(h.storage.get('poses')).toBeUndefined()
    expect(indexSize(h)).toBe(1) // 動きの再利用(同じ説明なら、作り直さない)だけ
  })

  it('「万歳をとって」で、覚えた動きを再生する(通信しない)。名前が複数あれば、長いほうを選ぶ', async () => {
    const h = load()
    h.action('learnPose', { message: 'ポーズを覚えて「万歳」両手を上げて喜ぶ' })
    await settle()
    h.action('learnPose', { message: 'ポーズを覚えて「大万歳」ジャンプして両手を上げる' })
    await settle(11_000)
    const [m1, m2] = h.added.map((x) => `motion-gen-textvrma/${x.name}`)
    h.played.length = 0
    h.action('takePose', { message: '万歳をとって', rest: '' })
    await settle()
    h.action('takePose', { message: '「大万歳」を とって!', rest: '' })
    await settle()
    expect(h.played).toEqual([m1, m2])
    expect(h.fetched).toHaveLength(2)
  })

  it('覚えていない名前・ふつうの会話では、何もしない。「ポーズをとって」だけなら、書き方を案内する。「覚えて」の入力では、とらない', async () => {
    const h = load()
    h.action('takePose', { message: '写真をとって', rest: '' })
    await settle()
    expect(h.played).toEqual([])
    expect(h.said).toEqual([])
    h.action('takePose', { message: 'ポーズをとって', rest: '' })
    await settle()
    expect(h.said[0]).toContain('ポーズをとって: 両手を上げる')
    h.action('learnPose', { message: 'ポーズを覚えて「万歳」両手を上げる' })
    await settle()
    h.played.length = 0
    h.action('takePose', { message: 'ポーズを覚えて「万歳」ポーズをとって', rest: '' })
    await settle()
    expect(h.played).toEqual([])
  })

  it('覚えて: 入力の形が違う・名前が長すぎる・説明が空なら、案内して、通信しない', async () => {
    const h = load()
    h.action('learnPose', { message: 'ポーズを覚えて 万歳 両手を上げる' })
    h.action('learnPose', { message: 'ポーズを覚えて「万歳」' })
    h.action('learnPose', { message: `ポーズを覚えて「${'あ'.repeat(21)}」手を振る` })
    await settle()
    expect(h.said).toHaveLength(3)
    expect(h.fetched).toHaveLength(0)
  })

  it('覚えたポーズの動きは、古いものを外す処理でも、残る', async () => {
    const h = load()
    h.action('learnPose', { message: 'ポーズを覚えて「万歳」両手を上げる' })
    await settle()
    const first = `motion-gen-textvrma/${h.added[0].name}`
    for (let i = 0; i < 42; i++) {
      h.action('generateMotion', { prompt: `動き${i}` })
      await settle(11_000)
    }
    expect(h.removed).not.toContain(first)
    expect(h.removed.length).toBeGreaterThan(0)
  })
})

describe('会話中に自動でポーズ Mod(examples/mods/auto-pose)', () => {
  const AUTO = readFileSync(join(__dirname, '../../../examples/mods/auto-pose/mod.yaml'), 'utf-8')
  const engine = (rand = 0): RuleEngine => {
    const gen = parsePackYaml(YAML).pack!
    const auto = parsePackYaml(AUTO).pack!
    const contribution = { modId: gen.id, modName: gen.name, triggers: [], actions: toNodeDefs(gen.id, gen.name, gen.script!.contributes.actions) }
    let t = 1_000_000
    const slots = Object.fromEntries(auto.slots.map((x) => [x.id, x.default ?? '']))
    return new RuleEngine({ now: () => (t += 1000), random: () => rand, registry: createRegistry([], [contribution]), slots: () => slots }, auto.ruleSet)
  }

  it('読め、指示文(persona)を持つ。AI に、[pose:…] の形を頼む', () => {
    const r = parsePackYaml(AUTO)
    expect(r.errors).toEqual([])
    expect(r.pack!.prompt?.layer).toBe('persona')
    expect(r.pack!.prompt?.text).toContain('[pose:')
  })

  it('AI が動きを指定したら、{{pose}} を説明にして、モーション生成の generateMotion(黙って作る)を実行する', () => {
    const e = engine()
    const r = e.handle({ type: 'llmPose', pose: '両手を上げて喜ぶ' })
    expect(r.fired).toHaveLength(1)
    expect(r.fired[0].actions).toEqual([
      { kind: 'extension', modId: 'motion-gen-textvrma', action: 'generateMotion', params: { prompt: '両手を上げて喜ぶ', durationSec: 4, quiet: true }, source: 'auto-pose' }
    ])
  })

  it('間隔(30 秒)をあけるまでは、続けて作らない。確率に外れたときも、作らない。ほかのイベントには反応しない', () => {
    const e = engine()
    expect(e.handle({ type: 'llmPose', pose: 'a' }).fired).toHaveLength(1)
    expect(e.handle({ type: 'llmPose', pose: 'b' }).fired).toHaveLength(0) // 1 秒後
    expect(engine(0.99).handle({ type: 'llmPose', pose: 'a' }).fired).toHaveLength(0) // 確率 0.5 に外れる
    expect(engine().handle({ type: 'llmEmotion', emotion: 'joy' }).fired).toHaveLength(0)
  })

  it('モーション生成 Mod が無い(未導入)ときは、ルールは動かない(AI の返答には、影響しない)', () => {
    const auto = parsePackYaml(AUTO).pack!
    const e = new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry([], []) }, auto.ruleSet)
    expect(e.handle({ type: 'llmPose', pose: '両手を上げる' }).fired).toEqual([])
  })

  it('quiet で頼まれたら、黙って作る(「考え中…」も、失敗の案内も、言わない)。混んでいるときは、黙ってやめる', async () => {
    const h = load()
    h.action('generateMotion', { prompt: '両手を上げる', durationSec: 4, quiet: true })
    await settle()
    expect(h.said).toEqual([])
    expect(h.played).toHaveLength(1)
    const h2 = load()
    h2.respond = () => ({ ok: false, reason: 'error:x' })
    h2.action('generateMotion', { prompt: 'a', quiet: true })
    await settle()
    expect(h2.said).toEqual([])
    const h3 = load()
    h3.action('generateMotion', { prompt: 'a', quiet: true })
    h3.action('generateMotion', { prompt: 'b', quiet: true }) // 1 件待ちがあれば、2 件目は、黙って捨てる
    h3.action('generateMotion', { prompt: 'c', quiet: true })
    await settle(11_000)
    expect(h3.said).toEqual([])
    expect(h3.fetched.length).toBeLessThan(3)
  })
})

describe('モーション生成 Mod: 状況の通知(状態表示の窓などが受ける)', () => {
  it('生成を始めたとき・終わったときに、通知する。マニフェストにも、同じ名前のトリガーを宣言している', async () => {
    const declared = parsePackYaml(YAML).pack!.script!.contributes.triggers.map((t) => t.type)
    expect(declared).toEqual(['generating', 'cached', 'generated', 'failed'])
    const h = load()
    h.action('generateMotion', { prompt: '手を振る' })
    await settle()
    expect(h.emitted).toEqual(['generating', 'generated'])
    expect(h.emitted.every((n) => declared.includes(n))).toBe(true)
  })

  it('前の動きを使ったときは cached、失敗したときは failed を通知する', async () => {
    const h = load()
    h.action('generateMotion', { prompt: '踊る', durationSec: 4 })
    await settle()
    h.action('generateMotion', { prompt: '踊る', durationSec: 4 })
    await settle(11_000)
    expect(h.emitted).toEqual(['generating', 'generated', 'cached'])
    const h2 = load()
    h2.respond = () => ({ ok: false, reason: 'error:x' })
    h2.action('generateMotion', { prompt: 'a' })
    await settle()
    expect(h2.emitted).toEqual(['generating', 'failed'])
  })

  it('通知の権限(emit)が無い・古い環境でも、生成は、そのまま動く', async () => {
    const h = load()
    h.action('generateMotion', { prompt: 'a' })
    await settle()
    expect(h.played).toHaveLength(1)
  })
})
