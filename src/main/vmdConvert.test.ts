import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildVmd } from '../shared/motions/vmdFixture'
import { classifyVmdFile, convertVmdFiles } from './vmdConvert'

let dir: string
let cache: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmaid-vmd-'))
  cache = join(dir, 'cache')
  mkdirSync(cache)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (name: string, bytes: Uint8Array): string => {
  const p = join(dir, name)
  writeFileSync(p, bytes)
  return p
}

describe('VMD の変換(取り込み・キャッシュ)', () => {
  const body = (): Uint8Array => buildVmd({ bones: [{ name: 'センター', frame: 0 }, { name: '上半身', frame: 20, rotation: [0.1, 0, 0, Math.sqrt(0.99)] }, { name: '左足ＩＫ', frame: 0 }] })
  const face = (): Uint8Array => buildVmd({ morphs: [{ name: 'まばたき', frame: 0, weight: 0 }, { name: 'まばたき', frame: 20, weight: 1 }] })

  it('ファイルの中身で、体・表情・読めないものを見分ける', () => {
    expect(classifyVmdFile(write('b.vmd', body()))).toBe('body')
    expect(classifyVmdFile(write('f.vmd', face()))).toBe('face')
    expect(classifyVmdFile(write('x.vmd', new Uint8Array(100)))).toBeNull()
    expect(classifyVmdFile(join(dir, 'ない.vmd'))).toBeNull()
  })

  it('体 + 表情を 1 つの VRMA に変換して、キャッシュする。2 回目は、同じ結果をキャッシュから返す', () => {
    const b = write('b.vmd', body())
    const f = write('f.vmd', face())
    const r1 = convertVmdFiles([b, f], cache, { armAngleDeg: null }, 'dance')
    if (!r1.ok) throw new Error(r1.reason)
    expect(r1.cached).toBe(false)
    expect(r1.report.expressions).toEqual(['blink'])
    expect(readdirSync(cache)).toHaveLength(1)
    const r2 = convertVmdFiles([b, f], cache, { armAngleDeg: null }, 'dance')
    if (!r2.ok) throw new Error(r2.reason)
    expect(r2.cached).toBe(true)
    expect(Buffer.compare(Buffer.from(r1.vrma), Buffer.from(r2.vrma))).toBe(0)
  })

  it('腕の基準の角度・表情の有無・ファイルの中身が変わると、別のキャッシュになる', () => {
    const b = write('b.vmd', body())
    const f = write('f.vmd', face())
    convertVmdFiles([b], cache, { armAngleDeg: null }, 'm')
    convertVmdFiles([b], cache, { armAngleDeg: 30 }, 'm')
    convertVmdFiles([b, f], cache, { armAngleDeg: null }, 'm')
    expect(readdirSync(cache)).toHaveLength(3)
    const r30 = convertVmdFiles([b], cache, { armAngleDeg: 30 }, 'm')
    const rAuto = convertVmdFiles([b], cache, { armAngleDeg: null }, 'm')
    if (!r30.ok || !rAuto.ok) throw new Error('変換できません')
    expect(Buffer.compare(Buffer.from(r30.vrma), Buffer.from(rAuto.vrma))).not.toBe(0)
  })

  it('読めないファイル・VMD でないファイルは、理由つきで失敗する', () => {
    expect(convertVmdFiles([join(dir, 'ない.vmd')], cache, { armAngleDeg: null }, 'm')).toMatchObject({ ok: false })
    const bad = write('bad.vmd', new Uint8Array(100))
    const r = convertVmdFiles([bad], cache, { armAngleDeg: null }, 'm')
    expect(r.ok).toBe(false)
    expect(readdirSync(cache)).toHaveLength(0)
  })
})
