import { describe, expect, it } from 'vitest'
import { countToday, DEFAULT_TALK, EMPTY_LOG, inQuietHours, parseTalkLog, recordTalk, TalkSchema, talkBlock, type TalkSettings } from './gate'

const at = (h: number, m = 0, day = 15): number => new Date(2026, 9, day, h, m).getTime()
const s = (over: Partial<TalkSettings> = {}): TalkSettings => ({ ...DEFAULT_TALK, ...over })

describe('設定の読み込み', () => {
  it('既定: 静かにしてはOFF・最小 10 分・1 日 20 回・夜 23:00〜7:00 は話しかけない', () => {
    expect(DEFAULT_TALK).toEqual({ muted: false, minGapMin: 10, dailyLimit: 20, quietEnabled: true, quietFrom: '23:00', quietTo: '07:00' })
  })

  it('壊れた値は、既定に戻す。範囲外は、範囲内へ', () => {
    const r = TalkSchema.parse({ minGapMin: -5, dailyLimit: 99999, quietFrom: '25:00', quietTo: 'x', muted: 'yes' })
    expect(r.minGapMin).toBe(0)
    expect(r.dailyLimit).toBe(1000)
    expect(r.quietFrom).toBe('23:00')
    expect(r.quietTo).toBe('07:00')
    expect(r.muted).toBe(false)
    expect(TalkSchema.parse({})).toEqual(DEFAULT_TALK)
  })
})

describe('夜間', () => {
  it('日をまたぐ時間帯(23:00〜07:00)', () => {
    const q = s()
    expect(inQuietHours(q, at(22, 59))).toBe(false)
    expect(inQuietHours(q, at(23, 0))).toBe(true)
    expect(inQuietHours(q, at(3))).toBe(true)
    expect(inQuietHours(q, at(6, 59))).toBe(true)
    expect(inQuietHours(q, at(7, 0))).toBe(false)
  })
  it('日をまたがない時間帯・OFF・開始 = 終了', () => {
    expect(inQuietHours(s({ quietFrom: '12:00', quietTo: '13:00' }), at(12, 30))).toBe(true)
    expect(inQuietHours(s({ quietFrom: '12:00', quietTo: '13:00' }), at(13, 0))).toBe(false)
    expect(inQuietHours(s({ quietEnabled: false }), at(3))).toBe(false)
    expect(inQuietHours(s({ quietFrom: '09:00', quietTo: '09:00' }), at(9, 30))).toBe(false)
  })
})

describe('話しかけてよいか', () => {
  it('何も控える理由が無ければ、null', () => {
    expect(talkBlock(s(), EMPTY_LOG, at(12), false)).toBeNull()
  })

  it('理由ごとに、控える(優先: 静かにして → 会話中 → 夜間 → 間隔 → 上限)', () => {
    expect(talkBlock(s({ muted: true }), EMPTY_LOG, at(12), false)).toBe('muted')
    expect(talkBlock(s(), EMPTY_LOG, at(12), true)).toBe('busy')
    expect(talkBlock(s(), EMPTY_LOG, at(23, 30), false)).toBe('quiet')
    expect(talkBlock(s({ muted: true }), EMPTY_LOG, at(23, 30), true)).toBe('muted')
  })

  it('最小の間隔: 前の話しかけから 10 分たつまでは、控える。0 分なら、いつでも', () => {
    const log = recordTalk(EMPTY_LOG, at(12, 0))
    expect(talkBlock(s(), log, at(12, 9), false)).toBe('gap')
    expect(talkBlock(s(), log, at(12, 10), false)).toBeNull()
    expect(talkBlock(s({ minGapMin: 0 }), log, at(12, 0), false)).toBeNull()
  })

  it('1 日の上限: 超えたら控える。日が変われば、また数える。0 は無制限', () => {
    let log = EMPTY_LOG
    for (let i = 0; i < 3; i++) log = recordTalk(log, at(9 + i))
    expect(countToday(log, at(13))).toBe(3)
    expect(talkBlock(s({ dailyLimit: 3, minGapMin: 0 }), log, at(13), false)).toBe('limit')
    expect(talkBlock(s({ dailyLimit: 3, minGapMin: 0 }), log, at(13, 0, 16), false)).toBeNull() // 翌日
    expect(countToday(log, at(13, 0, 16))).toBe(0)
    expect(talkBlock(s({ dailyLimit: 0, minGapMin: 0 }), log, at(13), false)).toBeNull()
  })
})

describe('記録', () => {
  it('話しかけるたびに、回数と時刻が更新される。日が変わると、回数は 1 から', () => {
    const a = recordTalk(EMPTY_LOG, at(9))
    const b = recordTalk(a, at(10))
    expect(b).toEqual({ lastAt: at(10), day: '2026-10-15', count: 2 })
    expect(recordTalk(b, at(9, 0, 16))).toEqual({ lastAt: at(9, 0, 16), day: '2026-10-16', count: 1 })
  })

  it('保存してあった記録が壊れていても、空として読む', () => {
    expect(parseTalkLog(null)).toEqual(EMPTY_LOG)
    expect(parseTalkLog({ lastAt: 'x', day: 5, count: -3 })).toEqual({ lastAt: null, day: '', count: 0 })
    expect(parseTalkLog({ lastAt: 123, day: '2026-10-15', count: 4 })).toEqual({ lastAt: 123, day: '2026-10-15', count: 4 })
  })
})
