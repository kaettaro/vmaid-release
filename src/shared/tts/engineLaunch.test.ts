import { describe, expect, it } from 'vitest'
import { planEngineLaunch, type LaunchInput } from './engineLaunch'

const base: LaunchInput = {
  modOn: true,
  backend: 'voicevox',
  autoStart: true,
  enginePath: 'C:/VOICEVOX/vv-engine/run.exe',
  endpoint: 'http://127.0.0.1:50021',
  platform: 'win32',
  pathKind: 'file'
}
const plan = (o: Partial<LaunchInput>) => planEngineLaunch({ ...base, ...o })

describe('VOICEVOX エンジンの自動起動の判断', () => {
  it('条件がそろったときだけ、起動する(Windows の .exe)', () => {
    expect(plan({})).toEqual({ action: 'spawn' })
  })

  it('音声合成 Mod が OFF・方式が OS の音声・自動起動が OFF のときは、何もしない', () => {
    expect(plan({ modOn: false })).toEqual({ action: 'none' })
    expect(plan({ backend: 'system' })).toEqual({ action: 'none' })
    expect(plan({ autoStart: false })).toEqual({ action: 'none' })
  })

  it('接続先が自分のPCでないときは、起動しない(外部のエンジンを、こちらが起動する意味がなく、起動する実行ファイルとの対応も取れない)', () => {
    const r = plan({ endpoint: 'http://192.168.1.5:50021' })
    expect(r.action === 'blocked' && r.reason).toContain('自分のPC')
    expect(plan({ endpoint: 'http://localhost:50021' })).toEqual({ action: 'spawn' })
  })

  it('実行ファイルが未選択・見つからない・フォルダ・Windows で .exe でないときは、理由つきで止める', () => {
    expect(plan({ enginePath: null })).toMatchObject({ action: 'blocked' })
    expect(plan({ pathKind: 'none' })).toMatchObject({ action: 'blocked', reason: expect.stringContaining('見つかりません') })
    expect(plan({ pathKind: 'dir' })).toMatchObject({ action: 'blocked', reason: expect.stringContaining('フォルダ') })
    expect(plan({ enginePath: 'C:/x/readme.txt' })).toMatchObject({ action: 'blocked', reason: expect.stringContaining('.exe') })
  })

  it('macOS の .app は open で起動する。.app でない実行ファイルは、そのまま起動する', () => {
    expect(plan({ platform: 'darwin', enginePath: '/Applications/VOICEVOX.app', pathKind: 'dir' })).toEqual({ action: 'open-app' })
    expect(plan({ platform: 'darwin', enginePath: '/Applications/VOICEVOX.app', pathKind: 'file' })).toMatchObject({ action: 'blocked' })
    expect(plan({ platform: 'darwin', enginePath: '/opt/vv/run', pathKind: 'file' })).toEqual({ action: 'spawn' })
  })
})
