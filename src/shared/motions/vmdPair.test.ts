import { describe, expect, it } from 'vitest'
import { pairStem, planVmdPairs } from './vmdPair'

describe('体と表情の VMD の組み合わせ', () => {
  it('比べる名前: 体・表情を表す語を終わりから除く', () => {
    expect(pairStem('/a/曲名_body.vmd')).toBe('曲名')
    expect(pairStem('/a/曲名_face.vmd')).toBe('曲名')
    expect(pairStem('C:\\a\\曲名 表情.vmd')).toBe('曲名')
    expect(pairStem('/a/曲名(モーフ).vmd')).toBe('曲名')
    expect(pairStem('/a/曲名.vmd')).toBe('曲名')
    expect(pairStem('/a/body.vmd')).toBe('body') // 語だけの名前は、そのまま
  })

  it('同じフォルダ・同じ名前のまとまりで、表情を体に足す', () => {
    const plan = planVmdPairs([
      { path: '/a/dance_body.vmd', kind: 'body' },
      { path: '/a/dance_face.vmd', kind: 'face' },
      { path: '/a/other.vmd', kind: 'body' }
    ])
    expect(plan.standalone.sort()).toEqual(['/a/dance_body.vmd', '/a/other.vmd'])
    expect(plan.faces.get('/a/dance_body.vmd')).toEqual(['/a/dance_face.vmd'])
  })

  it('フォルダが違えば、組まない。体の無い表情だけのファイルは、単独のまま', () => {
    const plan = planVmdPairs([
      { path: '/a/dance_body.vmd', kind: 'body' },
      { path: '/b/dance_face.vmd', kind: 'face' },
      { path: '/c/solo_face.vmd', kind: 'face' }
    ])
    expect(plan.standalone.sort()).toEqual(['/a/dance_body.vmd', '/b/dance_face.vmd', '/c/solo_face.vmd'])
    expect(plan.faces.size).toBe(0)
  })

  it('体と表情が入った 1 ファイル(both)にも、表情を足せる。体が複数なら、最初の 1 つ', () => {
    const plan = planVmdPairs([
      { path: '/a/x_body.vmd', kind: 'both' },
      { path: '/a/x_face.vmd', kind: 'face' }
    ])
    expect(plan.faces.get('/a/x_body.vmd')).toEqual(['/a/x_face.vmd'])
    expect(plan.standalone).toEqual(['/a/x_body.vmd'])
  })
})
