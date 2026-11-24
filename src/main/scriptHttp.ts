import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isPublicAddress } from '../shared/scripts/origins'
import { checkRequest, clampTimeout, filterHeaders, HTTP_LIMITS, isAddressAllowed, type GateReason } from '../shared/scripts/gate'

// スクリプト Mod の通信を、main が代行する(ADR 0002 §3.3)。スクリプトの窓は、直接は通信できない。
// 守ること: 承認したオリジンへの完全一致 / リダイレクトは追わない / 応答の大きさ・時間に上限 /
// 接続の瞬間に、名前解決の結果がループバックであることを確かめる(DNS リバインディング対策)

export type HttpOutcome =
  | { ok: true; status: number; contentType: string; body: Uint8Array }
  | { ok: false; reason: GateReason | 'redirect-refused' | 'too-big' | 'timeout' | 'not-loopback' | 'bad-header' | `error:${string}` }

export interface HttpRequest {
  method?: unknown
  url?: unknown
  headers?: unknown
  body?: unknown
  /** 制限時間(ミリ秒)。省略は 15 秒。上限 10 分 */
  timeoutMs?: unknown
}

/**
 * @param publicOnlyOrigins allowedOrigins のうち、利用者が設定で足したオリジン(外部のサイト)。接続の瞬間の名前解決の結果が、公開のアドレスでなければ断る
 *   (自分の PC・内部ネットワークへ、向けさせない)
 */
export function gatedFetch(allowedOrigins: readonly string[], req: HttpRequest, publicOnlyOrigins: readonly string[] = []): Promise<HttpOutcome> {
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : ''
  const body = typeof req.body === 'string' ? req.body : undefined
  if (req.body !== undefined && body === undefined) return Promise.resolve({ ok: false, reason: 'bad-url' })
  const gate = checkRequest(allowedOrigins, method, typeof req.url === 'string' ? req.url : '', body ? Buffer.byteLength(body) : 0)
  if (!gate.ok) return Promise.resolve({ ok: false, reason: gate.reason })
  const headers = filterHeaders(req.headers)
  if (!headers) return Promise.resolve({ ok: false, reason: 'bad-header' })
  const url = gate.url
  const declaredHost = url.hostname
  const publicOnly = publicOnlyOrigins.includes(url.origin)

  return new Promise((resolve) => {
    let settled = false
    // done() が、接続の最初(名前解決)から呼ばれうるので、timer は、先に宣言しておく(あとで代入する)
    // eslint-disable-next-line prefer-const
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (r: HttpOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const client = url.protocol === 'https:' ? https : http
    const r = client.request(
      url,
      {
        method,
        headers: { ...headers, ...(body ? { 'content-length': String(Buffer.byteLength(body)) } : {}) },
        agent: false,
        // 接続の瞬間の名前解決で、アドレスを確かめる(確認と接続の間に、結果が変わっても、外へ出さない)
        lookup: (hostname, options, cb) => {
          dnsLookup(hostname, { ...options, all: true }, (err, list) => {
            if (err) return cb(err, '', 0)
            const allowed = (list as LookupAddress[]).filter((a) => (publicOnly ? isPublicAddress(a.address) : isAddressAllowed(declaredHost, a.address)))
            if (allowed.length === 0) {
              done({ ok: false, reason: 'not-loopback' })
              return cb(new Error('not-loopback'), '', 0)
            }
            if (options.all) (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, allowed)
            else cb(null, allowed[0].address, allowed[0].family)
          })
        }
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400) {
          res.resume()
          return done({ ok: false, reason: 'redirect-refused' })
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > HTTP_LIMITS.maxResponseBytes) {
            r.destroy()
            return done({ ok: false, reason: 'too-big' })
          }
          chunks.push(c)
        })
        res.on('end', () => done({ ok: true, status, contentType: String(res.headers['content-type'] ?? ''), body: new Uint8Array(Buffer.concat(chunks)) }))
        res.on('error', (e) => done({ ok: false, reason: `error:${e.message}` }))
      }
    )
    timer = setTimeout(() => {
      r.destroy()
      done({ ok: false, reason: 'timeout' })
    }, clampTimeout(req.timeoutMs))
    r.on('error', (e) => done({ ok: false, reason: `error:${e.message}` }))
    if (body) r.write(body)
    r.end()
  })
}
