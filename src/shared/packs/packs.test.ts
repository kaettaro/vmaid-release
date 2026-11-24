import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { isSafeRelativePath, mergePackRules, namespaceRuleSet, parsePackYaml } from './manifest'
import { MAX_ENTRIES, packToZip, unzipPack } from './transfer'

const HEADER = `id: touch-test
name: テストパック
version: 0.1.0
distribution: private
`
const BASE_RULES = `motionGroups:
  shy: [shy-a, wave]
rules:
  - id: head
    when: { trigger: stroke, part: head }
    do:
      - { action: playMotion, motion: shy-a }
      - { action: playMotion, group: shy }
      - { action: playMotion, motion: wave }
`

describe('isSafeRelativePath', () => {
  it('パックのフォルダの中の相対パス(/ 区切り)だけを許す', () => {
    for (const ok of ['a.vrma', 'motions/a.vrma', 'モーション/ふれあい.vrma']) expect(isSafeRelativePath(ok)).toBe(true)
    for (const bad of ['', '/etc/a.vrma', '../a.vrma', 'a/../../b.vrma', 'a\\b.vrma', 'C:/a.vrma', 'C:\\a.vrma', 'a//b.vrma', './a.vrma', 'a/.', 'a\u0000b', 'x'.repeat(201)]) {
      expect(isSafeRelativePath(bad), bad).toBe(false)
    }
  })
})

describe('parsePackYaml', () => {
  it('旧形式のモーショングループ(motionGroups・group)は、タグへ自動で変換される: パックの中のメンバーにタグが付き、group は tag になる。モーション名・ルールidは名前空間つき', () => {
    const r = parsePackYaml(`${HEADER}motions:\n  - { name: shy-a, file: motions/shy-a.vrma, license: メモ }\n${BASE_RULES}`)
    expect(r.errors).toEqual([])
    const rs = r.pack!.ruleSet
    expect('motionGroups' in rs).toBe(false)
    expect(r.pack!.motions[0].tags).toEqual(['shy']) // パックの中のメンバー(shy-a)だけ。外のモーション(wave)には、パックからは付けられない
    expect(rs.rules[0].id).toBe('touch-test/head')
    expect(rs.rules[0].do.map((a) => [a.motion, a.tag])).toEqual([
      ['touch-test/shy-a', undefined],
      [undefined, 'shy'],
      ['wave', undefined]
    ])
  })
  it('新形式: モーションに tags を書ける(不正なタグは捨てる。重複は1つ)。ルールの tag は、名前空間をつけない(タグは、全モーションで共通)', () => {
    const r = parsePackYaml(`${HEADER}motions:\n  - { name: a, file: a.vrma, tags: [照れ, 照れ, "x,y", ""] }\nrules:\n  - id: t\n    when: { trigger: click }\n    do: [{ action: playMotion, tag: 照れ }]\n`)
    expect(r.errors).toEqual([])
    expect(r.pack!.motions[0].tags).toEqual(['照れ'])
    expect(r.pack!.ruleSet.rules[0].do[0].tag).toBe('照れ')
  })
  it('旧形式の group が、タグにできない名前(カンマなど)なら、エラーにして気づけるようにする', () => {
    const r = parsePackYaml(`${HEADER}rules:\n  - id: t\n    when: { trigger: click }\n    do: [{ action: playMotion, group: "a,b" }]\n`)
    expect(r.pack).toBeNull()
    expect(r.errors.join('\n')).toContain('タグに変わっています')
  })
  it('モーションのファイルは .bvh も指定できる(読み込み時に VRMA へ変換する)', () => {
    const r = parsePackYaml(`${HEADER}motions:\n  - { name: a, file: motions/a.BVH }\n${BASE_RULES}`)
    expect(r.errors).toEqual([])
    expect(r.pack?.motions[0].file).toBe('motions/a.BVH')
  })
  it('不正な id・危険なパス・.vrma 以外・名前の重複・不正なルールは、まとめてエラーになる', () => {
    expect(parsePackYaml('id: A\nname: x\nversion: 1\ndistribution: private\n').errors.join()).toContain('id')
    for (const file of ['../x.vrma', '/abs/x.vrma', 'a\\x.vrma', 'x.fbx', 'x.vmd']) {
      expect(parsePackYaml(`${HEADER}motions:\n  - { name: a, file: "${file}" }\n`).pack, file).toBeNull()
    }
    expect(parsePackYaml(`${HEADER}motions:\n  - { name: a, file: a.vrma }\n  - { name: a, file: b.vrma }\n`).errors.join()).toContain('重複')
    expect(parsePackYaml(`${HEADER}motions:\n  - { name: "a/b", file: a.vrma }\n`).pack).toBeNull()
    const bad = parsePackYaml(`${HEADER}rules:\n  - { id: x, when: { trigger: nope }, do: [] }\n`)
    expect(bad.pack).toBeNull()
    expect(bad.errors.length).toBeGreaterThan(0)
    expect(parsePackYaml('::: not yaml').pack).toBeNull()
    expect(parsePackYaml('- a\n- b\n').pack).toBeNull()
  })
  it('配布用のパックは、すべてのモーションに redistributable: true と license が必要(確認できないものを配布物に入れない)', () => {
    const dist = (m: string) => parsePackYaml(`id: dist-pack\nname: x\nversion: "1"\ndistribution: distributable\nmotions:\n  - ${m}\n`)
    expect(dist('{ name: a, file: a.vrma }').errors.join('')).toContain('redistributable')
    expect(dist('{ name: a, file: a.vrma, redistributable: true }').errors.join('')).toContain('license')
    expect(dist('{ name: a, file: a.vrma, redistributable: false, license: x }').pack).toBeNull()
    expect(dist('{ name: a, file: a.vrma, redistributable: true, license: 自作 }').pack).not.toBeNull()
    // 私用は、制約なし
    expect(parsePackYaml(`${HEADER}motions:\n  - { name: a, file: a.vrma }\n`).pack).not.toBeNull()
    // モーションなし(ルールだけ)の配布用は、そのまま通る
    expect(parsePackYaml('id: rules-only\nname: x\nversion: "1"\ndistribution: distributable\n').pack).not.toBeNull()
  })
})

describe('mergePackRules', () => {
  it('ユーザーのルールの後ろに、パックのルールを足す。元のルールは変えない', () => {
    const user = { version: 1 as const, rules: [{ id: 'u', enabled: true, when: { trigger: 'startup' }, if: [], do: [{ action: 'say', text: ['hi'] }] }] }
    const pack = parsePackYaml(`${HEADER}${BASE_RULES}`).pack!
    const merged = mergePackRules(user, [pack])
    expect(merged.rules.map((r) => r.id)).toEqual(['u', 'touch-test/head'])
    expect(user.rules).toHaveLength(1)
    expect(mergePackRules(user, [])).toEqual(user)
  })
  it('namespaceRuleSet: tag は、そのまま(タグは、すべてのモーションで共通)。パックのモーション名だけが、名前空間つきになる', () => {
    const rs = { version: 1 as const, rules: [{ id: 'r', enabled: true, when: { trigger: 'startup' }, if: [], do: [{ action: 'playMotion', tag: 'dance' }, { action: 'playMotion', motion: 'mine' }, { action: 'playMotion', motion: 'wave' }] }] }
    const out = namespaceRuleSet('p-1', new Set(['mine']), rs).rules[0]
    expect(out.id).toBe('p-1/r')
    expect(out.do.map((a) => [a.tag, a.motion])).toEqual([['dance', undefined], [undefined, 'p-1/mine'], [undefined, 'wave']])
  })
})

describe('私用パックの書き出し・取り込み(別のPCへ移す)', () => {
  const files = (): Record<string, Uint8Array> => ({
    'pack.yaml': strToU8(`${HEADER}motions:\n  - { name: ふれあい, file: motions/ふれあい.vrma }\n`),
    'motions/ふれあい.vrma': Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256),
    'README.txt': strToU8('出典: …')
  })
  it('書き出して取り込むと、ファイル・中身が同一(日本語のファイル名・サブフォルダを含む)', () => {
    const out = unzipPack(packToZip(files()))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const src = files()
    expect(Object.keys(out.files).sort()).toEqual(Object.keys(src).sort())
    for (const k of Object.keys(src)) expect(Array.from(out.files[k])).toEqual(Array.from(src[k]))
  })
  it('Windows のツールが作る `\\` 区切りの zip も、`/` にそろえて取り込める', () => {
    const z = zipSync({ 'pack.yaml': strToU8(HEADER), 'motions\\a.vrma': new Uint8Array(10) })
    const out = unzipPack(z)
    expect(out.ok).toBe(true)
    if (out.ok) expect(Object.keys(out.files).sort()).toEqual(['motions/a.vrma', 'pack.yaml'])
  })
  it('危険な zip は取り込まない: zip slip・絶対パス・pack.yaml なし・想定外の種類・大文字小文字違いの重複・多すぎるファイル・壊れた zip', () => {
    const e = (z: Uint8Array): string => (unzipPack(z) as { error: string }).error
    expect(e(zipSync({ 'pack.yaml': strToU8(HEADER), '../evil.vrma': new Uint8Array(1) }))).toContain('危険なパス')
    expect(e(zipSync({ 'pack.yaml': strToU8(HEADER), '/abs.vrma': new Uint8Array(1) }))).toContain('危険なパス')
    expect(e(zipSync({ 'pack.yaml': strToU8(HEADER), 'a/../../b.vrma': new Uint8Array(1) }))).toContain('危険なパス')
    expect(e(zipSync({ 'a.vrma': new Uint8Array(1) }))).toContain('pack.yaml')
    expect(e(zipSync({ 'pack.yaml': strToU8(HEADER), 'run.exe': new Uint8Array(1) }))).toContain('種類')
    expect(e(zipSync({ 'pack.yaml': strToU8(HEADER), 'A.vrma': new Uint8Array(1), 'a.VRMA': new Uint8Array(1) }))).toContain('重複')
    const many: Record<string, Uint8Array> = { 'pack.yaml': strToU8(HEADER) }
    for (let i = 0; i <= MAX_ENTRIES; i++) many[`m${i}.vrma`] = new Uint8Array(1)
    expect(e(zipSync(many))).toContain('多すぎ')
    expect(e(new Uint8Array([1, 2, 3, 4]))).toContain('zip')
  })
  it('書き出しに、危険なパス・許可しない種類を入れようとすると例外', () => {
    expect(() => packToZip({ 'pack.yaml': strToU8(HEADER), '../x.vrma': new Uint8Array(1) })).toThrow()
    expect(() => packToZip({ 'pack.yaml': strToU8(HEADER), 'x.exe': new Uint8Array(1) })).toThrow()
  })
})
