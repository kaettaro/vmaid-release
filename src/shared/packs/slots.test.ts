import { describe, expect, it } from 'vitest'
import { resolveSlots } from './slots'

const defs = [{ id: 'words', default: 'a,b' }, { id: 'motion' }]

describe('resolveSlots', () => {
  it('何も決めていないときは、初期値(無ければ空)', () => {
    expect(resolveSlots(defs, undefined, undefined)).toEqual({ words: 'a,b', motion: '' })
  })
  it('全キャラ共通の値が初期値に勝ち、キャラごとの値がさらに勝つ', () => {
    expect(resolveSlots(defs, { words: 'x' }, undefined)).toEqual({ words: 'x', motion: '' })
    expect(resolveSlots(defs, { words: 'x', motion: 'm1' }, { motion: 'm2' })).toEqual({ words: 'x', motion: 'm2' })
  })
  it('キャラごとの空の値は上書きせず、Mod に無いスロットは無視する', () => {
    expect(resolveSlots(defs, { motion: 'm1' }, { motion: '', ghost: 'g' })).toEqual({ words: 'a,b', motion: 'm1' })
  })
})
