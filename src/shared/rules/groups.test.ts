import { describe, expect, it } from 'vitest'
import { ACTIONS } from './definitions'
import { groupDefs, groupOf, ownerLabel, ownerModId } from './groups'

describe('ルールの種類の見出し(所属で分ける)', () => {
  it('標準の種類は「標準」。機能 Mod の種類は、その Mod の名前', () => {
    expect(groupOf({ type: 'playMotion' }).label).toBe('標準')
    expect(groupOf({ type: 'startGame', modId: 'game-any' })).toEqual({ id: 'game-any', label: 'ゲーム' })
    expect(groupOf({ type: 'setMood', modId: 'affection-mood' }).label).toBe('親密度と気分')
  })

  it('スクリプト Mod が足した種類(`<modId>/<種類>`)は、その Mod の id が所属', () => {
    expect(ownerModId({ type: 'my-mod/hello' })).toBe('my-mod')
    expect(groupOf({ type: 'my-mod/hello' }).id).toBe('my-mod')
  })

  it('所属の名前(バッジ用)。標準は無し', () => {
    expect(ownerLabel({ type: 'startGame', modId: 'game-any' })).toBe('ゲーム')
    expect(ownerLabel({ type: 'playMotion' })).toBeUndefined()
  })

  it('groupDefs: 「標準」が先頭。Mod は、最初に出てきた順。数は、元のまま', () => {
    const groups = groupDefs(ACTIONS)
    expect(groups[0].group.label).toBe('標準')
    expect(groups.flatMap((g) => g.defs)).toHaveLength(ACTIONS.length)
    // 標準のものに、modId を持つものが混ざらない
    expect(groups[0].defs.every((d) => d.modId === undefined)).toBe(true)
    // Mod ごとに、同じ見出しの中に集まる(見出しは重複しない)
    const ids = groups.map((g) => g.group.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('標準が最後に出てきても、先頭へ並べる', () => {
    const g = groupDefs([{ type: 'a', modId: 'game' }, { type: 'b' }, { type: 'c', modId: 'se' }])
    expect(g.map((x) => x.group.id)).toEqual(['standard', 'game', 'se'])
  })
})
