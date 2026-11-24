import { describe, expect, it } from 'vitest'
import { playableMotions } from '../motions/playable'
import { collectMotionRefs } from './motionRefs'
import type { Rule } from './types'

const rule = (id: string, action: Record<string, unknown>): Pick<Rule, 'id' | 'do'> => ({ id, do: [{ action: 'playMotion', ...action }] as Rule['do'] })

describe('モーションを使っているルールの収集', () => {
  const tags = { wave: ['あいさつ'], bow: ['あいさつ', 'ふれあい'], dance1: ['ダンス'] }

  it('名前の指定と、タグの指定(そのタグのモーションすべて)を数える。重複は 1 回', () => {
    const refs = collectMotionRefs([rule('r1', { motion: 'wave' }), rule('r2', { tag: 'あいさつ' }), rule('r3', { motion: 'wave' })], tags)
    expect(refs['wave']).toEqual(['r1', 'r2', 'r3'])
    expect(refs['bow']).toEqual(['r2'])
    expect(refs['dance1']).toBeUndefined()
  })

  it('テンプレート({{slot:…}})・playMotion 以外・空は、数えない', () => {
    const refs = collectMotionRefs(
      [rule('r1', { motion: '{{slot:tap}}' }), rule('r2', { tag: '{{slot:t}}' }), { id: 'r3', do: [{ action: 'say', text: ['x'] }] as Rule['do'] }, rule('r4', { motion: '' })],
      tags
    )
    expect(refs).toEqual({})
  })

  it('1 つのルールが、同じモーションを複数回使っても、1 件', () => {
    const r: Pick<Rule, 'id' | 'do'> = { id: 'r', do: [{ action: 'playMotion', motion: 'wave' }, { action: 'playMotion', motion: 'wave' }] as Rule['do'] }
    expect(collectMotionRefs([r], tags)['wave']).toEqual(['r'])
  })
})

describe('再生できるモーション(モデルの種類ごと)', () => {
  const input = { names: ['idle', 'wave', 'my-vrma', 'my-vmd'], vmd: ['my-vmd'] }
  it('VRM: VMD 以外(VRMA と内蔵)', () => {
    expect(playableMotions('vrm', input)).toEqual(['idle', 'wave', 'my-vrma'])
  })
  it('PMX: すべて(VMD と内蔵と、取り込んだ VRMA は、PMX の骨へ変換して再生する)', () => {
    expect(playableMotions('pmx', input)).toEqual(['idle', 'wave', 'my-vrma', 'my-vmd'])
  })
})
