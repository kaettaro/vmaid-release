import { describe, expect, it } from 'vitest'
import { BasicPatchSchema, DEFAULT_RESET_SHORTCUT, isValidAccelerator } from './basic'

describe('ショートカットの形', () => {
  it('既定と、修飾キーつきの形は、通る', () => {
    expect(isValidAccelerator(DEFAULT_RESET_SHORTCUT)).toBe(true)
    expect(isValidAccelerator('Ctrl+Alt+K')).toBe(true)
    expect(isValidAccelerator('CommandOrControl+Shift+F12')).toBe(true)
    expect(isValidAccelerator('Alt+Space')).toBe(true)
  })
  it('修飾キーが無い・キーが無い・不正なものは、通らない(ふだんの入力を奪わない)', () => {
    for (const t of ['R', 'F5', 'Space', 'Ctrl+', 'Ctrl+Alt', 'Ctrl+RR', '', 'Ctrl+Alt+Shift+Ra', 'foo+R']) expect(isValidAccelerator(t), t).toBe(false)
  })
})

describe('基本設定の更新', () => {
  it('倍率は範囲に丸める。変えた項目だけが残る', () => {
    expect(BasicPatchSchema.parse({ scale: 10 })).toEqual({ scale: 3 })
    expect(BasicPatchSchema.parse({ clickThrough: false })).toEqual({ clickThrough: false })
  })
  it('不正な値は弾く(検証エラー)', () => {
    expect(BasicPatchSchema.safeParse({ resetShortcut: 'R' }).success).toBe(false)
    expect(BasicPatchSchema.safeParse({ alwaysOnTop: 'yes' }).success).toBe(false)
    expect(BasicPatchSchema.safeParse({ scale: NaN }).success).toBe(false)
  })
})
