import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// 名前解決を差し替えられるようにする(DNS リバインディングの試験用)。既定は、本物を使う
const state = vi.hoisted(() => ({ fake: null as null | { address: string; family: number } }))
vi.mock('node:dns', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:dns')>()
  return {
    ...real,
    default: real,
    lookup: ((hostname: string, options: object, cb: (e: Error | null, list?: unknown) => void) => {
      if (state.fake) return cb(null, [state.fake])
      return (real.lookup as unknown as (h: string, o: object, c: unknown) => void)(hostname, options, cb)
    }) as unknown as typeof real.lookup
  }
})
import { HTTP_LIMITS } from '../shared/scripts/gate'
import { gatedFetch } from './scriptHttp'

const hits: string[] = []
let server: http.Server
let origin = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://127.0.0.1:1/redirected' })
      return res.end()
    }
    if (req.url === '/big') {
      res.writeHead(200)
      return res.end(Buffer.alloc(HTTP_LIMITS.maxResponseBytes + 1024))
    }
    if (req.url === '/slow') {
      return void setTimeout(() => res.end('late'), 3000)
    }
    if (req.url === '/echo') {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(`${req.method}:${req.headers['x-api-key'] ?? ''}:${b}`)
      })
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.close()
})

describe('gatedFetch(スクリプト Mod の通信の代行)', () => {
  it('宣言したオリジンへの GET / POST が通り、ヘッダーと本文が届く', async () => {
    const r = await gatedFetch([origin], { method: 'GET', url: `${origin}/` })
    expect(r.ok && new TextDecoder().decode(r.body)).toBe('ok')
    const p = await gatedFetch([origin], { method: 'post', url: `${origin}/echo`, headers: { 'X-API-Key': 'k' }, body: 'hello' })
    expect(p.ok && new TextDecoder().decode(p.body)).toBe('POST:k:hello')
  })

  it('宣言していないオリジン・別ポート・禁止のヘッダー・DELETE は、サーバーに届く前に断る', async () => {
    hits.length = 0
    const other = `http://127.0.0.1:${Number(origin.split(':')[2]) + 1}`
    expect(await gatedFetch([origin], { method: 'GET', url: `${other}/` })).toEqual({ ok: false, reason: 'origin-not-allowed' })
    expect(await gatedFetch([origin], { method: 'GET', url: `${origin}/`, headers: { Host: 'evil' } })).toEqual({ ok: false, reason: 'bad-header' })
    expect(await gatedFetch([origin], { method: 'DELETE', url: `${origin}/` })).toEqual({ ok: false, reason: 'method' })
    expect(await gatedFetch([origin], { method: 'GET', url: `${origin}/`, body: 123 })).toEqual({ ok: false, reason: 'bad-url' })
    expect(hits).toEqual([])
  })

  it('リダイレクトは追わない。大きすぎる応答は、途中で断る', async () => {
    expect(await gatedFetch([origin], { method: 'GET', url: `${origin}/redirect` })).toEqual({ ok: false, reason: 'redirect-refused' })
    expect(await gatedFetch([origin], { method: 'GET', url: `${origin}/big` })).toEqual({ ok: false, reason: 'too-big' })
  })

  it('要求ごとの制限時間(timeoutMs)で、遅い応答を断る。短すぎる指定は 1 秒に、長すぎる指定は上限に丸める', async () => {
    const t0 = Date.now()
    expect(await gatedFetch([origin], { method: 'GET', url: `${origin}/slow`, timeoutMs: 1000 })).toEqual({ ok: false, reason: 'timeout' })
    expect(Date.now() - t0).toBeLessThan(2500)
    expect(await gatedFetch([origin], { method: 'GET', url: `${origin}/slow`, timeoutMs: 5 })).toEqual({ ok: false, reason: 'timeout' }) // 1 秒に丸められる
    const ok = await gatedFetch([origin], { method: 'GET', url: `${origin}/slow`, timeoutMs: 999_999_999 }) // 上限(10分)に丸められ、3秒で応答が返る
    expect(ok.ok).toBe(true)
  }, 15_000)

  it('宣言が localhost でも、接続の瞬間に、名前がループバック以外に解決されたら、断る(DNS リバインディング)', async () => {
    const port = origin.split(':')[2]
    try {
      state.fake = { address: '10.0.0.1', family: 4 }
      hits.length = 0
      const r = await gatedFetch([`http://localhost:${port}`], { method: 'GET', url: `http://localhost:${port}/` })
      expect(r).toEqual({ ok: false, reason: 'not-loopback' })
      expect(hits).toEqual([])
    } finally {
      state.fake = null
    }
    const ok = await gatedFetch([`http://localhost:${port}`], { method: 'GET', url: `http://localhost:${port}/` })
    expect(ok.ok).toBe(true)
  })
})
