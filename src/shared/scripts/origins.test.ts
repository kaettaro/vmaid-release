import { describe, expect, it } from 'vitest'
import { effectiveOrigins, isPublicAddress, isPublicHost, MAX_URLS, newOrigins, parseUrlList } from './origins'

describe('公開のアドレスか', () => {
  it('ループバック・私用・リンクローカル・CGNAT・予約は、不可。公開のものは、可', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:192.168.0.1', '300.1.1.1']) {
      expect(isPublicAddress(a)).toBe(false)
    }
    for (const a of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '203.0.113.5', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(a)).toBe(true)
  })

  it('名前: localhost・.local・.internal・単一ラベルは、不可。ふつうのドメインは、可', () => {
    for (const h of ['localhost', 'foo.localhost', 'printer.local', 'a.internal', 'nas', '', '127.0.0.1', '10.0.0.1', '[::1]', '[fd00::1]']) expect(isPublicHost(h)).toBe(false)
    for (const h of ['www3.nhk.or.jp', 'example.com', 'feeds.bbci.co.uk', '8.8.8.8', '[2606:4700::1111]']) expect(isPublicHost(h)).toBe(true)
  })
})

describe('URL の一覧(設定の欄)', () => {
  it('1 行に 1 つ。空行・# の行は飛ばし、重複は 1 つにして、オリジンも返す', () => {
    const r = parseUrlList('# ニュース\nhttps://example.com/rss.xml\n\n  https://example.com/rss.xml  \nhttps://feeds.example.org/a?x=1\r\n')
    expect(r).toEqual({ ok: true, urls: ['https://example.com/rss.xml', 'https://feeds.example.org/a?x=1'], origins: ['https://example.com', 'https://feeds.example.org'] })
    expect(parseUrlList('')).toEqual({ ok: true, urls: [], origins: [] })
  })

  it('https 以外・ユーザー名つき・内部の URL・形が違うもの・多すぎる・長すぎるものは、断る(どれか 1 つでも)', () => {
    for (const bad of ['http://example.com/rss', 'ftp://example.com/x', 'https://user:pw@example.com/x', 'https://localhost/rss', 'https://192.168.0.5/rss', 'https://nas/rss', 'javascript:alert(1)', 'example.com/rss']) {
      expect(parseUrlList(`https://ok.example.com/a\n${bad}`).ok).toBe(false)
    }
    expect(parseUrlList(Array.from({ length: MAX_URLS + 1 }, (_, i) => `https://s${i}.example.com/x`).join('\n')).ok).toBe(false)
    expect(parseUrlList(`https://example.com/${'a'.repeat(600)}`).ok).toBe(false)
  })

  it('承認: まだのオリジンだけを返す。使えるのは、いま書かれていて、承認済みのものだけ(消すと、使えなくなる)', () => {
    expect(newOrigins(['https://a.example', 'https://b.example'], ['https://a.example'])).toEqual(['https://b.example'])
    const text = 'https://a.example/rss\nhttps://b.example/rss'
    expect(effectiveOrigins(text, ['https://a.example', 'https://c.example'])).toEqual(['https://a.example'])
    expect(effectiveOrigins('https://a.example/rss', [])).toEqual([])
    expect(effectiveOrigins('壊れている', ['https://a.example'])).toEqual([])
  })
})
