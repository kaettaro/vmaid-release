import { describe, expect, it } from 'vitest'
import { parsePackYaml } from './manifest'

const yaml = (prompt: string): string => `id: state-prompt-test
name: テスト
version: "1.0"
distribution: private
description: 状態のときだけ足す指示文
${prompt}`

describe('prompt.whenState', () => {
  it('whenState つきの指示文を読める', () => {
    const r = parsePackYaml(yaml('prompt:\n  layer: state\n  whenState: trance\n  text: ぼんやり話す'))
    expect(r.errors).toEqual([])
    expect(r.pack?.prompt).toEqual({ layer: 'state', whenState: 'trance', text: 'ぼんやり話す' })
  })

  it('whenState は省略できる(常に足す)', () => {
    const r = parsePackYaml(yaml('prompt:\n  text: やさしく話す'))
    expect(r.errors).toEqual([])
    expect(r.pack?.prompt?.whenState).toBeUndefined()
  })

  it('状態の名前が長すぎるものは、はじく', () => {
    const r = parsePackYaml(yaml(`prompt:\n  whenState: ${'a'.repeat(25)}\n  text: あ`))
    expect(r.pack).toBeNull()
  })
})

describe('スロットの kind: choice / effect', () => {
  it('choice は options から選べ、effect は名前で持つ', () => {
    const r = parsePackYaml(yaml('slots:\n  - { id: tone, label: 口調, kind: choice, default: a, options: [{ value: a, label: A }, { value: b, label: B }] }\n  - { id: fx, label: 効果, kind: effect, default: spiral }\n'))
    expect(r.errors).toEqual([])
    expect(r.pack?.slots).toMatchObject([{ id: 'tone', kind: 'choice', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }, { id: 'fx', kind: 'effect', default: 'spiral' }])
  })
  it('choice に options が無いと、エラー', () => {
    const r = parsePackYaml(yaml('slots:\n  - { id: tone, label: 口調, kind: choice }\n'))
    expect(r.pack).toBeNull()
    expect(r.errors.join()).toContain('options')
  })
})
