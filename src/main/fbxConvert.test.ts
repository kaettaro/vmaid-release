import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkVrmaBytes } from '../shared/motionLibrary'
import { convertFbxFile } from './fbxConvert'
import { looksLikeFbx } from './fbxSample'
import { readFileSync, writeFileSync } from 'node:fs'

// 手元の実際の FBX(Mixamo 系)があれば、変換まで通しで試す(リポジトリには素材を入れない。無ければ、飛ばす)
const SAMPLE = process.env.VMAID_TEST_FBX ?? 'C:/Users/USER/Downloads/VRM-Assets-Pack-For-Silly-Tavern-main/animation_nitral-fork/Petting Animal.fbx'

describe('FBX の印', () => {
  it('バイナリ・テキストの FBX を見分ける', () => {
    expect(looksLikeFbx(new TextEncoder().encode('Kaydara FBX Binary  \0'))).toBe(true)
    expect(looksLikeFbx(new TextEncoder().encode('; FBX 7.3.0 project file'))).toBe(true)
    expect(looksLikeFbx(new TextEncoder().encode('glTF'))).toBe(false)
  })
})

describe('FBX → VRMA(実ファイルがあるときだけ)', () => {
  it.skipIf(!existsSync(SAMPLE))('変換でき、VRMA として読め、同じ内容は再変換しない', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vmaid-fbx-'))
    try {
      const r = await convertFbxFile(SAMPLE, dir)
      expect(r.ok, JSON.stringify(r)).toBe(true)
      if (!r.ok) return
      expect(r.report?.mapped).toContain('hips')
      expect(r.report?.frames).toBeGreaterThan(1)
      expect(checkVrmaBytes(new Uint8Array(readFileSync(r.path))).ok).toBe(true)
      const again = await convertFbxFile(SAMPLE, dir)
      expect(again.ok && again.path).toBe(r.path)
      expect(again.ok && again.report).toBeUndefined() // キャッシュを使った
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('FBX でないファイル・壊れたファイルは、理由つきで断る', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vmaid-fbx-'))
    try {
      const bad = join(dir, 'bad.fbx')
      writeFileSync(bad, 'これは FBX ではありません')
      const r = await convertFbxFile(bad, dir)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('FBX')
      const broken = join(dir, 'broken.fbx')
      writeFileSync(broken, Buffer.concat([Buffer.from('Kaydara FBX Binary  \0'), Buffer.alloc(200, 1)]))
      expect((await convertFbxFile(broken, dir)).ok).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
