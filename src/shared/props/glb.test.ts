import { describe, expect, it } from 'vitest'
import { checkGlb } from './glb'
import { makeGlb as glb } from './glbTestUtil'

describe('小道具(glb)の検査', () => {
  it('1ファイルで完結した GLB を通す(data: の埋め込みは可)', () => {
    expect(checkGlb(glb({ asset: { version: '2.0' } })).ok).toBe(true)
    expect(checkGlb(glb({ asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,AAAA', byteLength: 3 }] })).ok).toBe(true)
  })

  it('外部ファイル・URL の参照は、深い所にあっても断る', () => {
    for (const uri of ['tex.png', 'http://example.com/a.bin', '../x.bin', 'file:///c:/x']) {
      const r = checkGlb(glb({ asset: { version: '2.0' }, images: [{ uri }] }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('外部')
    }
    expect(checkGlb(glb({ a: { b: [{ c: { uri: 'x.bin' } }] } })).ok).toBe(false)
  })

  it('GLB でないもの・壊れたものは、断る', () => {
    expect(checkGlb(new TextEncoder().encode('これは GLB ではありません。ただのテキストです。')).ok).toBe(false)
    expect(checkGlb(glb({}, { version: 1 })).ok).toBe(false)
    expect(checkGlb(glb({}, { lengthDelta: 4 })).ok).toBe(false)
    expect(checkGlb(new Uint8Array(5)).ok).toBe(false)
  })
})
