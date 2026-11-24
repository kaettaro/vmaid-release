import { describe, expect, it } from 'vitest'
import { motionNameFromPath, registerMotion } from './motionLibrary'

describe('motionNameFromPath', () => {
  it('Mac / Windows 両方のパスから拡張子なしの名前を取る', () => {
    expect(motionNameFromPath('/Users/a/motions/dance1.vrma')).toBe('dance1')
    expect(motionNameFromPath('C:\\Users\\a\\Idle Loop.VRMA')).toBe('Idle Loop')
  })
})

describe('registerMotion', () => {
  it('追加できる', () => {
    expect(registerMotion([], '/a/wave.vrma')).toEqual([{ name: 'wave', path: '/a/wave.vrma' }])
  })
  it('同じパスは重複登録しない', () => {
    const lib = registerMotion([], '/a/wave.vrma')
    expect(registerMotion(lib, '/a/wave.vrma')).toBe(lib)
  })
  it('名前が被ったら連番を付ける', () => {
    let lib = registerMotion([], '/a/wave.vrma')
    lib = registerMotion(lib, '/b/wave.vrma')
    lib = registerMotion(lib, '/c/wave.vrma')
    expect(lib.map((m) => m.name)).toEqual(['wave', 'wave-2', 'wave-3'])
  })
})

import { checkVrmaBytes, describeImport, registerMotions } from './motionLibrary'
import { buildVrma } from './motions/builder'
import { BUILTIN_MOTION_DEFS } from './motions/builtin'

describe('registerMotions(複数を一気に登録)', () => {
  it('まとめて登録し、新規・重複を分けて返す。選択内の同じファイルは1回だけ', () => {
    const base = registerMotions([], ['/a/wave.vrma']).library
    const r = registerMotions(base, ['/a/wave.vrma', '/b/dance.vrma', '/b/dance.vrma', '/c/nod.vrma'])
    expect(r.added.map((m) => m.name)).toEqual(['dance', 'nod'])
    expect(r.duplicates).toEqual(['/a/wave.vrma'])
    expect(r.library.map((m) => m.name)).toEqual(['wave', 'dance', 'nod'])
  })
  it('名前が被る別ファイルは連番になる(同じ名前のファイルが別フォルダに多数あっても)', () => {
    const r = registerMotions([], ['/a/idle.vrma', '/b/idle.vrma', '/c/idle.vrma', '/d/idle.vrma'])
    expect(r.library.map((m) => m.name)).toEqual(['idle', 'idle-2', 'idle-3', 'idle-4'])
  })
  it('空の入力は何も変えない', () => {
    const lib = registerMotions([], ['/a/x.vrma']).library
    expect(registerMotions(lib, []).library).toBe(lib)
  })
  it('数万件でも、1秒以内に、名前の重複なく登録できる(件数の2乗で遅くならない)', () => {
    const paths = Array.from({ length: 30000 }, (_, i) => `/d${i % 50}/m${i % 3000}.vrma`)
    const t0 = performance.now()
    const r = registerMotions([], paths)
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(new Set(r.library.map((m) => m.name)).size).toBe(r.library.length)
    expect(r.added.length + r.duplicates.length).toBe(new Set(paths).size)
  })
  it('同じ名前のファイルが 2000 個あっても、連番は重ならない', () => {
    const r = registerMotions([], Array.from({ length: 2000 }, (_, i) => `/d${i}/idle.vrma`))
    expect(r.library[0].name).toBe('idle')
    expect(r.library[1999].name).toBe('idle-2000')
    expect(new Set(r.library.map((m) => m.name)).size).toBe(2000)
  })
  it('すでに idle-2 がある所へ、同じ名前を足すと、空いている連番を使う', () => {
    const base = registerMotions([], ['/a/idle.vrma', '/b/idle.vrma']).library
    const r = registerMotions(base, ['/c/idle.vrma', '/d/idle.vrma'])
    expect(r.added.map((m) => m.name)).toEqual(['idle-3', 'idle-4'])
  })
  it('大量(300件)でも、名前の重複なく登録できる', () => {
    const paths = Array.from({ length: 300 }, (_, i) => `/dir${i % 7}/m${i % 40}.vrma`)
    const r = registerMotions([], paths)
    expect(new Set(r.library.map((m) => m.name)).size).toBe(r.library.length)
    expect(r.added.length + r.duplicates.length).toBe(new Set(paths).size)
  })
})

describe('checkVrmaBytes(VRMAの簡易検査)', () => {
  it('正しいVRMA(内蔵モーションと同じ形式)は通る', () => {
    expect(checkVrmaBytes(buildVrma(BUILTIN_MOTION_DEFS[0])).ok).toBe(true)
  })
  it('小さすぎる・glTFでない・サイズが合わない(途中で切れた)ファイルは弾き、理由を返す', () => {
    const good = buildVrma(BUILTIN_MOTION_DEFS[0])
    expect(checkVrmaBytes(new Uint8Array(5))).toMatchObject({ ok: false, reason: expect.stringContaining('小さすぎ') })
    expect(checkVrmaBytes(new TextEncoder().encode('これはテキストファイルです。VRMAではありません。'))).toMatchObject({ ok: false, reason: expect.stringContaining('glTF Binary') })
    expect(checkVrmaBytes(good.slice(0, good.length - 10))).toMatchObject({ ok: false, reason: expect.stringContaining('壊れて') })
  })
})

describe('describeImport', () => {
  it('結果を1行で説明する(件数・重複・失敗・打ち切り)', () => {
    expect(describeImport({ added: 12, duplicates: 0, rejected: [] })).toBe('12件を追加しました')
    expect(describeImport({ added: 3, duplicates: 2, rejected: [{ path: 'x', reason: 'y' }] })).toBe('3件を追加しました / 2件は登録済みのためスキップ / 1件は読み込めませんでした')
    expect(describeImport({ added: 0, duplicates: 0, rejected: [] })).toContain('見つかりませんでした')
    expect(describeImport({ added: 300, duplicates: 0, rejected: [], truncatedFrom: 500 })).toContain('見つかった数: 500')
  })
})

import { renameMotionEntry, validateMotionName } from './motionLibrary'

describe('モーション名の変更', () => {
  it('名前は前後の空白を除き、1〜40文字。空・長すぎ・制御文字は不可。日本語・記号もよい', () => {
    expect(validateMotionName('  元気な手振り ', [])).toEqual({ ok: true, name: '元気な手振り' })
    expect(validateMotionName('dance (v2)!', [])).toEqual({ ok: true, name: 'dance (v2)!' })
    for (const bad of ['', '   ', 'a'.repeat(41), 'a\nb']) expect(validateMotionName(bad, []).ok).toBe(false)
  })
  it('すでに使われている名前(内蔵・ほかの登録)は不可。理由に名前が出る', () => {
    const r = validateMotionName('wave', ['idle', 'wave'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('「wave」')
  })
  it('renameMotionEntry は名前だけを変え、パスは変えない。他は触らない', () => {
    const lib = [{ name: 'a', path: '/x/a.vrma' }, { name: 'b', path: '/x/b.vrma' }]
    expect(renameMotionEntry(lib, 'a', 'z')).toEqual([{ name: 'z', path: '/x/a.vrma' }, { name: 'b', path: '/x/b.vrma' }])
    expect(renameMotionEntry(lib, 'none', 'z')).toEqual(lib)
  })
})
