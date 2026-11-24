import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { scanVrmaFiles, vetVrmaFiles } from './motionScan'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmaid-vmd-'))
  return () => rmSync(dir, { recursive: true, force: true })
})
const put = (rel: string, data: string | Uint8Array): string => {
  const p = join(dir, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, data)
  return p
}
const VMD = 'Vocaloid Motion Data 0002\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0'

describe('VMD の取り込み(MMD 対応 Mod)', () => {
  it('フォルダの探索は、Mod が ON のときだけ、.vmd も拾う', () => {
    put('a.vmd', VMD)
    put('b.bvh', 'x')
    expect(scanVrmaFiles(dir).paths.map((p) => basename(p))).toEqual(['b.bvh'])
    expect(scanVrmaFiles(dir, { vmd: true }).paths.map((p) => basename(p))).toEqual(['a.vmd', 'b.bvh'])
  })

  it('検査: Mod が ON なら、VMD をそのまま通す。OFF・VMD でないものは、理由つきで断る', () => {
    const good = put('good.vmd', VMD)
    const fake = put('fake.vmd', 'これは VMD ではありません')
    const on = vetVrmaFiles([good, fake], { allowVmd: true })
    expect(on.ok).toEqual([good])
    expect(on.sources).toEqual([good])
    expect(on.rejected.map((r) => [basename(r.path), r.reason])).toEqual([['fake.vmd', 'VMD ファイルではありません']])
    const off = vetVrmaFiles([good])
    expect(off.ok).toEqual([])
    expect(off.rejected[0].reason).toContain('MMD 対応')
  })
})
