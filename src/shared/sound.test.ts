import { describe, expect, it } from 'vitest'
import { SePatchSchema, SeSchema, findSound, isAudioPath, parseSounds, soundGain } from './sound'

describe('parseSounds', () => {
  it('壊れた件だけ捨て、音量を丸める', () => {
    const s = parseSounds([{ name: 'ぴこん', path: 'a.mp3', volume: 9 }, { name: '', path: 'x' }, 'x', { name: 'ぽん', path: 'b.wav' }])
    expect(s).toEqual([
      { name: 'ぴこん', path: 'a.mp3', volume: 1 },
      { name: 'ぽん', path: 'b.wav', volume: 1 }
    ])
  })
  it('同じ名前(全角・半角の違い)は、後のものを使う', () => {
    const s = parseSounds([{ name: 'Ding', path: '1.mp3' }, { name: 'ｄｉｎｇ', path: '2.mp3' }])
    expect(s).toHaveLength(1)
    expect(s[0].path).toBe('2.mp3')
  })
  it('配列でなければ空', () => expect(parseSounds(null)).toEqual([]))
})

describe('設定', () => {
  it('空でも既定値が入る', () => expect(SeSchema.parse({})).toEqual({ sounds: [], volume: 0.8 }))
  it('パッチは、知らない項目を受け付けない', () => {
    expect(SePatchSchema.safeParse({ volume: 0.5 }).success).toBe(true)
    expect(SePatchSchema.safeParse({ muted: true }).success).toBe(false)
  })
  it('名前で探す(大小文字・全角半角を区別しない)', () => {
    const s = parseSounds([{ name: 'Ding', path: 'a.mp3' }])
    expect(findSound(s, 'ｄｉｎｇ')?.path).toBe('a.mp3')
    expect(findSound(s, '')).toBeUndefined()
  })
  it('拡張子と音量', () => {
    expect(isAudioPath('C:/x/a.MP3')).toBe(true)
    expect(isAudioPath('C:/x/a.exe')).toBe(false)
    expect(soundGain(0.5, 0.5)).toBeCloseTo(0.25)
  })
})
