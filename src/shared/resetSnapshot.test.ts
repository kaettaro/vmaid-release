import { describe, expect, it } from 'vitest'
import { RESET_DIALOG, makeResetSnapshot, type ResetSnapshot } from './resetSnapshot'

const snap = (): ResetSnapshot => ({
  bounds: { x: 10, y: 20, width: 400, height: 600 },
  scale: 1.5,
  clickThrough: true,
  visible: false,
  orientation: { yaw: 30, pitch: -5 },
  layers: [{ id: '猫耳', source: null, mode: 'overlay', values: { 'morph:a#b': 1 } }]
})

describe('リセットの記録', () => {
  it('記録は、元の値から独立している(あとで元の値が変わっても、記録は変わらない)', () => {
    const src = snap()
    const copy = makeResetSnapshot(src)
    src.bounds.x = 999
    src.orientation.yaw = 0
    src.layers[0].values['morph:a#b'] = 0
    expect(copy.bounds.x).toBe(10)
    expect(copy.orientation.yaw).toBe(30)
    expect(copy.layers[0].values['morph:a#b']).toBe(1)
  })

  it('ダイアログの文言に、戻るもの・止まるもの・取り消しの説明がある', () => {
    expect(RESET_DIALOG.detail).toContain('戻るもの')
    expect(RESET_DIALOG.detail).toContain('止まるもの')
    expect(RESET_DIALOG.detail).toContain('元に戻す')
    expect(RESET_DIALOG.ok).not.toBe(RESET_DIALOG.cancel)
  })
})
