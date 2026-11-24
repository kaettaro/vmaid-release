import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { humanoidJoints, randomFrames, toBvhText } from '../shared/motions/bvhTestUtil'
import { generateBuiltinMotions } from '../shared/motions/builtin'
import { makeGlb } from '../shared/props/glbTestUtil'
import { parseSettings } from '../shared/settings'
import { PackStore } from './packStore'
import type { SettingsStore } from './settingsStore'

// 実際の VRMA(内蔵モーションの生成結果)を使って、パックの走査・検証・有効/無効・私用の書き出しを確かめる(Electron は使わない)
let dir: string
let dist: string
let priv: string
let comm: string
let settings: ReturnType<typeof parseSettings>
let store: PackStore
const stub = (): SettingsStore => ({ get: () => settings, update: (m: (s: typeof settings) => void) => m(settings) }) as unknown as SettingsStore
const wave = (): Uint8Array => generateBuiltinMotions().find((m) => m.name === 'wave')!.data

function writePack(root: string, id: string, yaml: string, files: Record<string, Uint8Array> = {}): string {
  const d = join(root, id)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'pack.yaml'), yaml)
  for (const [rel, data] of Object.entries(files)) {
    mkdirSync(join(d, rel, '..'), { recursive: true })
    writeFileSync(join(d, rel), data)
  }
  return d
}
const header = (id: string, distribution: string) => `id: ${id}\nname: ${id}\nversion: "1"\ndistribution: ${distribution}\n`
const RULES = `rules:\n  - id: r1\n    when: { trigger: stroke, part: head }\n    do: [{ action: playMotion, motion: hi }]\n`

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmaid-packs-'))
  dist = join(dir, 'resources-packs')
  priv = join(dir, 'user', 'mods', 'individual')
  comm = join(dir, 'user', 'mods', 'community')
  mkdirSync(dist, { recursive: true })
  settings = parseSettings({})
  store = new PackStore(stub(), { official: dist, community: comm, individual: priv }, join(dir, 'user', 'motions-converted'))
  return () => rmSync(dir, { recursive: true, force: true })
})

describe('PackStore', () => {
  it('私用パック: モーションの実ファイルを検査して、登録名(<id>/<名前>)で読める。ルールは名前空間つき', () => {
    writePack(priv, 'my-private', `${header('my-private', 'private')}motions:\n  - { name: hi, file: motions/hi.vrma, source: https://example.com, license: メモ }\n${RULES}`, { 'motions/hi.vrma': wave() })
    const v = store.view({ synthesize: false })
    expect(v.packs).toHaveLength(1)
    expect(v.packs[0]).toMatchObject({ id: 'my-private', distribution: 'private', valid: true, enabled: true, errors: [] })
    expect(v.packs[0].motions[0]).toMatchObject({ name: 'my-private/hi', source: 'https://example.com', license: 'メモ' })
    expect(store.motionFiles().map((m) => m.name)).toEqual(['my-private/hi'])
    expect(store.motionFiles()[0].data.length).toBeGreaterThan(100)
    expect(store.ruleSet().rules[0]).toMatchObject({ id: 'my-private/r1' })
    expect(store.ruleSet().rules[0].do[0].motion).toBe('my-private/hi')
  })
  it('モーションに .bvh を指定すると、VRMA に変換して登録される(パックのフォルダには変換結果を書かない)', () => {
    const joints = humanoidJoints('T', 10)
    const bvh = new TextEncoder().encode(toBvhText(joints, randomFrames(joints, 6, 1), 1 / 30))
    const d = writePack(priv, 'bvh-pack', `${header('bvh-pack', 'private')}motions:\n  - { name: hi, file: motions/hi.bvh }\n${RULES}`, { 'motions/hi.bvh': bvh })
    const v = store.view({ synthesize: false })
    expect(v.packs[0]).toMatchObject({ id: 'bvh-pack', valid: true, errors: [] })
    const files = store.motionFiles()
    expect(files.map((m) => m.name)).toEqual(['bvh-pack/hi'])
    expect(String.fromCharCode(...files[0].data.slice(0, 4))).toBe('glTF')
    expect(readdirSync(join(d, 'motions'))).toEqual(['hi.bvh'])
  })
  it('BVH として読めない .bvh は、そのモーションだけ登録されず、理由が errors に出る', () => {
    writePack(priv, 'bad-bvh', `${header('bad-bvh', 'private')}motions:\n  - { name: hi, file: hi.bvh }\n${RULES}`, { 'hi.bvh': new TextEncoder().encode('BVH ではない') })
    const p = store.view({ synthesize: false }).packs[0]
    expect(p.valid).toBe(true)
    expect(p.errors.join('\n')).toContain('BVH として変換できません')
    expect(store.motionFiles()).toEqual([])
  })
  it('ルールを 1 つずつ OFF にできる。OFF のルールは、ルールセットに出ず、一覧には enabled: false で残る。その Mod が持たないルールは受け付けない', () => {
    writePack(priv, 'my-private', `${header('my-private', 'private')}${RULES}`)
    expect(store.setRuleEnabled('my-private/r1', false)).toBe(true)
    expect(store.setRuleEnabled('other/none', false)).toBe(false)
    expect(store.ruleSet().rules).toEqual([])
    expect(store.view({ synthesize: false }).packs[0].rules[0]).toMatchObject({ id: 'my-private/r1', enabled: false })
    store.setRuleEnabled('my-private/r1', true)
    expect(store.ruleSet().rules.map((r) => r.id)).toEqual(['my-private/r1'])
  })
  it('無効にすると、モーションもルールも出ない。設定に保存される', () => {
    writePack(priv, 'my-private', `${header('my-private', 'private')}motions:\n  - { name: hi, file: hi.vrma }\n${RULES}`, { 'hi.vrma': wave() })
    store.setEnabled('my-private', false)
    expect(store.view({ synthesize: false }).packs[0].enabled).toBe(false)
    expect(store.motionFiles()).toEqual([])
    expect(store.ruleSet().rules).toEqual([])
    expect(settings.packs.disabled).toEqual(['my-private'])
    store.setEnabled('my-private', true)
    expect(store.motionFiles()).toHaveLength(1)
  })
  it('「ON にしたものだけ有効」の方式への移行: 以前からの利用者は、有効なものがそのまま ON。新規は、すべて OFF。追加したものも OFF から', () => {
    writePack(priv, 'a-mod', header('a-mod', 'private'))
    writePack(priv, 'b-mod', header('b-mod', 'private'))
    store.setEnabled('b-mod', false) // 旧方式で、b だけ無効
    store.migrateToOptIn(true)
    expect(settings.packs.optIn).toBe(true)
    expect(store.view({ synthesize: false }).packs.map((p) => [p.id, p.enabled])).toEqual([['a-mod', true], ['b-mod', false]])
    writePack(priv, 'c-mod', header('c-mod', 'private')) // 新しく置いたものは、OFF
    expect(store.view({ synthesize: false }).packs.find((p) => p.id === 'c-mod')?.enabled).toBe(false)
    store.setEnabled('c-mod', true)
    expect(store.view({ synthesize: false }).packs.find((p) => p.id === 'c-mod')?.enabled).toBe(true)
  })
  it('以前の利用者の移行では、同梱の公式 Mod は引き継がず、新しい同梱 Mod は OFF のまま', () => {
    writePack(dist, 'touch-advanced', header('touch-advanced', 'distributable'))
    writePack(dist, 'persona-new', header('persona-new', 'distributable'))
    writePack(priv, 'mine', header('mine', 'private'))
    store.migrateToOptIn(true)
    expect(store.view({ synthesize: false }).packs.map((p) => [p.id, p.enabled])).toEqual([['persona-new', false], ['touch-advanced', false], ['mine', true]])
  })
  it('スロット: 値を決める・空で解除する。その Mod に無いスロットは受け付けない。値は Mod 一覧に出る', () => {
    writePack(priv, 'slotted', `${header('slotted', 'private')}slots:\n  - { id: tap, label: タップ }\n`)
    expect(store.view({ synthesize: false }).packs[0].slots).toEqual([{ id: 'tap', label: 'タップ', kind: 'motion', value: '', charValues: {} }])
    expect(store.setSlot('slotted', 'tap', ' wave ')).toBe(true)
    expect(settings.mods.slots).toEqual({ slotted: { tap: 'wave' } })
    expect(store.view({ synthesize: false }).packs[0].slots[0].value).toBe('wave')
    expect(store.setSlot('slotted', 'nope', 'x')).toBe(false)
    expect(store.setSlot('other', 'tap', 'x')).toBe(false)
    expect(store.setSlot('slotted', 'tap', '')).toBe(true)
    expect(settings.mods.slots).toEqual({})
  })
  it('スロット: 初期値・キャラごとの値(キャラの値 → 共通の値 → 初期値)。存在しないキャラ・Mod に無いスロットは受け付けない', () => {
    settings.characters = [
      { id: 'a', name: 'A', modelPath: null, systemPrompt: '', tone: '', userCallName: '', voice: { speaker: null, systemVoice: null, speed: 1, pitch: 0 } },
      { id: 'b', name: 'B', modelPath: null, systemPrompt: '', tone: '', userCallName: '', voice: { speaker: null, systemVoice: null, speed: 1, pitch: 0 } }
    ] as typeof settings.characters
    writePack(priv, 'slotted', `${header('slotted', 'private')}slots:
  - { id: words, label: 合言葉, kind: text, default: "あ,い", hint: カンマ区切り }
  - { id: set, label: セット, kind: preset }
`)
    expect(store.view({ synthesize: false }).packs[0].slots[0]).toMatchObject({ kind: 'text', default: 'あ,い', hint: 'カンマ区切り', value: '' })
    expect(store.effectiveSlots('slotted', 'a')).toEqual({ words: 'あ,い', set: '' })
    expect(store.setSlot('slotted', 'set', 'common')).toBe(true)
    expect(store.setSlot('slotted', 'set', 'only-a', 'a')).toBe(true)
    expect(store.effectiveSlots('slotted', 'a').set).toBe('only-a')
    expect(store.effectiveSlots('slotted', 'b').set).toBe('common')
    expect(store.view({ synthesize: false }).packs[0].slots[1].charValues).toEqual({ a: 'only-a' })
    expect(store.commonSlots()).toEqual({ slotted: { words: 'あ,い', set: 'common' } })
    expect(store.setSlot('slotted', 'set', 'x', 'ghost')).toBe(false)
    expect(store.setSlot('slotted', 'set', '', 'a')).toBe(true)
    expect(settings.mods.slotsByCharacter).toEqual({})
    expect(store.effectiveSlots('slotted', 'a').set).toBe('common')
  })
  it('指示文の {{slot:id}} は、使っているキャラのスロットの値に展開される(空になったら、指示文ごと外す)', () => {
    settings.characters = [{ id: 'a', name: 'A', modelPath: null, systemPrompt: '', tone: '', userCallName: '', voice: { speaker: null, systemVoice: null, speed: 1, pitch: 0 } }] as typeof settings.characters
    writePack(priv, 'tone', `${header('tone', 'private')}slots:
  - { id: style, label: 口調, kind: text }
prompt:
  layer: state
  text: "口調は{{slot:style}}にする"
`)
    expect(store.promptLayers(new Set(), 'a')).toEqual(['口調はにする'])
    store.setSlot('tone', 'style', 'ぼんやり', 'a')
    expect(store.promptLayers(new Set(), 'a')).toEqual(['口調はぼんやりにする'])
    expect(store.promptLayers(new Set(), 'other')).toEqual(['口調はにする'])
  })
  it('小道具(glb): 完結した GLB だけが読め、id は <Mod の id>/<id>。外部参照・壊れたもの・OFF の Mod は、読めない', () => {
    const ok = makeGlb({ asset: { version: '2.0' } })
    const ext = makeGlb({ asset: { version: '2.0' }, images: [{ uri: 'tex.png' }] })
    writePack(priv, 'with-props', `${header('with-props', 'private')}props:\n  - { id: ok, file: ok.glb, bone: head, scale: 0.5 }\n  - { id: ext, file: ext.glb }\n  - { id: bad, file: bad.glb }\n  - { id: gone, file: gone.glb }\n`, {
      'ok.glb': ok,
      'ext.glb': ext,
      'bad.glb': new Uint8Array([1, 2, 3])
    })
    const p = store.view({ synthesize: false }).packs[0]
    expect(p.valid).toBe(true)
    expect(p.props).toEqual(['with-props/ok'])
    expect(p.errors.join('\n')).toContain('外部')
    expect(p.errors.length).toBe(3)
    expect(store.propData('with-props/ok')?.spec).toMatchObject({ bone: 'head', scale: 0.5 })
    expect(store.propData('with-props/ext')).toBeNull()
    expect(store.propData('with-props/none')).toBeNull()
    store.setEnabled('with-props', false)
    expect(store.propData('with-props/ok')).toBeNull()
  })
  it('FBX・PMX の小道具: 形式の印と大きさを検査し、その形式のインポーター Mod が OFF の間は、中身を渡さない', () => {
    const fbxOk = new Uint8Array([...new TextEncoder().encode('Kaydara FBX Binary  \0'), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const pmxOk = new Uint8Array([0x50, 0x4d, 0x58, 0x20, 2, 0, 0, 64, 0, 0, 0, 0])
    writePack(priv, 'kinds', `${header('kinds', 'private')}props:\n  - { id: a, file: a.fbx }\n  - { id: b, file: b.pmx }\n  - { id: c, file: c.fbx }\n  - { id: d, file: d.pmx }\n`, {
      'a.fbx': fbxOk,
      'b.pmx': pmxOk,
      'c.fbx': new Uint8Array([1, 2, 3]),
      'd.pmx': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
    const p = store.view({ synthesize: false }).packs[0]
    expect(p.props).toEqual(['kinds/a', 'kinds/b'])
    expect(p.errors.join('\n')).toContain('FBX ファイルではありません')
    expect(p.errors.join('\n')).toContain('PMX ファイルではありません')
    // 必要な機能 Mod に、形式のインポーターが加わる
    expect(p.requires.map((r) => r.id).sort()).toEqual(['fbx-import', 'pmx-import'])
    // Mod が OFF の間は、渡さない
    expect(store.propData('kinds/a')).toBeNull()
    expect(store.propData('kinds/b')).toBeNull()
    settings.mods.features = ['fbx-import', 'pmx-import']
    const fbx = store.propData('kinds/a')
    expect(fbx?.payload.kind).toBe('fbx')
    const pmx = store.propData('kinds/b')
    expect(pmx?.payload.kind).toBe('pmx')
    expect(pmx?.payload.kind === 'pmx' && pmx.payload.url.startsWith('vmaid-model://')).toBe(true)
  })
  it('スクリプト Mod: 「開発者向け」が OFF の間は、無効(ルール・宣言したノードも出ない)。ON で有効。entry が不正なら、理由が出る', () => {
    const yaml = `${header('scr', 'private')}script:\n  apiVersion: 1\n  entry: main.js\n  contributes:\n    actions: [{ type: hello, label: こんにちは }]\nrules:\n  - id: r\n    when: { trigger: click }\n    do: [{ action: hello }]\n`
    writePack(priv, 'scr', yaml, { 'main.js': new TextEncoder().encode('host.onAction(() => {})') })
    store.setEnabled('scr', true)
    // 開発者向け OFF
    let p = store.view({ synthesize: false }).packs[0]
    expect(p.valid).toBe(true)
    expect(p.script?.blocked).toContain('開発者向け')
    expect(p.enabled).toBe(false)
    expect(store.scriptMods()).toEqual([])
    expect(store.contributions()).toEqual([])
    expect(store.ruleSet().rules).toEqual([])
    // 開発者向け ON
    settings.mods.developerMode = true
    p = store.view({ synthesize: false }).packs[0]
    expect(p.enabled).toBe(true)
    expect(p.script?.blocked).toBeNull()
    expect(p.script?.permissions[0].text).toContain('必要ありません')
    expect(store.scriptMods().map((m) => m.id)).toEqual(['scr'])
    expect(store.contributions()[0].actions.map((a) => a.type)).toEqual(['scr/hello'])
    expect(store.ruleSet().rules.map((r) => r.id)).toEqual(['scr/r'])
    // 無効にすれば、また出ない
    store.setEnabled('scr', false)
    expect(store.scriptMods()).toEqual([])
  })

  it('スクリプト Mod: entry が無い・Mod のフォルダの外・大きすぎるときは、スクリプトを使わず、理由を出す', () => {
    settings.mods.developerMode = true
    writePack(priv, 'no-entry', `${header('no-entry', 'private')}script:\n  apiVersion: 1\n`)
    writePack(priv, 'big-entry', `${header('big-entry', 'private')}script:\n  apiVersion: 1\n`, { 'main.js': new Uint8Array(2 * 1024 * 1024 + 1) })
    store.setEnabled('no-entry', true)
    store.setEnabled('big-entry', true)
    const v = store.view({ synthesize: false }).packs
    expect(v.find((x) => x.id === 'no-entry')?.errors.join('\n')).toContain('ファイルが見つかりません')
    expect(v.find((x) => x.id === 'big-entry')?.errors.join('\n')).toContain('大きすぎます')
    expect(store.scriptMods()).toEqual([])
  })
  it('新規インストールの移行では、置いてあるものも、すべて OFF', () => {
    writePack(priv, 'a-mod', header('a-mod', 'private'))
    store.migrateToOptIn(false)
    expect(store.view({ synthesize: false }).packs[0].enabled).toBe(false)
  })
  it('区分は置き場所で決まる(manifest の distribution は、区分が分かるときは無視する)。フォルダ名と id が違う・official 以外が feature を使うパックは、読み込まない', () => {
    // 自作のフォルダに、distribution: distributable と書いてあっても、自作として扱う(配布用の検査は、official だけ)
    writePack(priv, 'claims-public', header('claims-public', 'distributable'))
    writePack(priv, 'folder-name', header('other-id', 'private'))
    writePack(priv, 'wants-feature', `${header('wants-feature', 'private')}feature: game\n`) // 本体の機能と結びつけられるのは、official だけ
    const v = store.view({ synthesize: false })
    const by = (id: string) => v.packs.find((p) => p.id === id)!
    expect(by('claims-public')).toMatchObject({ valid: true, category: 'individual', distribution: 'private' })
    expect(v.packs.find((p) => !p.valid && p.id !== 'wants-feature')).toBeTruthy()
    expect(by('wants-feature').valid).toBe(false)
    expect(by('wants-feature').errors.join('\n')).toContain('公式の Mod だけ')
    expect(store.ruleSet().rules).toEqual([])
  })
  it('official のパックには、配布用の検査(スクリプト不可・モーションに再配布可とライセンス)が、かかる', () => {
    writePack(dist, 'pub-motion', `${header('pub-motion', 'private')}motions:\n  - { name: hi, file: motions/hi.vrma }\n`, { 'motions/hi.vrma': wave() })
    const p = store.view({ synthesize: false }).packs.find((x) => x.id === 'pub-motion')!
    expect(p).toMatchObject({ category: 'official', distribution: 'distributable', valid: false })
    expect(p.errors.join('\n')).toContain('redistributable')
  })
  it('パックのフォルダの外を指すモーション(../・シンボリックリンク)・存在しない・VRMAでないファイルは、そのモーションだけ登録されない(理由つき)', () => {
    writeFileSync(join(dir, 'outside.vrma'), wave())
    const d = writePack(priv, 'bad-files', `${header('bad-files', 'private')}motions:\n  - { name: ok, file: ok.vrma }\n  - { name: missing, file: nope.vrma }\n  - { name: notvrma, file: junk.vrma }\n  - { name: link, file: link.vrma }\n`, {
      'ok.vrma': wave(),
      'junk.vrma': new Uint8Array([1, 2, 3])
    })
    // Windows は、管理者権限か開発者モードが無いとシンボリックリンクを作れない(EPERM)。そのときは、リンクの確認だけ飛ばす
    let linked = true
    try {
      symlinkSync(join(dir, 'outside.vrma'), join(d, 'link.vrma'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e
      linked = false
    }
    const p = store.view({ synthesize: false }).packs[0]
    expect(p.valid).toBe(true)
    expect(store.motionFiles().map((m) => m.name)).toEqual(['bad-files/ok'])
    expect(p.errors.join('\n')).toContain('missing')
    expect(p.errors.join('\n')).toContain('notvrma')
    if (linked) expect(p.errors.join('\n')).toContain('パックのフォルダの外')
    // ../ は、manifest の段階で拒否される
    writePack(priv, 'traversal', `${header('traversal', 'private')}motions:\n  - { name: x, file: ../outside.vrma }\n`)
    expect(store.view({ synthesize: false }).packs.find((x) => x.id === 'traversal' || x.name === 'traversal')!.valid).toBe(false)
  })
  it('同じ id のパックは、配布用が先。私用が配布用を差し替えない', () => {
    writePack(dist, 'same-id', header('same-id', 'distributable'))
    writePack(priv, 'same-id', header('same-id', 'private'))
    const v = store.view({ synthesize: false }).packs
    expect(v.find((p) => p.category === 'official')!.valid).toBe(true)
    expect(v.find((p) => p.category === 'individual')!.valid).toBe(false)
  })
  it('私用パックの書き出し用ファイル: pack.yaml と、検証済みのモーションだけ。配布用パックは、書き出せない', () => {
    writePack(priv, 'mine', `${header('mine', 'private')}motions:\n  - { name: hi, file: motions/hi.vrma }\n`, { 'motions/hi.vrma': wave(), 'secret-notes.txt': new Uint8Array([1]) })
    writePack(dist, 'public-one', header('public-one', 'distributable'))
    const files = store.exportFiles('mine')!
    expect(Object.keys(files).sort()).toEqual(['motions/hi.vrma', 'pack.yaml'])
    expect(Array.from(files['motions/hi.vrma'])).toEqual(Array.from(wave()))
    expect(store.exportFiles('public-one')).toBeNull()
    expect(store.exportFiles('nope')).toBeNull()
  })
  it('フォルダが無い・空でも、エラーにならない', () => {
    expect(store.view({ synthesize: false }).packs).toEqual([])
    expect(store.motionFiles()).toEqual([])
  })
})

describe('リポジトリの公式 Mod(resources/mods/official)', () => {
  it('すべて読め、配布用で、モーションは再配布可・ライセンス記載つき(確認できないものが、配布物に入っていない)', () => {
    const repoPacks = join(__dirname, '..', '..', 'resources', 'mods', 'official')
    const real = new PackStore(stub(), { official: repoPacks, community: join(dir, 'none-c'), individual: join(dir, 'none-i') }, join(dir, 'none'))
    for (const p of real.view({ synthesize: false }).packs) {
      expect(p.errors, p.id).toEqual([])
      expect(p.valid, p.id).toBe(true)
      expect(p.distribution).toBe('distributable')
      for (const m of p.motions) {
        expect(m.redistributable, m.name).toBe(true)
        expect(m.license, m.name).toBeTruthy()
      }
    }
  })
  it('リポジトリの resources/mods/official に、.vrma などの素材ファイルが入っていない(配布用の自作モーションは、コードで生成する)', async () => {
    const { readdirSync, statSync } = await import('node:fs')
    const walk = (d: string): string[] => {
      let names: string[]
      try {
        names = readdirSync(d)
      } catch {
        return []
      }
      return names.flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
    }
    const files = walk(join(__dirname, '..', '..', 'resources', 'mods', 'official'))
    expect(files.filter((f) => /\.(vrma|vrm|bvh|fbx|vmd|glb|gltf|wav|mp3)$/i.test(f))).toEqual([])
    void readFileSync
  })
})

describe('scripts/pack-export.mjs(コマンドでの書き出し)', () => {
  it('作った .vmaidpack を、アプリの取り込みの検査(unzipPack)が受け付け、中身が同一', async () => {
    const { execFileSync } = await import('node:child_process')
    const { unzipPack } = await import('../shared/packs/transfer')
    const { parsePackYaml } = await import('../shared/packs/manifest')
    writePack(priv, 'cli-pack', `${header('cli-pack', 'private')}motions:\n  - { name: hi, file: motions/hi.vrma }\n${RULES}`, { 'motions/hi.vrma': wave(), 'README.txt': new TextEncoder().encode('メモ') })
    const out = join(dir, 'cli-pack.vmaidpack')
    execFileSync(process.execPath, [join(__dirname, '..', '..', 'scripts', 'pack-export.mjs'), join(priv, 'cli-pack'), '--out', out])
    const un = unzipPack(new Uint8Array(readFileSync(out)))
    expect(un.ok).toBe(true)
    if (!un.ok) return
    expect(Object.keys(un.files).sort()).toEqual(['README.txt', 'motions/hi.vrma', 'pack.yaml'])
    expect(Array.from(un.files['motions/hi.vrma'])).toEqual(Array.from(wave()))
    expect(parsePackYaml(new TextDecoder().decode(un.files['pack.yaml'])).pack?.id).toBe('cli-pack')
  })
})

describe('配布ビルドの設定(electron-builder.yml)', () => {
  it('同梱する Mod は resources/mods/official だけ。取り込んだ・自作の Mod(userData の mods)や、ユーザーのデータフォルダは、含まれない', () => {
    const yml = readFileSync(join(__dirname, '..', '..', 'electron-builder.yml'), 'utf-8')
    const froms = [...yml.matchAll(/^\s*-\s*from:\s*(\S+)/gm)].map((m) => m[1])
    expect(froms).toContain('resources/mods/official')
    for (const f of froms) {
      expect(f, f).not.toMatch(/private|userData|Application Support|APPDATA|\.vmaidpack/i)
      expect(f, f).not.toMatch(/^(\/|~|\.\.)/) // リポジトリの外を指さない
    }
  })
})
