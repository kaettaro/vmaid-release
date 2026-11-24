import { describe, expect, it } from 'vitest'
import {
  makeProfile,
  normalizePresetName,
  presetToValues,
  readPresets,
  readOrientation,
  clampValue,
  composeExpression,
  composeWithMotion,
  defaultValues,
  expressionLabel,
  filterItems,
  nonDefaultValues,
  sanitizeProfile,
  type AdjustItem
} from './adjust'
import { panelBounds } from './geometry'

const items: AdjustItem[] = [
  { key: 'expr:happy', group: 'expression', label: '喜び (happy)', kind: 'slider', defaultValue: 0 },
  { key: 'expr:blink', group: 'expression', label: 'まばたき (blink)', kind: 'slider', defaultValue: 0 },
  { key: 'morph:face#Smile', group: 'morph', label: 'face / Smile', hint: '表情 Joy でも使われています', kind: 'slider', defaultValue: 0 },
  { key: 'mesh:Hair', group: 'visibility', label: 'メッシュ Hair', kind: 'toggle', defaultValue: 1 }
]

describe('値の扱い', () => {
  it('既定値の辞書を作れる', () => {
    expect(defaultValues(items)['mesh:Hair']).toBe(1)
    expect(defaultValues(items)['expr:happy']).toBe(0)
  })
  it('スライダーは0〜1に丸め、トグルは0/1に丸め、不正値は既定値', () => {
    expect(clampValue(items[0], 2)).toBe(1)
    expect(clampValue(items[0], -1)).toBe(0)
    expect(clampValue(items[3], 0.4)).toBe(0)
    expect(clampValue(items[3], 0.6)).toBe(1)
    expect(clampValue(items[3], NaN)).toBe(1)
  })
  it('既定値と違うものだけを保存対象にする', () => {
    const v = { ...defaultValues(items), 'expr:happy': 0.5, 'mesh:Hair': 0 }
    expect(nonDefaultValues(items, v)).toEqual({ 'expr:happy': 0.5, 'mesh:Hair': 0 })
  })
})

describe('sanitizeProfile', () => {
  it('存在しない項目は捨て、範囲外は丸める', () => {
    const raw = { version: 1, values: { 'expr:happy': 3, 'expr:gone': 0.5, 'mesh:Hair': 0 } }
    expect(sanitizeProfile(items, raw)).toEqual({ 'expr:happy': 1, 'mesh:Hair': 0 })
  })
  it('壊れた入力でも空の辞書になる', () => {
    expect(sanitizeProfile(items, null)).toEqual({})
    expect(sanitizeProfile(items, 'x')).toEqual({})
    expect(sanitizeProfile(items, { values: 'x' })).toEqual({})
  })
})

describe('キャラの向き(yaw)', () => {
  it('プロファイルに保存して読み出せる。古い形式・壊れた値は 0、範囲外は丸める', () => {
    expect(readOrientation(makeProfile({}, {}, { yaw: 90, pitch: 30 }))).toEqual({ yaw: 90, pitch: 30 })
    expect(readOrientation({ version: 1, values: {} })).toEqual({ yaw: 0, pitch: 0 })
    expect(readOrientation({ yaw: 'x', pitch: 'y' })).toEqual({ yaw: 0, pitch: 0 })
    expect(readOrientation({ yaw: 270, pitch: 200 })).toEqual({ yaw: -90, pitch: 75 })
    expect(readOrientation(null)).toEqual({ yaw: 0, pitch: 0 })
  })
})

describe('プリセット(名前をつけて保存)', () => {
  it('名前は前後の空白を除き、1〜40文字。空・長すぎ・制御文字は不可。日本語・絵文字もよい', () => {
    expect(normalizePresetName('  私服 ')).toBe('私服')
    expect(normalizePresetName('')).toBeNull()
    expect(normalizePresetName('   ')).toBeNull()
    expect(normalizePresetName('あ'.repeat(40))).toBe('あ'.repeat(40))
    expect(normalizePresetName('あ'.repeat(41))).toBeNull()
    expect(normalizePresetName('a\nb')).toBeNull()
  })
  it('プロファイルに、基準値とセットを両方入れて、読み出せる。古い形式(セットなし)・壊れた形式は空になる', () => {
    const profile = makeProfile({ 'expr:happy': 1 }, { 私服: { 'mesh:Hair': 0 } })
    expect(readPresets(profile)).toEqual({ 私服: { 'mesh:Hair': 0 } })
    expect(readPresets({ version: 1, values: {} })).toEqual({})
    expect(readPresets({ presets: 'x' })).toEqual({})
    expect(readPresets(null)).toEqual({})
    expect(sanitizeProfile(items, profile)).toEqual({ 'expr:happy': 1 }) // 基準値の読み出しは、セットに影響されない
  })
  it('セットの適用は「状態まるごと」: 書かれていない項目は既定値になり、存在しない項目は無視、範囲外は丸める', () => {
    const v = presetToValues(items, { 'expr:happy': 5, 'mesh:Hair': 0, 'expr:gone': 1 })
    expect(v).toEqual({ ...defaultValues(items), 'expr:happy': 1, 'mesh:Hair': 0 })
    expect(v['expr:blink']).toBe(0) // セットに無い項目は既定値(いまの値は引き継がない)
    expect(presetToValues(items, {})).toEqual(defaultValues(items))
  })
})

describe('filterItems', () => {
  it('空の検索は全件', () => expect(filterItems(items, '  ')).toHaveLength(4))
  it('ラベル・キー・補足を大文字小文字無視で検索する', () => {
    expect(filterItems(items, 'HAPPY').map((i) => i.key)).toEqual(['expr:happy'])
    expect(filterItems(items, 'joy').map((i) => i.key)).toEqual(['morph:face#Smile'])
    expect(filterItems(items, 'まばたき').map((i) => i.key)).toEqual(['expr:blink'])
  })
  it('複数語はAND', () => {
    expect(filterItems(items, 'face smile')).toHaveLength(1)
    expect(filterItems(items, 'face hair')).toHaveLength(0)
  })
})

describe('composeExpression', () => {
  it('自動値が無ければ基準値、あれば大きいほう', () => {
    expect(composeExpression(0.3, undefined, undefined)).toBe(0.3)
    expect(composeExpression(0, undefined, 0.8)).toBe(0.8)
    expect(composeExpression(1, undefined, 0.2)).toBe(1) // 基準で閉じていれば自動で開かない
  })
  it('一時上書きが最優先(0への上書きも有効)', () => {
    expect(composeExpression(0.5, 0, 0.9)).toBe(0)
    expect(composeExpression(0, 0.7, undefined)).toBe(0.7)
  })
})

describe('expressionLabel', () => {
  it('プリセットは日本語付き、カスタムはそのまま', () => {
    expect(expressionLabel('happy')).toBe('喜び (happy)')
    expect(expressionLabel('MyCustom')).toBe('MyCustom')
  })
})

describe('panelBounds', () => {
  const area = { x: 0, y: 0, width: 1440, height: 900 }
  const size = { width: 340, height: 560 }
  it('キャラの右隣に出る', () => {
    const b = panelBounds({ x: 100, y: 200, width: 400, height: 600 }, size, area)
    expect(b).toEqual({ x: 508, y: 200, width: 340, height: 560 })
  })
  it('右に入らなければ左隣', () => {
    const b = panelBounds({ x: 1000, y: 200, width: 400, height: 600 }, size, area)
    expect(b.x).toBe(1000 - 8 - 340)
  })
  it('下にはみ出さないよう上へ寄せる', () => {
    const b = panelBounds({ x: 100, y: 700, width: 400, height: 600 }, size, area)
    expect(b.y).toBe(900 - 560)
  })
  it('作業領域より大きい要求は縮める', () => {
    expect(panelBounds({ x: 0, y: 0, width: 400, height: 600 }, { width: 340, height: 2000 }, area).height).toBe(900)
  })
})

describe('composeWithMotion', () => {
  it('モーションの表情の値は、自動まばたき・基準値と、大きいほうを採る。ルールの上書きが最優先', () => {
    expect(composeWithMotion(0, undefined, 0.7)).toBe(0.7) // 自動まばたきが 0 でも、モーションのまばたきが効く
    expect(composeWithMotion(0.9, undefined, 0.2)).toBe(0.9)
    expect(composeWithMotion(0.3, 0, 0.8)).toBe(0.3) // 上書きがあれば、モーションの値は使わない
  })
})
