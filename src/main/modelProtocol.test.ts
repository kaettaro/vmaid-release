import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelRoots, resolveCaseInsensitive } from './modelProtocol'

// electron の protocol を使わない部分(ModelRoots)だけを試す
vi.mock('electron', () => ({ protocol: {} }))

let dir: string
let outside: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmaid-model-'))
  outside = mkdtempSync(join(tmpdir(), 'vmaid-outside-'))
  mkdirSync(join(dir, 'tex'), { recursive: true })
  writeFileSync(join(dir, 'a.pmx'), 'x')
  writeFileSync(join(dir, 'tex', 'skin.png'), 'x')
  writeFileSync(join(dir, 'notes.txt'), 'x')
  writeFileSync(join(outside, 'secret.png'), 'x')
  return () => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

describe('ModelRoots(PMX の配信の安全性)', () => {
  it('モデルのフォルダの中の、モデル・画像だけを解決する', async () => {
    const r = new ModelRoots()
    const t = r.register(dir)
    expect((await r.resolveFile(t, '/a.pmx'))?.mime).toBe('application/octet-stream')
    expect((await r.resolveFile(t, '/tex/skin.png'))?.mime).toBe('image/png')
    expect(await r.resolveFile(t, '/tex/%E3%81%82.png')).toBeNull() // 無いファイル
    expect(await r.resolveFile(t, '/notes.txt')).toBeNull() // 想定外の種類
  })

  it('大文字小文字だけが違うパスは、実在する名前に直す(macOS のように区別する環境向け)。フォルダの外へは出ない', async () => {
    expect(await resolveCaseInsensitive(dir, '/TEX/Skin.PNG')).toBe(join(dir, 'tex', 'skin.png'))
    expect(await resolveCaseInsensitive(dir, '/tex/none.png')).toBeNull()
    expect(await resolveCaseInsensitive(dir, '/../x.png')).toBeNull()
    const r = new ModelRoots()
    const t = r.register(dir)
    expect((await r.resolveFile(t, '/TEX/SKIN.png'))?.mime).toBe('image/png')
  })

  it('フォルダの外・知らないトークンは、解決しない', async () => {
    const r = new ModelRoots()
    const t = r.register(dir)
    expect(await r.resolveFile(t, '/../' + outside.split(/[\\/]/).pop() + '/secret.png')).toBeNull()
    expect(await r.resolveFile(t, '/..%2F..%2Fsecret.png')).toBeNull()
    expect(await r.resolveFile('0000000000000000', '/a.pmx')).toBeNull()
  })

  it('シンボリックリンクで、フォルダの外を指していても、解決しない', async () => {
    const r = new ModelRoots()
    const t = r.register(dir)
    try {
      symlinkSync(join(outside, 'secret.png'), join(dir, 'tex', 'link.png'))
    } catch {
      return // Windows で権限が無いときは、試せない
    }
    expect(await r.resolveFile(t, '/tex/link.png')).toBeNull()
  })

  it('同じフォルダは、同じトークン', () => {
    const r = new ModelRoots()
    expect(r.register(dir)).toBe(r.register(dir))
  })
})
