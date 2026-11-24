import { describe, expect, it } from 'vitest'
import { diffEnded } from './looks'

describe('状態の終わりの検出', () => {
  it('前回あって、いまは無い状態だけが、終わったことになる', () => {
    expect(diffEnded(new Set(['a', 'b']), new Set(['b', 'c']))).toEqual(['a'])
    expect(diffEnded(new Set(), new Set(['a']))).toEqual([])
    expect(diffEnded(new Set(['a']), new Set())).toEqual(['a'])
  })
})
