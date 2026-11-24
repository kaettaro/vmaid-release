import { describe, expect, it } from 'vitest'
import { sanitizeIcon, sanitizeLink, sanitizeUiList, UI_LIMITS } from './uiList'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

describe('sanitizeIcon', () => {
  it('形式と先頭のバイト列が合う data: 画像だけ通す', () => {
    expect(sanitizeIcon(PNG)).toBe(PNG)
    expect(sanitizeIcon('data:image/x-icon;base64,AAABAAEAEBAA')).not.toBe('')
  })
  it('名乗りと中身が合わない・svg・http・長すぎるものは、空', () => {
    expect(sanitizeIcon('data:image/png;base64,AAABAAEAEBAA')).toBe('')
    expect(sanitizeIcon('data:image/svg+xml;base64,PHN2Zz4=')).toBe('')
    expect(sanitizeIcon('https://example.com/a.png')).toBe('')
    expect(sanitizeIcon(PNG + 'A'.repeat(UI_LIMITS.maxIconChars))).toBe('')
    expect(sanitizeIcon(123)).toBe('')
  })
})

describe('sanitizeLink', () => {
  it('https だけ通す', () => {
    expect(sanitizeLink('https://gigazine.net/news/20260101-x/')).toBe('https://gigazine.net/news/20260101-x/')
    expect(sanitizeLink('http://example.com/')).toBe('')
    expect(sanitizeLink('javascript:alert(1)')).toBe('')
    expect(sanitizeLink('file:///C:/a')).toBe('')
    expect(sanitizeLink('https://user:pw@example.com/')).toBe('')
    expect(sanitizeLink('https://example.com/' + 'a'.repeat(UI_LIMITS.maxLink))).toBe('')
  })
})

describe('sanitizeUiList', () => {
  it('項目を整える(制御文字・空白・長さ・未読)', () => {
    const l = sanitizeUiList({ title: ' ニュース ', icons: { g: PNG }, items: [{ id: 'a', title: 'こんにちは\n\u0000世界', subtitle: 'S', unread: true, link: 'https://x.example/a', icon: 'g' }] })
    expect(l.title).toBe('ニュース')
    expect(l.icons).toEqual({ g: PNG })
    expect(l.items[0]).toEqual({ id: 'a', title: 'こんにちは 世界', subtitle: 'S', icon: 'g', link: 'https://x.example/a', unread: true })
    expect(sanitizeUiList({ items: [{ id: 'a', title: 'あ'.repeat(500) }] }).items[0]!.title).toHaveLength(UI_LIMITS.maxTitle)
  })
  it('壊れた項目・重複・多すぎる項目を捨てる', () => {
    const items = [null, 5, { id: '', title: 'x' }, { id: 'a' }, { id: 'a', title: '1' }, { id: 'a', title: '2' }, ...Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, title: 't' }))]
    const l = sanitizeUiList({ items })
    expect(l.items[0]!.title).toBe('1')
    expect(l.items).toHaveLength(UI_LIMITS.maxItems)
  })
  it('文字列でない・不正な link/icon は空にして、項目は残す', () => {
    const l = sanitizeUiList({ icons: { bad: 'x', 'a b': PNG }, items: [{ id: 'a', title: 't', link: 'http://x', icon: 'bad', unread: 'yes' }] })
    expect(l.icons).toEqual({})
    expect(l.items[0]).toMatchObject({ link: '', icon: '', unread: false })
  })
  it('何でもないものは、空の一覧', () => {
    expect(sanitizeUiList(undefined)).toEqual({ title: '', empty: '', icons: {}, items: [] })
    expect(sanitizeUiList({ items: 'x' }).items).toEqual([])
  })
})
