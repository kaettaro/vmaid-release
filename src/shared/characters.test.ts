import { describe, expect, it } from 'vitest'
import {
  activeCharacter,
  addCharacter,
  defaultCharacter,
  duplicateCharacter,
  findByModelPath,
  nameFromModelPath,
  newCharacterId,
  normalizeCharacterName,
  removeCharacter,
  type Character
} from './characters'

const A: Character = { ...defaultCharacter('a', '/m/a.vrm'), name: 'A' }
const B: Character = { ...defaultCharacter('b', '/m/b.vrm'), name: 'B' }
const state = (characters: Character[], activeCharacterId: string) => ({ characters, activeCharacterId })

describe('キャラクター', () => {
  it('使われていないIDを発番する', () => {
    expect(newCharacterId([])).toBe('c1')
    expect(newCharacterId(['default'])).toBe('c2')
    expect(newCharacterId(['default', 'c2'])).toBe('c3')
    expect(newCharacterId(['c2', 'c3'])).toBe('c4') // 件数+1が埋まっていても、空いている番号まで進む
  })
  it('名前は前後の空白を除き、1〜40文字。空・長すぎ・制御文字は不可', () => {
    expect(normalizeCharacterName('  ミオ ')).toBe('ミオ')
    expect(normalizeCharacterName('')).toBeNull()
    expect(normalizeCharacterName('あ'.repeat(41))).toBeNull()
    expect(normalizeCharacterName('a\nb')).toBeNull()
  })
  it('モデルのパスから、名前の初期値(拡張子なし)を作る。Windows / Mac どちらの区切りでも', () => {
    expect(nameFromModelPath('/Users/x/Alicia Solid.vrm')).toBe('Alicia Solid')
    expect(nameFromModelPath('C:\\dev\\models\\ミオ.VRM')).toBe('ミオ')
    expect(nameFromModelPath('/x/.vrm')).toBe('ユメ') // 名前が取れなければ既定
  })
  it('モデルのパスでキャラを探す。同じパスが複数あれば、いま使っているキャラを優先する', () => {
    const dup: Character = { ...A, id: 'a2', name: 'Aのコピー' }
    expect(findByModelPath(state([A, B], 'a'), '/m/b.vrm')?.id).toBe('b')
    expect(findByModelPath(state([A, dup], 'a2'), '/m/a.vrm')?.id).toBe('a2')
    expect(findByModelPath(state([A, dup], 'a'), '/m/a.vrm')?.id).toBe('a')
    expect(findByModelPath(state([A], 'a'), '/nope.vrm')).toBeUndefined()
  })
  it('追加: 人格は既定、名前が不正なら既定名。複製: モデルも人格も同じで、名前に「のコピー」', () => {
    const added = addCharacter([A], { name: '  ', modelPath: '/m/c.vrm' })
    expect(added.id).toBe('c2')
    expect(added.characters[1]).toMatchObject({ id: 'c2', name: 'ユメ', modelPath: '/m/c.vrm' })
    const dup = duplicateCharacter([A, B], 'b')!
    expect(dup.characters[2]).toMatchObject({ name: 'Bのコピー', modelPath: '/m/b.vrm', tone: B.tone })
    expect(dup.characters[2].id).not.toBe('b')
    expect(duplicateCharacter([A], 'zzz')).toBeNull()
  })
  it('削除: 最後の1人は消せない。いま使っているキャラを消したら、先頭に切り替わる', () => {
    expect(removeCharacter(state([A], 'a'), 'a')).toBeNull()
    expect(removeCharacter(state([A, B], 'a'), 'zzz')).toBeNull()
    expect(removeCharacter(state([A, B], 'a'), 'a')).toEqual(state([B], 'b'))
    expect(removeCharacter(state([A, B], 'b'), 'a')).toEqual(state([B], 'b'))
  })
  it('activeCharacter: 無効なIDなら先頭', () => {
    expect(activeCharacter(state([A, B], 'b')).id).toBe('b')
    expect(activeCharacter(state([A, B], 'zzz')).id).toBe('a')
  })
})
