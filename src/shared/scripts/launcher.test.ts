import { describe, expect, it } from 'vitest'
import { ScriptSchema } from './spec'
import { planLauncher, shouldAutoStart } from './launcher'

describe('planLauncher', () => {
  it('未選択・存在しない・フォルダは断る', () => {
    expect(planLauncher({ path: null, pathKind: 'none', platform: 'win32' })).toMatchObject({ action: 'blocked' })
    expect(planLauncher({ path: 'C:\\x\\a.bat', pathKind: 'none', platform: 'win32' })).toMatchObject({ action: 'blocked' })
    expect(planLauncher({ path: 'C:\\x', pathKind: 'dir', platform: 'win32' })).toMatchObject({ action: 'blocked' })
  })
  it('Windows は exe / bat / cmd だけ', () => {
    for (const p of ['C:\\x\\a.exe', 'C:\\x\\a.BAT', 'C:\\x\\a.cmd']) expect(planLauncher({ path: p, pathKind: 'file', platform: 'win32' })).toEqual({ action: 'spawn' })
    expect(planLauncher({ path: 'C:\\x\\a.ps1', pathKind: 'file', platform: 'win32' })).toMatchObject({ action: 'blocked' })
  })
  it('macOS の .app は open、ほかは spawn', () => {
    expect(planLauncher({ path: '/Applications/X.app', pathKind: 'dir', platform: 'darwin' })).toEqual({ action: 'open-app' })
    expect(planLauncher({ path: '/opt/x/run', pathKind: 'file', platform: 'darwin' })).toEqual({ action: 'spawn' })
  })
})

describe('shouldAutoStart', () => {
  it('自動起動 ON かつ、healthUrl と同じオリジンへの通信のときだけ', () => {
    const o = 'http://127.0.0.1:8787'
    expect(shouldAutoStart({ autoOn: true, requestOrigin: o, healthOrigin: o })).toBe(true)
    expect(shouldAutoStart({ autoOn: false, requestOrigin: o, healthOrigin: o })).toBe(false)
    expect(shouldAutoStart({ autoOn: true, requestOrigin: 'http://127.0.0.1:9', healthOrigin: o })).toBe(false)
    expect(shouldAutoStart({ autoOn: true, requestOrigin: null, healthOrigin: o })).toBe(false)
    expect(shouldAutoStart({ autoOn: true, requestOrigin: o, healthOrigin: null })).toBe(false)
  })
})

describe('ScriptSchema の launcher', () => {
  const base = {
    apiVersion: 1,
    settings: [
      { name: 'exe', label: '実行ファイル', kind: 'file' },
      { name: 'auto', label: '自動起動', kind: 'boolean' }
    ],
    permissions: { network: ['http://127.0.0.1:8787'] },
    launcher: { label: 'text-to-vrma', pathSetting: 'exe', autoSetting: 'auto', healthUrl: 'http://127.0.0.1:8787/health' }
  }
  it('正しい宣言は通り、startupSec の既定は 120', () => {
    const r = ScriptSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.launcher?.startupSec).toBe(120)
  })
  it('healthUrl が外部・permissions.network の外なら断る', () => {
    expect(ScriptSchema.safeParse({ ...base, launcher: { ...base.launcher, healthUrl: 'https://example.com/health' } }).success).toBe(false)
    expect(ScriptSchema.safeParse({ ...base, launcher: { ...base.launcher, healthUrl: 'http://127.0.0.1:9999/health' } }).success).toBe(false)
  })
  it('pathSetting が file でない・autoSetting が boolean でないなら断る', () => {
    expect(ScriptSchema.safeParse({ ...base, launcher: { ...base.launcher, pathSetting: 'auto' } }).success).toBe(false)
    expect(ScriptSchema.safeParse({ ...base, launcher: { ...base.launcher, autoSetting: 'exe' } }).success).toBe(false)
  })
  it('launcher の pathSetting 以外の file 設定は断る', () => {
    const extra = { ...base, settings: [...base.settings, { name: 'other', label: 'その他', kind: 'file' }] }
    expect(ScriptSchema.safeParse(extra).success).toBe(false)
    const noLauncher = { apiVersion: 1, settings: [{ name: 'exe', label: 'x', kind: 'file' }] }
    expect(ScriptSchema.safeParse(noLauncher).success).toBe(false)
  })
})
