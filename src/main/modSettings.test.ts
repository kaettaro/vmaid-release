import { describe, expect, it, vi } from 'vitest'
import { parseSettings } from '../shared/settings'
import { ScriptSchema } from '../shared/scripts/spec'
import type { SettingsStore } from './settingsStore'

// 暗号化は、OS の機能(safeStorage)。ここでは、簡単な代用品で、「平文を保存しない・復号して返す」ことを確かめる
const state = vi.hoisted(() => ({ available: true }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (s: string) => Buffer.from(`ENC(${s})`.split('').reverse().join('')),
    decryptString: (b: Buffer) => b.toString().split('').reverse().join('').slice(4, -1)
  }
}))
import { readModSetting, setModSetting, viewModSetting } from './modSettings'

const spec = ScriptSchema.parse({
  apiVersion: 1,
  settings: [
    { name: 'endpoint', label: '接続先', kind: 'string', default: 'http://127.0.0.1:8787' },
    { name: 'token', label: 'トークン', kind: 'secret' },
    { name: 'seconds', label: '秒', kind: 'number', default: 4 },
    { name: 'loop', label: 'ループ', kind: 'boolean' }
  ]
})

function fresh(): { settings: ReturnType<typeof parseSettings>; store: SettingsStore } {
  const settings = parseSettings({})
  return { settings, store: { get: () => settings, update: (m: (s: typeof settings) => void) => m(settings) } as unknown as SettingsStore }
}

describe('スクリプト Mod の設定項目', () => {
  it('未設定なら、宣言の既定値(無ければ null)。設定すると、型つきで読める。空にすると、既定値に戻る', () => {
    const { store, settings } = fresh()
    expect(readModSetting(store, spec, 'm', 'endpoint')).toBe('http://127.0.0.1:8787')
    expect(readModSetting(store, spec, 'm', 'token')).toBeNull()
    expect(setModSetting(store, spec, 'm', 'endpoint', ' http://127.0.0.1:9000 ').ok).toBe(true)
    expect(setModSetting(store, spec, 'm', 'seconds', '6.5').ok).toBe(true)
    expect(setModSetting(store, spec, 'm', 'loop', 'true').ok).toBe(true)
    expect(readModSetting(store, spec, 'm', 'endpoint')).toBe('http://127.0.0.1:9000')
    expect(readModSetting(store, spec, 'm', 'seconds')).toBe(6.5)
    expect(readModSetting(store, spec, 'm', 'loop')).toBe(true)
    setModSetting(store, spec, 'm', 'endpoint', '')
    expect(readModSetting(store, spec, 'm', 'endpoint')).toBe('http://127.0.0.1:8787')
    expect(Object.keys(settings.mods.modSettings.m)).toEqual(['seconds', 'loop'])
  })

  it('宣言にない項目・型に合わない値は、断る', () => {
    const { store } = fresh()
    expect(setModSetting(store, spec, 'm', 'nope', 'x')).toEqual({ ok: false, message: 'この Mod に、その設定項目はありません' })
    expect(setModSetting(store, spec, 'm', 'seconds', 'abc').ok).toBe(false)
    expect(setModSetting(store, spec, 'm', 'loop', 'yes').ok).toBe(false)
    expect(setModSetting(store, spec, 'm', 'endpoint', 'x'.repeat(2001)).ok).toBe(false)
    expect(readModSetting(store, spec, 'm', 'nope')).toBeNull()
  })

  it('secret は、平文を保存せず、復号して返す。画面には、値を出さない(設定済みかだけ)。暗号化できない環境では、保存を断る', () => {
    const { store, settings } = fresh()
    expect(setModSetting(store, spec, 'm', 'token', 'sk-secret-123').ok).toBe(true)
    expect(JSON.stringify(settings.mods.modSettings)).not.toContain('sk-secret-123')
    expect(settings.mods.modSettings.m.token.startsWith('enc:')).toBe(true)
    expect(readModSetting(store, spec, 'm', 'token')).toBe('sk-secret-123')
    const view = viewModSetting(store, spec, 'm').find((s) => s.name === 'token')
    expect(view).toMatchObject({ value: '', isSet: true })
    state.available = false
    try {
      expect(setModSetting(store, spec, 'm', 'token', 'another').ok).toBe(false)
      expect(readModSetting(store, spec, 'm', 'token')).toBeNull() // 復号できない環境では、読めない
    } finally {
      state.available = true
    }
  })
})
