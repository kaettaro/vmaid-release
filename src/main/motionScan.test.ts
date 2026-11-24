import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildVrma } from '../shared/motions/builder'
import { BUILTIN_MOTION_DEFS } from '../shared/motions/builtin'
import { scanVrmaFiles, vetVrmaFiles, vetVrmaFilesAsync } from './motionScan'
import { humanoidJoints, randomFrames, toBvhText } from '../shared/motions/bvhTestUtil'

/** 区切り文字を / にそろえた相対パス(Windows でも同じ期待値で比べる) */
const rel = (root: string, p: string): string => relative(root, p).split('\\').join('/')

const good = buildVrma(BUILTIN_MOTION_DEFS[0])
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmaid-scan-'))
  return () => rmSync(dir, { recursive: true, force: true })
})
const put = (rel: string, data: Uint8Array | string = good): string => {
  const p = join(dir, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, data)
  return p
}

describe('scanVrmaFiles', () => {
  it('サブフォルダも含めて .vrma を見つける(拡張子は大文字小文字を区別しない)。他のファイルは無視', () => {
    put('a.vrma')
    put('sub/b.VRMA')
    put('sub/deep/c.vrma')
    put('readme.txt', 'x')
    put('model.vrm', 'x')
    expect(scanVrmaFiles(dir).paths.map((p) => rel(dir, p))).toEqual(['a.vrma', 'sub/b.VRMA', 'sub/deep/c.vrma'])
  })
  it('隠しファイル・隠しフォルダ(.git や .DS_Store 由来)は無視する', () => {
    put('.hidden.vrma')
    put('.git/x.vrma')
    put('ok.vrma')
    expect(scanVrmaFiles(dir).paths).toHaveLength(1)
  })
  it('深すぎるフォルダは辿らない(誤って巨大なフォルダを選んでも固まらない)', () => {
    put('l1/l2/l3/l4/l5/l6/l7/too-deep.vrma')
    put('l1/l2/l3/l4/l5/l6/ok.vrma')
    const names = scanVrmaFiles(dir).paths.map((p) => basename(p))
    expect(names).toContain('ok.vrma')
    expect(names).not.toContain('too-deep.vrma')
  })
  it('フォルダのシンボリックリンクの循環があっても、止まる', (ctx) => {
    put('real/a.vrma')
    try {
      symlinkSync(dir, join(dir, 'real', 'loop'))
    } catch (e) {
      // Windows は、管理者権限か開発者モードが無いと作れない(EPERM)。この環境では確認できないので飛ばす
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip()
      throw e
    }
    expect(scanVrmaFiles(dir).paths.length).toBeGreaterThan(0)
  })
  it('存在しない・空のフォルダでも落ちない', () => {
    expect(scanVrmaFiles(join(dir, 'none')).paths).toEqual([])
    expect(scanVrmaFiles(dir).paths).toEqual([])
  })
})

describe('BVH(取り込み時に VRMA へ変換する)', () => {
  const joints = humanoidJoints('T', 10)
  const bvhText = toBvhText(joints, randomFrames(joints, 8, 3), 1 / 30)

  it('フォルダ走査で .bvh も見つける', () => {
    put('a.vrma')
    put('dance/b.BVH', bvhText)
    put('dance/readme.txt', 'x')
    expect(scanVrmaFiles(dir).paths.map((p) => rel(dir, p))).toEqual(['a.vrma', 'dance/b.BVH'])
  })

  it('変換先を渡すと、BVH を VRMA にして検査を通す。元のファイル名から名前が付く', () => {
    const src = put('motions/chill.bvh', bvhText)
    const cache = join(dir, 'cache')
    const r = vetVrmaFiles([src], { bvhCacheDir: cache })
    expect(r.rejected).toEqual([])
    expect(r.ok).toHaveLength(1)
    expect(r.ok[0].startsWith(cache)).toBe(true)
    expect(basename(r.ok[0])).toBe('chill.vrma')
    expect(r.converted).toBe(1)
  })

  it('同じ内容は再変換せず、同じパスを返す(converted は増えない)', () => {
    const a = put('a/same.bvh', bvhText)
    const b = put('b/same.bvh', bvhText)
    const cache = join(dir, 'cache')
    const first = vetVrmaFiles([a], { bvhCacheDir: cache })
    const second = vetVrmaFiles([b], { bvhCacheDir: cache })
    expect(second.ok).toEqual(first.ok)
    expect(second.converted).toBe(0)
  })

  it('変換先が無い・BVH として読めないものは、理由つきで弾く', () => {
    const good = put('ok.bvh', bvhText)
    const bad = put('bad.bvh', 'これは BVH ではありません')
    expect(vetVrmaFiles([good]).rejected[0].reason).toContain('変換先')
    const r = vetVrmaFiles([good, bad], { bvhCacheDir: join(dir, 'cache') })
    expect(r.ok).toHaveLength(1)
    expect(r.rejected.map((x) => basename(x.path))).toEqual(['bad.bvh'])
    expect(r.rejected[0].reason).toContain('BVH として変換できません')
  })

  it('対応できない関節があれば、注意として返す', () => {
    const extra = [...joints, { name: 'tail1', parent: 'hips', offset: [0, -0.1, 0] as [number, number, number] }]
    const src = put('tail.bvh', toBvhText(extra, randomFrames(extra, 4, 2), 1 / 30))
    const r = vetVrmaFiles([src], { bvhCacheDir: join(dir, 'cache') })
    expect(r.ok).toHaveLength(1)
    expect(r.notes.join('\n')).toContain('tail1')
  })
})

describe('vetVrmaFiles', () => {
  it('正しいVRMAだけを通し、壊れたもの・別形式を、理由つきで弾く', () => {
    const a = put('good.vrma')
    const b = put('broken.vrma', good.slice(0, 100))
    const c = put('text.vrma', 'これはVRMAではありません。ただのテキストです。')
    const r = vetVrmaFiles([a, b, c, join(dir, 'missing.vrma')])
    expect(r.ok).toEqual([a])
    expect(r.rejected.map((x) => basename(x.path))).toEqual(['broken.vrma', 'text.vrma', 'missing.vrma'])
    expect(r.rejected[0].reason).toContain('壊れて')
    expect(r.rejected[1].reason).toContain('glTF')
    expect(r.rejected[2].reason).toContain('読み込めません')
  })
  it('件数の上限(maxFiles)を超えたら、先頭だけを検査し、元の件数を返す', () => {
    const p = put('a.vrma')
    const many = Array.from({ length: 350 }, () => p)
    const r = vetVrmaFiles(many, { maxFiles: 300 })
    expect(r.ok).toHaveLength(300)
    expect(r.truncatedFrom).toBe(350)
  })
  it('maxFiles が 0 または省略なら、無制限(1000件でも全部検査する)', () => {
    const p = put('a.vrma')
    const many = Array.from({ length: 1000 }, () => p)
    for (const opts of [{}, { maxFiles: 0 }]) {
      const r = vetVrmaFiles(many, opts)
      expect(r.ok).toHaveLength(1000)
      expect(r.truncatedFrom).toBeUndefined()
    }
  })
  it('sources は、ok と同じ順の元のパス(BVH は変換前)', () => {
    const a = put('a.vrma')
    const joints = humanoidJoints('T', 10)
    const b = put('b.bvh', toBvhText(joints, randomFrames(joints, 6, 1), 1 / 30))
    const r = vetVrmaFiles([a, b], { bvhCacheDir: join(dir, 'cache') })
    expect(r.sources).toEqual([a, b])
    expect(r.ok[0]).toBe(a)
    expect(r.ok[1]).not.toBe(b)
  })
})

describe('vetVrmaFilesAsync', () => {
  it('同期版と同じ結果を返し、最後に 総数/総数 の進捗を知らせる', async () => {
    const a = put('a.vrma')
    const bad = put('bad.vrma', 'x')
    const progress: Array<[number, number]> = []
    const r = await vetVrmaFilesAsync([a, bad, a], {}, (d, t) => progress.push([d, t]))
    expect(r.ok).toEqual([a, a])
    expect(r.rejected.map((x) => basename(x.path))).toEqual(['bad.vrma'])
    expect(progress[progress.length - 1]).toEqual([3, 3])
  })
  it('大量でも、途中で制御を返す(進捗が複数回、増えながら届く)', async () => {
    const joints = humanoidJoints('T', 10)
    const text = toBvhText(joints, randomFrames(joints, 200, 1), 1 / 30)
    const files = Array.from({ length: 40 }, (_, i) => put(`m/b${i}.bvh`, text.replace('Frame Time: 0.03333333333333333', `Frame Time: 0.0333${String(i).padStart(2, '0')}`)))
    const seen: number[] = []
    const r = await vetVrmaFilesAsync(files, { bvhCacheDir: join(dir, 'cache') }, (d) => seen.push(d))
    expect(r.ok.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(40)
    expect([...seen].sort((x, y) => x - y)).toEqual(seen) // 単調に増える
  })
  it('maxFiles を超えたぶんは、検査しない', async () => {
    const p = put('a.vrma')
    const r = await vetVrmaFilesAsync([p, p, p, p], { maxFiles: 2 })
    expect(r.ok).toHaveLength(2)
    expect(r.truncatedFrom).toBe(4)
  })
})
