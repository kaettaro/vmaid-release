import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { OverlayEffectStore } from './overlayEffects'

let dir: string
let store: OverlayEffectStore
const GOOD = 'label: テスト\ncolor: "#ff0000"\nlayers:\n  - { type: fog }\n'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmaid-fx-'))
  store = new OverlayEffectStore(join(dir, 'overlay-effects'))
  return () => rmSync(dir, { recursive: true, force: true })
})

describe('OverlayEffectStore', () => {
  it('組み込みの効果が一覧に出て、名前から定義を得られる', () => {
    expect(store.list().filter((e) => e.builtin).map((e) => e.name)).toContain('pink-fog')
    expect(store.get('pink-fog')?.layers.length).toBeGreaterThan(0)
    expect(store.get('nope')).toBeNull()
  })
  it('自作の効果を保存・一覧・取得・削除できる', () => {
    expect(store.save('my-fog', GOOD)).toMatchObject({ ok: true })
    const mine = store.list().filter((e) => !e.builtin)
    expect(mine).toMatchObject([{ name: 'my-fog', label: 'テスト', error: null }])
    expect(store.get('my-fog')?.color).toBe('#ff0000')
    expect(store.delete('my-fog').ok).toBe(true)
    expect(store.get('my-fog')).toBeNull()
  })
  it('不正な YAML・名前・組み込みの名前は保存しない(ファイルも作らない)', () => {
    expect(store.save('bad', 'layers: []').ok).toBe(false)
    expect(store.save('Bad Name', GOOD).ok).toBe(false)
    expect(store.save('../x', GOOD).ok).toBe(false)
    expect(store.save('spiral', GOOD).ok).toBe(false)
    expect(existsSync(join(dir, 'overlay-effects', 'bad.yaml'))).toBe(false)
    expect(store.delete('spiral').ok).toBe(false)
  })
  it('手で置いたファイルが壊れていても、一覧にエラーつきで出て、描く効果としては使えない', () => {
    store.save('ok-one', GOOD)
    writeFileSync(join(dir, 'overlay-effects', 'broken.yaml'), 'layers:\n  - { type: strobe }\n')
    const broken = store.list().find((e) => e.name === 'broken')
    expect(broken?.error).toBeTruthy()
    expect(store.get('broken')).toBeNull()
    expect(store.get('ok-one')).not.toBeNull()
  })
})
