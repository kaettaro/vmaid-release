import { describe, expect, it } from 'vitest'
import { checkedCharacters, normalizeCharacters, toggleRuleCharacter } from './characters'

const ALL = ['a', 'b', 'c']

describe('ルールの対象キャラ', () => {
  it('未指定のときは全員がチェック済みに見える', () => {
    expect(checkedCharacters(undefined, ALL)).toEqual(ALL)
    expect(checkedCharacters([], ALL)).toEqual(ALL)
    expect(checkedCharacters(['b'], ALL)).toEqual(['b'])
  })

  it('未指定から1人外すと、残りの明示リストになる', () => {
    expect(toggleRuleCharacter(undefined, ALL, 'b', false)).toEqual(['a', 'c'])
  })

  it('全員が揃ったら未指定に戻る', () => {
    expect(toggleRuleCharacter(['a', 'c'], ALL, 'b', true)).toBeUndefined()
  })

  it('最後の1人を外すと未指定(全キャラ)になる', () => {
    expect(toggleRuleCharacter(['a'], ALL, 'a', false)).toBeUndefined()
  })

  it('一部だけ選ぶ', () => {
    expect(toggleRuleCharacter(['a'], ALL, 'c', true)).toEqual(['a', 'c'])
  })

  it('normalize: 空は未指定、全員は未指定、一部はそのまま', () => {
    expect(normalizeCharacters([], ALL)).toBeUndefined()
    expect(normalizeCharacters(['c', 'a', 'b'], ALL)).toBeUndefined()
    expect(normalizeCharacters(['a'], ALL)).toEqual(['a'])
  })
})
