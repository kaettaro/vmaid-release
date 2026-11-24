import { describe, expect, it } from 'vitest'
import { checkRequest, filterHeaders, HTTP_LIMITS, isAddressAllowed } from './gate'
import { describePermissions, ScriptSchema, toNodeDefs, type ScriptSpec } from './spec'
import { parsePackYaml } from '../packs/manifest'

const ALLOWED = ['http://127.0.0.1:50021']

describe('host.http のゲート(ADR 0002 §3.3)', () => {
  it('宣言したオリジンへの GET / POST だけを通す', () => {
    expect(checkRequest(ALLOWED, 'GET', 'http://127.0.0.1:50021/speakers', 0).ok).toBe(true)
    expect(checkRequest(ALLOWED, 'POST', 'http://127.0.0.1:50021/x?y=1', 10).ok).toBe(true)
  })

  it('別ポート・前方一致だけの名前・別スキーム・別のホストは、断る', () => {
    const reason = (url: string) => {
      const r = checkRequest(ALLOWED, 'GET', url, 0)
      return r.ok ? 'ok' : r.reason
    }
    expect(reason('http://127.0.0.1:1/')).toBe('origin-not-allowed')
    expect(reason('http://127.0.0.1:50021.evil.example/')).toBe('bad-url') // 数字でないポートは、URL として不正
    expect(reason('http://127.0.0.1.evil.example:50021/')).toBe('origin-not-allowed')
    expect(reason('http://localhost:50021/')).toBe('origin-not-allowed')
    expect(reason('https://127.0.0.1:50021/')).toBe('origin-not-allowed')
    expect(reason('http://evil.example/')).toBe('origin-not-allowed')
    expect(reason('http://user:pw@127.0.0.1:50021/')).toBe('bad-url')
    expect(reason('file:///etc/passwd')).toBe('scheme')
    expect(reason('not a url')).toBe('bad-url')
  })

  it('許可しないメソッド・大きすぎる本文は、断る', () => {
    const m = checkRequest(ALLOWED, 'DELETE', 'http://127.0.0.1:50021/', 0)
    expect(m.ok === false && m.reason).toBe('method')
    const b = checkRequest(ALLOWED, 'POST', 'http://127.0.0.1:50021/', HTTP_LIMITS.maxBodyBytes + 1)
    expect(b.ok === false && b.reason).toBe('body-too-big')
  })

  it('ヘッダーは、許可した名前だけ。改行つきの値・知らない名前は、全体を断る', () => {
    expect(filterHeaders({ 'Content-Type': 'application/json', Authorization: 'Bearer x' })).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer x' })
    expect(filterHeaders(undefined)).toEqual({})
    expect(filterHeaders({ Host: 'evil' })).toBeNull()
    expect(filterHeaders({ 'Content-Type': 'a\r\nX: y' })).toBeNull()
    expect(filterHeaders([])).toBeNull()
  })

  it('宣言が localhost / 127.0.0.1 なら、名前解決の結果がループバックでなければ断る(外部の宣言は、そのまま)', () => {
    expect(isAddressAllowed('127.0.0.1', '127.0.0.1')).toBe(true)
    expect(isAddressAllowed('localhost', '::1')).toBe(true)
    expect(isAddressAllowed('localhost', '10.0.0.1')).toBe(false)
    expect(isAddressAllowed('127.0.0.1', '192.168.1.5')).toBe(false)
    expect(isAddressAllowed('api.example.com', '93.184.216.34')).toBe(true)
  })
})

const HEAD = 'id: s-mod\nname: テスト\nversion: "1"\ndistribution: private\n'

describe('script の宣言(mod.yaml)', () => {
  it('省略した項目は、最小の権限になる', () => {
    const r = ScriptSchema.parse({ apiVersion: 1 })
    expect(r.entry).toBe('main.js')
    expect(r.permissions).toEqual({ network: [], motion: [], say: false, storage: false, emit: false, ai: false, networkFrom: [], context: false, ui: { list: false, openLink: false } })
    expect(r.contributes).toEqual({ triggers: [], actions: [] })
  })

  it('通信先は、オリジンだけ(パス・末尾の / ・ftp は不可)。entry は、Mod の中の .js だけ', () => {
    const ok = (network: string[]) => ScriptSchema.safeParse({ apiVersion: 1, permissions: { network } }).success
    expect(ok(['http://127.0.0.1:50021', 'https://api.example.com'])).toBe(true)
    expect(ok(['http://127.0.0.1:50021/'])).toBe(false)
    expect(ok(['http://127.0.0.1:50021/x'])).toBe(false)
    expect(ok(['ftp://example.com'])).toBe(false)
    expect(ok(['example.com'])).toBe(false)
    const entry = (e: string) => ScriptSchema.safeParse({ apiVersion: 1, entry: e }).success
    expect(entry('lib/main.js')).toBe(true)
    expect(entry('../main.js')).toBe(false)
    expect(entry('/abs.js')).toBe(false)
    expect(entry('main.txt')).toBe(false)
    expect(entry('a\\b.js')).toBe(false)
    expect(ScriptSchema.safeParse({ apiVersion: 2 }).success).toBe(false)
  })

  it('宣言したノードは、ルールの定義(NodeDef)になる(種類名は <Mod の id>/<種類>)', () => {
    const spec: ScriptSpec = ScriptSchema.parse({
      apiVersion: 1,
      contributes: { actions: [{ type: 'gen', label: '生成', params: [{ name: 'prompt', label: '説明', kind: 'string', required: true, template: true }, { name: 'sec', label: '秒', kind: 'number', min: 1, max: 30, default: 4 }] }] }
    })
    const defs = toNodeDefs('s-mod', 'テスト', spec.contributes.actions)
    expect(defs[0].type).toBe('s-mod/gen')
    expect(defs[0].label).toBe('生成(テスト)')
    expect(defs[0].params).toEqual([
      { name: 'prompt', label: '説明', kind: 'string', required: true, template: true },
      { name: 'sec', label: '秒', kind: 'number', min: 1, max: 30, default: 4 }
    ])
  })

  it('権限を日本語で列挙する。外部への通信は、警告(danger)になる', () => {
    const spec = ScriptSchema.parse({ apiVersion: 1, permissions: { network: ['http://127.0.0.1:1', 'https://api.example.com'], motion: ['add', 'play'], say: true, storage: true, emit: true } })
    const lines = describePermissions(spec)
    expect(lines.filter((l) => l.danger)).toHaveLength(1)
    expect(lines.find((l) => l.danger)?.text).toContain('外部')
    expect(lines.some((l) => l.text.includes('モーションを、あなたの一覧に追加'))).toBe(true)
    expect(describePermissions(ScriptSchema.parse({ apiVersion: 1 }))[0].text).toContain('必要ありません')
  })

  it('設定の種類 urls・enum と、権限 networkFrom: networkFrom は urls の項目だけを指せる。enum には options が要る。権限の説明は、外部への通信として、警告(danger)になる', () => {
    const ok = ScriptSchema.safeParse({ apiVersion: 1, settings: [{ name: 'feeds', label: 'フィード', kind: 'urls' }, { name: 'mode', label: '方式', kind: 'enum', options: [{ value: 'a', label: 'A' }] }], permissions: { networkFrom: ['feeds'] } })
    expect(ok.success).toBe(true)
    expect(ScriptSchema.safeParse({ apiVersion: 1, settings: [{ name: 'feeds', label: 'f', kind: 'string' }], permissions: { networkFrom: ['feeds'] } }).success).toBe(false)
    expect(ScriptSchema.safeParse({ apiVersion: 1, permissions: { networkFrom: ['none'] } }).success).toBe(false)
    expect(ScriptSchema.safeParse({ apiVersion: 1, settings: [{ name: 'm', label: 'm', kind: 'enum' }] }).success).toBe(false)
    const lines = describePermissions(ok.data!)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ danger: true })
    expect(lines[0]?.text).toContain('フィード')
    expect(lines[0]?.text).toContain('IP アドレス')
  })

  it('mod.yaml に書ける。配布用(公式)の Mod には、書けない', () => {
    const text = (d: string) => `id: s-mod\nname: テスト\nversion: "1"\ndistribution: ${d}\nscript:\n  apiVersion: 1\n`
    expect(parsePackYaml(text('private')).pack?.script?.entry).toBe('main.js')
    const r = parsePackYaml(text('distributable'))
    expect(r.pack).toBeNull()
    expect(r.errors.join('\n')).toContain('スクリプトを含められません')
    expect(parsePackYaml(`${HEAD}`).pack?.script).toBeNull()
  })
})
