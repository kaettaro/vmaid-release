import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parsePackYaml, pickManifest } from './manifest'
import { packToZip, unzipPack } from './transfer'

const HEADER = 'id: my-mod\nname: テスト\nversion: "1"\ndistribution: private\n'

describe('Mod のマニフェスト', () => {
  it('mod.yaml を優先し、旧 pack.yaml も読む', () => {
    expect(pickManifest({ 'pack.yaml': 1, 'mod.yaml': 2 })).toBe('mod.yaml')
    expect(pickManifest({ 'pack.yaml': 1 })).toBe('pack.yaml')
    expect(pickManifest({ 'a.txt': 1 })).toBeNull()
  })

  it('requires(使う機能 Mod)を読む。省略は空。不正な id はエラー', () => {
    expect(parsePackYaml(HEADER).pack?.requires).toEqual([])
    expect(parsePackYaml(`${HEADER}requires: [motion-tags, motion-tags, touch-advanced]\n`).pack?.requires).toEqual(['motion-tags', 'touch-advanced'])
    expect(parsePackYaml(`${HEADER}requires: ["Bad Id"]\n`).pack).toBeNull()
  })

  it('.vmaidmod(mod.yaml)も、旧形式(pack.yaml)も、取り込める', () => {
    const modZip = packToZip({ 'mod.yaml': strToU8(HEADER) })
    const out = unzipPack(modZip)
    expect(out.ok && Object.keys(out.files)).toEqual(['mod.yaml'])
    expect(unzipPack(zipSync({ 'pack.yaml': strToU8(HEADER) })).ok).toBe(true)
    const none = unzipPack(zipSync({ 'a.txt': strToU8('x') }))
    expect(none.ok).toBe(false)
  })
})
