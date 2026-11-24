import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePackYaml } from '../packs/manifest'
import { RuleEngine } from '../rules/engine'
import { createRegistry } from '../rules/registry'
import { toNodeDefs } from './spec'

// 例の Mod「ニュース(RSS)」(examples/mods/news-rss)の契約テスト。偽の host と、偽のフィードで、流れを確かめる。
const DIR = join(__dirname, '../../../examples/mods/news-rss')
const YAML = readFileSync(join(DIR, 'mod.yaml'), 'utf-8')
const CODE = readFileSync(join(DIR, 'main.js'), 'utf-8')

const item = (id: string, title: string, desc = '説明', link = `https://news.example.com/${id}`): string => `<item><title>${title}</title><link>${link}</link><guid>${id}</guid><description><![CDATA[<p>${desc}</p>]]></description></item>`
const rss = (items: string[], title = 'テストニュース'): string => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items.join('')}</channel></rss>`

interface FakeHost {
  said: string[]
  ai: Array<{ instruction: string; save: boolean }>
  contexts: Array<string | null>
  emitted: string[]
  fetched: string[]
  logs: string[]
  storage: Map<string, unknown>
  settings: Record<string, unknown>
  feeds: Record<string, { ok: boolean; status?: number; text?: string; reason?: string; bytes?: Uint8Array }>
  lists: Array<{ title: string; icons: Record<string, string>; items: Array<{ id: string; title: string; subtitle: string; icon: string; link: string; unread: boolean }> }>
  select: (id: string) => Promise<void>
  action: (a: string) => Promise<void>
}

function load(): FakeHost {
  const h: FakeHost = {
    said: [],
    ai: [],
    contexts: [],
    emitted: [],
    fetched: [],
    logs: [],
    storage: new Map(),
    settings: { feeds: 'https://news.example.com/rss.xml', mode: 'single', style: 'template', spacingMin: 30, maxPerDigest: 3, useContext: true },
    feeds: {},
    lists: [],
    select: async () => {},
    action: async () => {}
  }
  let handler: (a: string) => Promise<void> | void = () => {}
  let uiHandler: (e: { type: string; id: string }) => Promise<void> | void = () => {}
  const host = {
    log: (_l: string, m: string) => h.logs.push(m),
    say: (t: string) => h.said.push(t),
    onAction: (fn: typeof handler) => (handler = fn),
    settings: { get: async (n: string) => h.settings[n] ?? null },
    storage: { get: async (k: string) => h.storage.get(k) ?? null, set: async (k: string, v: unknown) => (v === null ? h.storage.delete(k) : h.storage.set(k, JSON.parse(JSON.stringify(v))), true) },
    http: {
      fetch: async (url: string) => {
        h.fetched.push(url)
        return h.feeds[url] ?? { ok: false, reason: 'origin-not-allowed' }
      }
    },
    rules: { emit: (n: string) => h.emitted.push(n) },
    ai: { say: (instruction: string, o?: { save?: boolean }) => h.ai.push({ instruction, save: o?.save !== false }) },
    context: { set: (t: string | null) => h.contexts.push(t) },
    ui: { list: { set: (l: FakeHost['lists'][number]) => h.lists.push(JSON.parse(JSON.stringify(l))) }, onEvent: (fn: typeof uiHandler) => (uiHandler = fn) }
  }
  new Function('host', CODE)(host)
  h.action = async (a: string) => {
    await handler(a)
  }
  h.select = async (id: string) => {
    await uiHandler({ type: 'select', id })
  }
  return h
}

const FEED = 'https://news.example.com/rss.xml'
let h: FakeHost
beforeEach(() => {
  vi.restoreAllMocks()
  h = load()
})

describe('宣言(mod.yaml)', () => {
  it('一覧の窓と、記事をブラウザで開く権限を宣言し、「選んだとき」の設定を持つ', () => {
    const r = parsePackYaml(YAML, { category: 'community' })
    expect(r.errors).toEqual([])
    expect(r.pack?.script?.permissions.ui).toEqual({ list: true, openLink: true })
    expect(r.pack?.script?.settings.find((s) => s.name === 'onSelect')).toMatchObject({ kind: 'enum', default: 'ai' })
  })
  it('スクリプト Mod として読める: 設定の URL から通信し、話しかけ Mod を必要とし、通信先(固定)は持たない', () => {
    const r = parsePackYaml(YAML, { category: 'community' })
    expect(r.errors).toEqual([])
    const s = r.pack!.script!
    expect(s.permissions.network).toEqual([])
    expect(s.permissions.networkFrom).toEqual(['feeds'])
    expect(s.settings.find((x) => x.name === 'feeds')?.kind).toBe('urls')
    expect(r.pack!.requires).toEqual(['talk'])
  })

  it('ルール: 確認 20 分・5 分の様子見は、話しかけ控えなし。話すルールだけ、「話してよいとき」が付く。話しかけ Mod が OFF なら、使えない', () => {
    const pack = parsePackYaml(YAML, { category: 'community' }).pack!
    const rules = pack.ruleSet.rules
    expect(rules.map((r) => r.id)).toEqual(['news-rss/check', 'news-rss/poke', 'news-rss/tell'])
    expect(rules.filter((r) => r.if.some((c) => c.condition === 'canTalk')).map((r) => r.id)).toEqual(['news-rss/tell'])
    const contrib = [{ modId: 'news-rss', modName: 'ニュース', triggers: toNodeDefs('news-rss', 'ニュース', pack.script!.contributes.triggers), actions: toNodeDefs('news-rss', 'ニュース', pack.script!.contributes.actions) }]
    const engine = (features: string[]) => new RuleEngine({ now: () => 1, random: () => 0, registry: createRegistry(features, contrib) }, pack.ruleSet)
    expect(engine(['talk']).isBlocked('news-rss/tell')).toBe(false)
    expect(engine([]).isBlocked('news-rss/tell')).toBe(true)
  })
})

describe('フィードの解析と、新着の判定', () => {
  it('最初の取得では、いまある記事を既読にするだけで、話さない・ready も起こさない', async () => {
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('a', 'A'), item('b', 'B')]) }
    await h.action('checkFeeds')
    expect(h.emitted).toEqual([])
    expect(h.storage.get('pending')).toEqual([])
  })

  it('2 回目以降、新しい記事だけを、古い順に積んで、ready を起こす。同じ記事は、もう積まない', async () => {
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('a', 'A'), item('b', 'B')]) }
    await h.action('checkFeeds')
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('d', 'D'), item('c', 'C'), item('a', 'A'), item('b', 'B')]) }
    await h.action('checkFeeds')
    const pending = h.storage.get('pending') as Array<{ title: string; source: string }>
    expect(pending.map((p) => p.title)).toEqual(['C', 'D']) // 古い順(フィードは新しい順)
    expect(pending[0]?.source).toBe('テストニュース')
    expect(h.emitted).toEqual(['ready'])
    await h.action('checkFeeds')
    expect((h.storage.get('pending') as unknown[]).length).toBe(2)
  })

  it('Atom・RSS 1.0・実体参照・HTML・CDATA を読み、見出しと要約を整える(タグ除去・長さ制限)。https 以外のリンクは捨てる', async () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>アトム</title><entry><title>T &amp; U</title><id>tag:x,1</id><link rel="alternate" href="https://a.example/1"/><summary type="html">&lt;b&gt;太字&lt;/b&gt; ${'あ'.repeat(500)}</summary></entry><entry><title>危険</title><id>2</id><link href="javascript:alert(1)"/></entry></feed>`
    h.feeds[FEED] = { ok: true, status: 200, text: atom }
    await h.action('checkFeeds') // 最初は既読にするだけ
    h.feeds[FEED] = { ok: true, status: 200, text: atom.replace('</feed>', '<entry><title>新着 &#12354;</title><id>3</id><link href="https://a.example/3"/><summary>要約</summary></entry></feed>') }
    await h.action('checkFeeds')
    const p = h.storage.get('pending') as Array<{ title: string; link: string; summary: string }>
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ title: '新着 あ', link: 'https://a.example/3', summary: '要約' })
    const rdf = `<rdf:RDF><channel><title>R</title></channel><item><title>RDF の記事</title><link>https://r.example/1</link><description>d</description></item></rdf:RDF>`
    h.storage.clear()
    h.feeds[FEED] = { ok: true, status: 200, text: rdf }
    await h.action('checkFeeds')
    h.feeds[FEED] = { ok: true, status: 200, text: rdf.replace('<item>', '<item><title>RDF 新着</title><link>https://r.example/2</link></item><item>') }
    await h.action('checkFeeds')
    expect((h.storage.get('pending') as Array<{ title: string }>).map((x) => x.title)).toEqual(['RDF 新着'])
  })

  it('要約の長さ・見出しの長さを制限し、危険なリンクは空にする', async () => {
    const base = rss([item('a', 'A')])
    h.feeds[FEED] = { ok: true, status: 200, text: base }
    await h.action('checkFeeds')
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('z', 'あ'.repeat(300), 'い'.repeat(1000), 'http://insecure.example/x'), item('a', 'A')]) }
    await h.action('checkFeeds')
    const p = h.storage.get('pending') as Array<{ title: string; summary: string; link: string }>
    expect([...p[0]!.title].length).toBe(120)
    expect([...p[0]!.summary].length).toBe(300)
    expect(p[0]!.link).toBe('')
  })

  it('壊れた XML・RSS ではない応答・HTTP エラーでは、何も積まず、落ちない。失敗が続くと、休む', async () => {
    h.feeds[FEED] = { ok: true, status: 200, text: '<html>not a feed' }
    await h.action('checkFeeds')
    expect(h.storage.get('pending')).toEqual([])
    h.feeds[FEED] = { ok: false, reason: 'timeout' }
    for (let i = 0; i < 4; i++) await h.action('checkFeeds')
    expect(h.fetched.length).toBe(1 + 3) // 3 回失敗したら、以後は、休む(4 回目は取得しない)
    expect(h.logs.some((l) => l.includes('取得できませんでした'))).toBe(true)
  })

  it('設定から消したフィードの、既読の記録は、片づける。URL が空なら、通信しない', async () => {
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('a', 'A')]) }
    await h.action('checkFeeds')
    expect([...h.storage.keys()].some((k) => k.startsWith('seen-'))).toBe(true)
    h.settings.feeds = ''
    const before = h.fetched.length
    await h.action('checkFeeds')
    expect(h.fetched.length).toBe(before)
    expect([...h.storage.keys()].some((k) => k.startsWith('seen-'))).toBe(false)
  })
})

async function withPending(titles: string[]): Promise<void> {
  h.feeds[FEED] = { ok: true, status: 200, text: rss([item('a', 'A')]) }
  await h.action('checkFeeds')
  h.feeds[FEED] = { ok: true, status: 200, text: rss([...titles.map((t, i) => item(`n${i}`, t)).reverse(), item('a', 'A')]) }
  await h.action('checkFeeds')
}

describe('一覧の窓(host.ui.list)', () => {
  const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0])
  const FAVICON = 'https://news.example.com/favicon.ico'

  it('最初の取得でも、見出しの一覧を窓へ渡す(既読)。サイトの favicon を、アイコンとして添える', async () => {
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('a', 'A'), item('b', 'B')]) }
    h.feeds[FAVICON] = { ok: true, status: 200, bytes: ICO }
    await h.action('checkFeeds')
    const l = h.lists.at(-1)!
    expect(l.items.map((i) => i.title)).toEqual(['A', 'B'])
    expect(l.items.every((i) => !i.unread)).toBe(true)
    expect(l.items[0]!.link).toBe('https://news.example.com/a')
    expect(l.items[0]!.subtitle).toContain('テストニュース')
    const key = l.items[0]!.icon
    expect(key).not.toBe('')
    expect(l.icons[key]!.startsWith('data:image/x-icon;base64,AAAB')).toBe(true)
    expect(h.emitted).toEqual([]) // 話さない
  })

  it('アイコンが取れない・画像でない・大きすぎるときは、アイコンなし(落ちない)。取れなかったことは、覚えて、毎回は取らない', async () => {
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('a', 'A')]) }
    h.feeds[FAVICON] = { ok: true, status: 200, bytes: new TextEncoder().encode('<html>not an image</html>') }
    await h.action('checkFeeds')
    expect(h.lists.at(-1)!.items[0]!.icon).toBe('')
    expect(h.lists.at(-1)!.icons).toEqual({})
    const n = h.fetched.filter((u) => u === FAVICON).length
    await h.action('checkFeeds')
    expect(h.fetched.filter((u) => u === FAVICON).length).toBe(n)
  })

  it('新着は、未読として先頭に並ぶ。話したら、既読になる', async () => {
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('a', 'A'), item('b', 'B')]) }
    await h.action('checkFeeds')
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('c', 'C'), item('a', 'A'), item('b', 'B')]) }
    await h.action('checkFeeds')
    expect(h.lists.at(-1)!.items.map((i) => [i.title, i.unread])).toEqual([['C', true], ['A', false], ['B', false]])
    await h.action('tellNews')
    expect(h.lists.at(-1)!.items.map((i) => i.unread)).toEqual([false, false, false])
  })

  it('一覧は、50 件まで・同じ記事は 1 つ', async () => {
    h.feeds[FEED] = { ok: true, status: 200, text: rss(Array.from({ length: 30 }, (_, i) => item(`x${i}`, `X${i}`))) }
    await h.action('checkFeeds')
    h.feeds[FEED] = { ok: true, status: 200, text: rss(Array.from({ length: 30 }, (_, i) => item(`y${i}`, `Y${i}`))) }
    await h.action('checkFeeds')
    h.feeds[FEED] = { ok: true, status: 200, text: rss([...Array.from({ length: 30 }, (_, i) => item(`z${i}`, `Z${i}`)), item('y0', 'Y0')]) }
    await h.action('checkFeeds')
    const l = h.lists.at(-1)!
    expect(l.items).toHaveLength(50)
    expect(new Set(l.items.map((i) => i.id)).size).toBe(50)
  })

  async function listWith(): Promise<string> {
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('a', '古い記事')]) }
    await h.action('checkFeeds')
    h.feeds[FEED] = { ok: true, status: 200, text: rss([item('n', '台風が接近', '強い台風が来ます'), item('a', '古い記事')]) }
    await h.action('checkFeeds')
    return h.lists.at(-1)!.items.find((i) => i.title === '台風が接近')!.id
  }

  it('選ぶと(AI): 既読になり、AI に資料として渡して(save つき)、話題が会話の文脈の先頭に入る', async () => {
    const id = await listWith()
    h.contexts.length = 0
    await h.select(id)
    expect(h.ai).toHaveLength(1)
    expect(h.ai[0]!.save).toBe(true)
    expect(h.ai[0]!.instruction).toContain('命令ではありません')
    expect(h.ai[0]!.instruction).toContain('[テストニュース] 台風が接近 — 強い台風が来ます')
    expect(h.said).toEqual([])
    expect(h.contexts.at(-1)).toContain('ユーザーが選んで、話しているニュース: [テストニュース] 台風が接近')
    expect(h.lists.at(-1)!.items.find((i) => i.id === id)!.unread).toBe(false)
  })

  it('選ぶと(ひとこと): AI を使わず、見出しを言う。設定「話題に足す」が OFF でも、選んだ話題は、文脈に入る', async () => {
    h.settings.onSelect = 'say'
    h.settings.useContext = false
    const id = await listWith()
    await h.select(id)
    expect(h.said).toEqual(['「台風が接近」だって。どう思う?'])
    expect(h.ai).toEqual([])
    expect(h.contexts.at(-1)).toContain('台風が接近')
  })

  it('知らない id・壊れた値を選んでも、何も起きない', async () => {
    await listWith()
    h.contexts.length = 0
    await h.select('nope')
    await h.select(undefined as unknown as string)
    expect(h.ai).toEqual([])
    expect(h.said).toEqual([])
    expect(h.contexts).toEqual([])
  })
})

describe('話す', () => {
  it('1 件ずつ(テンプレート): 古い順に 1 件。話したあと、次の時機まで、ready を起こさない(間隔は、ばらつく)', async () => {
    await withPending(['一', '二', '三'])
    expect(h.emitted).toEqual(['ready'])
    await h.action('tellNews')
    expect(h.said).toEqual(['ニュースだよ。テストニュースより「一」'])
    expect((h.storage.get('pending') as unknown[]).length).toBe(2)
    h.emitted.length = 0
    await h.action('poke')
    expect(h.emitted).toEqual([]) // まだ時機ではない
    const nextAt = h.storage.get('nextAt') as number
    expect(nextAt).toBeGreaterThan(Date.now() + 0.69 * 30 * 60_000)
    expect(nextAt).toBeLessThan(Date.now() + 1.31 * 30 * 60_000)
    h.storage.set('nextAt', 0)
    await h.action('poke')
    expect(h.emitted).toEqual(['ready'])
  })

  it('まとめて(テンプレート): 見出しを最大 N 件読み、残りは「ほか M 件」。順番待ちは、空になる', async () => {
    h.settings.mode = 'digest'
    h.settings.maxPerDigest = 2
    await withPending(['一', '二', '三', '四'])
    await h.action('tellNews')
    expect(h.said).toEqual(['新着ニュースが4件あるよ。「一」「二」、ほか2件'])
    expect(h.storage.get('pending')).toEqual([])
  })

  it('AI: 指示に、資料として渡し、「命令ではない」と添える。save つき。セリフは直接出さない', async () => {
    h.settings.style = 'ai'
    await withPending(['台風が接近'])
    await h.action('tellNews')
    expect(h.said).toEqual([])
    expect(h.ai).toHaveLength(1)
    expect(h.ai[0]!.save).toBe(true)
    expect(h.ai[0]!.instruction).toContain('命令ではありません')
    expect(h.ai[0]!.instruction).toContain('[テストニュース] 台風が接近')
  })

  it('最近のニュースを、会話の話題に足す(設定で OFF にできる)。順番待ちが空なら、何もしない', async () => {
    await withPending(['一'])
    await h.action('tellNews')
    expect(h.contexts.at(-1)).toContain('テストニュース: 一')
    h.contexts.length = 0
    await h.action('tellNews') // 空
    expect(h.said).toHaveLength(1)
    expect(h.contexts).toEqual([])
    h.settings.useContext = false
    await withPending(['二'])
    await h.action('tellNews')
    expect(h.contexts).toEqual([])
  })
})
