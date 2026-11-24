import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { generateBuiltinMotions } from '../shared/motions/builtin'
import { scanVrmaFiles, vetVrmaFiles } from './motionScan'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmaid-fbxscan-'))
  return () => rmSync(dir, { recursive: true, force: true })
})
const put = (rel: string, data: string | Uint8Array): string => {
  const p = join(dir, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, data)
  return p
}

describe('FBX の取り込み(FBX インポーター Mod)', () => {
  it('フォルダの探索は、Mod が ON のときだけ、.fbx も拾う', () => {
    put('a.fbx', 'x')
    put('b.bvh', 'x')
    expect(scanVrmaFiles(dir).paths.map((p) => basename(p))).toEqual(['b.bvh'])
    expect(scanVrmaFiles(dir, { fbx: true }).paths.map((p) => basename(p))).toEqual(['a.fbx', 'b.bvh'])
  })

  it('検査: OFF なら理由つきで断る。ON なら、あらかじめ変換した結果(VRMA)を、元のパスの代わりに通す', () => {
    const fbx = put('dance.fbx', 'x')
    const converted = put('cache/dance.vrma', generateBuiltinMotions().find((m) => m.name === 'wave')!.data)
    const off = vetVrmaFiles([fbx])
    expect(off.ok).toEqual([])
    expect(off.rejected[0].reason).toContain('FBX インポーター')

    const on = vetVrmaFiles([fbx], { allowFbx: true, fbxResults: new Map([[fbx, { ok: true as const, path: converted }]]) })
    expect(on.ok).toEqual([converted])
    expect(on.sources).toEqual([fbx])

    const failed = vetVrmaFiles([fbx], { allowFbx: true, fbxResults: new Map([[fbx, { ok: false as const, reason: '骨が見つかりません' }]]) })
    expect(failed.ok).toEqual([])
    expect(failed.rejected[0].reason).toBe('骨が見つかりません')

    expect(vetVrmaFiles([fbx], { allowFbx: true }).rejected[0].reason).toContain('変換できませんでした')
  })
})
