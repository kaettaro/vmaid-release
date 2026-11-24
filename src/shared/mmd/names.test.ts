import { describe, expect, it } from 'vitest'
import { isVmd, morphCandidates } from './names'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('MMD 対応 Mod の純粋ロジック', () => {
  it('VMD の印を見分ける。VRMA(glTF)や短いデータは、VMD ではない', () => {
    expect(isVmd(bytes('Vocaloid Motion Data 0002\0\0\0\0\0'))).toBe(true)
    expect(isVmd(bytes('glTF\u0002\0\0\0'))).toBe(false)
    expect(isVmd(bytes('Vocaloid'))).toBe(false)
    expect(isVmd(new Uint8Array(0))).toBe(false)
  })

  it('VRM 風の表情名を、MMD のモーフ名に対応づける。知らない名前は空', () => {
    expect(morphCandidates('blink')).toContain('まばたき')
    expect(morphCandidates('aa')).toEqual(['あ'])
    expect(morphCandidates('nothing')).toEqual([])
  })
})
