import { describe, expect, it } from 'vitest'
import { classifyTouch, touchBonesOf, type CustomTouchPart } from './parts'
import { parsePackYaml } from '../packs/manifest'

// 身体: 画面の x=100(中心)、y=0(頭のてっぺん)〜1000(足元)。高さ 1000px
const box = { top: 0, bottom: 1000, centerX: 100 }
const bones = {
  leftShoulder: { x: 160, y: 250 },
  rightShoulder: { x: 40, y: 250 },
  neck: { x: 100, y: 200 },
  leftUpperLeg: { x: 130, y: 560 },
  rightUpperLeg: { x: 70, y: 560 }
}
const shoulder: CustomTouchPart = { id: 'shoulder', label: '肩', sides: true, region: { kind: 'bone', bone: 'shoulder', radius: 0.05 } }
const neck: CustomTouchPart = { id: 'neck', label: '首', sides: false, region: { kind: 'bone', bone: 'neck', radius: 0.04 } }
const thigh: CustomTouchPart = { id: 'thigh', label: '太もも', sides: true, region: { kind: 'band', from: 0.56, to: 0.7 } }

describe('Mod が宣言した触れ合いの部位', () => {
  it('宣言が無ければ、本体の部位のまま(既存の動作は変わらない)', () => {
    expect(classifyTouch({ x: 100, y: 100 }, bones, box)?.part).toBe('head')
    expect(classifyTouch({ x: 100, y: 300 }, bones, box)?.part).toBe('chest')
  })

  it('骨の近くを触ると、本体の部位より先に、宣言した部位になる。左右は、キャラの左右', () => {
    expect(classifyTouch({ x: 165, y: 255 }, bones, box, [shoulder])).toEqual({ part: 'shoulder', side: 'left' })
    expect(classifyTouch({ x: 35, y: 245 }, bones, box, [shoulder])).toEqual({ part: 'shoulder', side: 'right' })
  })

  it('左右のない部位は center。範囲の外は、本体の部位のまま', () => {
    expect(classifyTouch({ x: 100, y: 205 }, bones, box, [neck])).toEqual({ part: 'neck', side: 'center' })
    expect(classifyTouch({ x: 100, y: 300 }, bones, box, [neck])?.part).toBe('chest')
  })

  it('骨が無いモデルでは、その部位は判定されない(本体の部位に任せる)', () => {
    expect(classifyTouch({ x: 165, y: 255 }, {}, box, [shoulder])?.part).not.toBe('shoulder')
  })

  it('高さの帯で宣言した部位(狭いほうが先)。左右は、体の中心より画面の右がキャラの左', () => {
    expect(classifyTouch({ x: 130, y: 620 }, bones, box, [thigh])).toEqual({ part: 'thigh', side: 'left' })
    expect(classifyTouch({ x: 70, y: 620 }, bones, box, [thigh])).toEqual({ part: 'thigh', side: 'right' })
    expect(classifyTouch({ x: 100, y: 800 }, bones, box, [thigh])?.part).toBe('leg')
    const narrow: CustomTouchPart = { id: 'knee-up', label: '膝上', sides: false, region: { kind: 'band', from: 0.6, to: 0.65 } }
    expect(classifyTouch({ x: 100, y: 620 }, bones, box, [thigh, narrow])?.part).toBe('knee-up')
  })

  it('touchBonesOf: 判定に必要な骨(左右のある部位は両側)', () => {
    expect(touchBonesOf([shoulder, neck, thigh]).sort()).toEqual(['leftShoulder', 'neck', 'rightShoulder'])
  })
})

describe('Mod の manifest: touchParts', () => {
  const yaml = (body: string): string => `id: tp-test\nname: テスト\nversion: "1"\ndistribution: private\n${body}`
  it('宣言を読める(骨・帯)', () => {
    const r = parsePackYaml(yaml('touchParts:\n  - { id: shoulder, label: 肩, sides: true, bone: shoulder, radius: 0.05 }\n  - { id: thigh, label: 太もも, sides: true, band: [0.56, 0.7] }\n'))
    expect(r.errors).toEqual([])
    expect(r.pack?.touchParts.map((p) => [p.id, p.sides, p.region.kind])).toEqual([
      ['shoulder', true, 'bone'],
      ['thigh', true, 'band']
    ])
  })
  it('不正な宣言はエラー(骨と帯の両方・どちらも無い・骨の名前・id の重複・本体の部位との重複)', () => {
    const bad = (line: string): string[] => parsePackYaml(yaml(`touchParts:\n  - ${line}\n`)).errors
    expect(bad('{ id: a, label: A, bone: neck, radius: 0.05, band: [0, 1] }').length).toBeGreaterThan(0)
    expect(bad('{ id: a, label: A }').length).toBeGreaterThan(0)
    expect(bad('{ id: a, label: A, sides: true, bone: neck, radius: 0.05 }').length).toBeGreaterThan(0) // neck は左右のない骨
    expect(bad('{ id: a, label: A, bone: tail, radius: 0.05 }').length).toBeGreaterThan(0)
    expect(bad('{ id: a, label: A, band: [0.7, 0.5] }').length).toBeGreaterThan(0)
    expect(bad('{ id: head, label: 頭2, band: [0, 0.1] }').length).toBeGreaterThan(0)
    expect(parsePackYaml(yaml('touchParts:\n  - { id: a, label: A, band: [0, 0.1] }\n  - { id: a, label: B, band: [0.2, 0.3] }\n')).errors.length).toBeGreaterThan(0)
  })
})
