import { describe, expect, it } from 'vitest'
import { changeAffection, DECAY_FLOOR, DECAY_GRACE_HOURS, defaultCharState, parseCharState, setMood, tickCharState } from './charState'

const T0 = 1_700_000_000_000
const H = 3_600_000

describe('charState(気分・親密度)', () => {
  it('壊れた保存データは既定に戻し、範囲外は丸め、知らない気分は「ふつう」', () => {
    expect(parseCharState(null, T0)).toEqual(defaultCharState(T0))
    expect(parseCharState({ affection: 999, mood: 'angry', moodUntil: 'x', updatedAt: -5 }, T0)).toEqual({ affection: 100, mood: 'normal', moodUntil: null, updatedAt: T0, emotions: {} })
    expect(parseCharState({ affection: -4, mood: 'shy', moodUntil: T0 + 10, updatedAt: T0 - 1 }, T0)).toEqual({ affection: 0, mood: 'shy', moodUntil: T0 + 10, updatedAt: T0 - 1, emotions: {} })
    // 感情値は、保存されて読み戻せる。壊れたもの・減りきったものは、捨てる
    const e = parseCharState({ emotions: { joy: { value: 50, at: T0 }, gone: { value: 1, at: T0 - 3_600_000 }, bad: 'x' } }, T0)
    expect(Object.keys(e.emotions)).toEqual(['joy'])
  })
  it('親密度の増減は 0〜100 に収まり、基準時刻が更新される', () => {
    const s = defaultCharState(T0)
    expect(changeAffection(s, 5, T0 + 1000).affection).toBe(35)
    expect(changeAffection(s, 500, T0 + 1000).affection).toBe(100)
    expect(changeAffection(s, -500, T0 + 1000).affection).toBe(0)
    expect(changeAffection(s, 1, T0 + 1000).updatedAt).toBe(T0 + 1000)
  })
  it('気分: 秒数のあと自動で「ふつう」に戻る。0 秒なら戻らない。知らない気分は「ふつう」', () => {
    const s = setMood(defaultCharState(T0), 'shy', 10, T0)
    expect(s).toMatchObject({ mood: 'shy', moodUntil: T0 + 10_000 })
    expect(tickCharState(s, T0 + 9_999).mood).toBe('shy')
    expect(tickCharState(s, T0 + 10_000)).toMatchObject({ mood: 'normal', moodUntil: null })
    expect(setMood(defaultCharState(T0), 'sad', 0, T0).moodUntil).toBeNull()
    expect(setMood(defaultCharState(T0), 'unknown', 5, T0).mood).toBe('normal')
  })
  it('親密度は、猶予のあとだけゆっくり減り、下限より下には減らない。減らした分を二重に数えない', () => {
    const s = { ...defaultCharState(T0), affection: 50 }
    expect(tickCharState(s, T0 + DECAY_GRACE_HOURS * H).affection).toBe(50) // 猶予の間は減らない
    const later = tickCharState(s, T0 + (DECAY_GRACE_HOURS + 10) * H)
    expect(later.affection).toBeCloseTo(45) // 10時間 × 0.5
    // 続けて同じ時刻で呼んでも、さらに減らない
    expect(tickCharState(later, T0 + (DECAY_GRACE_HOURS + 10) * H).affection).toBeCloseTo(45)
    expect(tickCharState({ ...s, affection: 12 }, T0 + 1000 * H).affection).toBe(DECAY_FLOOR)
    expect(tickCharState({ ...s, affection: 5 }, T0 + 1000 * H).affection).toBe(5) // 下限以下は、そのまま
  })
})
