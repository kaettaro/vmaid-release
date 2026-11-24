import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { defaultValues, type AdjustItem, type AdjustSnapshot } from '../shared/adjust'
import { IPC } from '../shared/ipc'
import { AdjustHub } from './adjustHub'
import type { ProfileStore } from './profileStore'

const items: AdjustItem[] = [
  { key: 'morph:face#CatEar', group: 'morph', label: '猫耳', kind: 'slider', defaultValue: 0 },
  { key: 'morph:face#HeartEye', group: 'morph', label: 'ハート目', kind: 'slider', defaultValue: 0 },
  { key: 'mat:Coat', group: 'visibility', label: '上着', kind: 'toggle', defaultValue: 1 }
]

function setup(presets: Record<string, Record<string, number>>) {
  const written: Array<Record<string, number>> = []
  const profiles = {
    read: () => ({ version: 1, values: {}, presets, yaw: 0, pitch: 0 }),
    write: (_hash: string, values: Record<string, number>) => void written.push(values)
  } as unknown as ProfileStore
  const sent: Array<{ channel: string; arg: unknown }> = []
  const win = { webContents: { send: (channel: string, arg: unknown) => void sent.push({ channel, arg }) } } as unknown as BrowserWindow
  const hub = new AdjustHub(profiles, () => win, () => win)
  const snapshot: AdjustSnapshot = { modelHash: 'h', modelName: 'm', items, values: defaultValues(items), presets: [] }
  hub.publish(snapshot)
  const latest = (): Record<string, number> => {
    const all = sent.filter((s) => s.channel === IPC.adjustApplyAll)
    return all[all.length - 1].arg as Record<string, number>
  }
  return { hub, written, latest, snapshot }
}

describe('AdjustHub: セットを重ねる', () => {
  const presets = { 猫耳: { 'morph:face#CatEar': 1 }, ハート目: { 'morph:face#HeartEye': 1 }, 上着なし: { 'mat:Coat': 0 } }

  it('別々のセットを重ねると、同時に効く。1つ外しても、ほかは残る', () => {
    const { hub, latest } = setup(presets)
    hub.applyPreset('猫耳', { transient: true })
    hub.applyPreset('ハート目', { transient: true })
    hub.applyPreset('上着なし', { transient: true })
    expect(latest()).toEqual({ 'morph:face#CatEar': 1, 'morph:face#HeartEye': 1, 'mat:Coat': 0 })
    hub.revert({ name: 'ハート目' })
    expect(latest()).toEqual({ 'morph:face#CatEar': 1, 'morph:face#HeartEye': 0, 'mat:Coat': 0 })
    hub.revert()
    expect(latest()).toEqual(defaultValues(items))
  })

  it('重ねたセットは保存されない。保存されるのは手で調整した基準値だけ', () => {
    const { hub, written } = setup(presets)
    hub.applyPreset('猫耳', { transient: true })
    hub.set('morph:face#HeartEye', 0.5)
    hub.flush()
    expect(written[written.length - 1]).toEqual({ 'morph:face#HeartEye': 0.5 })
  })

  it('Mod ごとに外せる(source)', () => {
    const { hub, latest } = setup(presets)
    hub.applyPreset('猫耳', { transient: true, source: 'mod-a' })
    hub.applyPreset('ハート目', { transient: true, source: 'mod-b' })
    hub.revert({ source: 'mod-a' })
    expect(latest()['morph:face#CatEar']).toBe(0)
    expect(latest()['morph:face#HeartEye']).toBe(1)
  })

  it('指定秒数で自動的に外れる', () => {
    vi.useFakeTimers()
    try {
      const { hub, latest } = setup(presets)
      hub.applyPreset('猫耳', { transient: true, revertAfterSec: 5 })
      expect(latest()['morph:face#CatEar']).toBe(1)
      vi.advanceTimersByTime(5100)
      expect(latest()['morph:face#CatEar']).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('パネルの「呼び出す」(重ねない)は、状態まるごとが基準値になり、重ねていたセットは外れる', () => {
    const { hub, latest, snapshot } = setup(presets)
    hub.applyPreset('猫耳', { transient: true })
    hub.applyPreset('上着なし')
    expect(latest()).toEqual({ 'morph:face#CatEar': 0, 'morph:face#HeartEye': 0, 'mat:Coat': 0 })
    expect(snapshot.layers).toEqual([])
  })

  it('緊急リセットの「元に戻す」: 重ねているセットを記録して、外したあとに、同じ重なりへ戻せる', () => {
    const { hub, latest } = setup(presets)
    hub.applyPreset('猫耳', { transient: true })
    hub.applyPreset('上着なし', { transient: true, mode: 'replace' })
    const saved = hub.snapshotLayers()
    const effective = latest()
    hub.revert() // リセットで外れる
    expect(latest()).toEqual(defaultValues(items))
    hub.restoreLayers(saved)
    expect(latest()).toEqual(effective)
    // 記録は、コピー(あとで外しても、記録は変わらない)
    expect(saved.map((l) => l.id)).toEqual(['猫耳', '上着なし'])
  })

  it('保存している向きを、コピーで取り出せる', () => {
    const { hub } = setup(presets)
    hub.setOrientation(30, 10)
    const o = hub.getOrientation()
    o.yaw = 0
    expect(hub.getOrientation()).toEqual({ yaw: 30, pitch: 10 })
  })

  it('スナップショットに、重ねているセットが載る', () => {
    const { hub, snapshot } = setup(presets)
    hub.applyPreset('猫耳', { transient: true })
    hub.applyPreset('上着なし', { transient: true, mode: 'replace' })
    expect(snapshot.layers).toEqual([
      { id: '猫耳', mode: 'overlay' },
      { id: '上着なし', mode: 'replace' }
    ])
  })
})

describe('AdjustHub: 標準の表情・衣装', () => {
  const presets = { 私服: { 'mat:Coat': 0 }, 猫耳: { 'morph:face#CatEar': 1 } }

  it('標準に決めたセットへ「標準に戻す」と、重ねたセットが外れ、基準値が標準になる', () => {
    const { hub, latest, snapshot } = setup(presets)
    expect(hub.setDefaultPreset('私服').ok).toBe(true)
    expect(snapshot.defaultPreset).toBe('私服')
    hub.set('morph:face#HeartEye', 1) // 手で調整した値
    hub.applyPreset('猫耳', { transient: true })
    hub.resetLook()
    expect(latest()).toEqual({ 'morph:face#CatEar': 0, 'morph:face#HeartEye': 0, 'mat:Coat': 0 })
    expect(snapshot.layers).toEqual([])
  })

  it('標準を決めていなければ、重ねたセットを外すだけで、基準値はそのまま', () => {
    const { hub, latest } = setup(presets)
    hub.set('morph:face#HeartEye', 1)
    hub.applyPreset('猫耳', { transient: true })
    hub.resetLook()
    expect(latest()).toEqual({ 'morph:face#CatEar': 0, 'morph:face#HeartEye': 1, 'mat:Coat': 1 })
  })

  it('無いセットは標準にできない。標準のセットを消すと、標準は解除される', () => {
    const { hub, snapshot } = setup(presets)
    expect(hub.setDefaultPreset('ない').ok).toBe(false)
    hub.setDefaultPreset('私服')
    hub.deletePreset('私服')
    expect(snapshot.defaultPreset).toBeNull()
    expect(hub.setDefaultPreset(null).ok).toBe(true)
  })
})
