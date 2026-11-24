import { describe, expect, it } from 'vitest'
import { BODY_BANDS, classifyTouch, distanceToSegment, TOUCH_PARTS, type Point2 } from './parts'

// 実際の Alicia(VRM)を画面に出したときの座標(画像 800x1200 での px)。頭のてっぺん y=320、足元 y=1180。
// ボーンは見た目の部位より、上に寄っている(例: hips の骨は y=665 だが、見た目の腰は y=740 付近)ので、
// 判定は「身体の高さに対する割合」で行う(parts.ts の設計)。
const box = { top: 320, bottom: 1180, centerX: 400 }
const arms: Record<string, Point2> = {
  leftUpperArm: { x: 437, y: 510 }, leftLowerArm: { x: 474, y: 611 }, leftHand: { x: 507, y: 719 },
  rightUpperArm: { x: 363, y: 510 }, rightLowerArm: { x: 327, y: 612 }, rightHand: { x: 294, y: 720 }
}
const at = (x: number, y: number) => classifyTouch({ x, y }, arms, box)

describe('distanceToSegment', () => {
  it('線分の途中・端・長さ0の線分(点)への距離', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(distanceToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
  })
})

describe('classifyTouch: 頭・胸・お腹・腰(身体の高さの割合)', () => {
  it('実際の Alicia の見た目の位置で、頭・胸・お腹・腰を判定する', () => {
    expect(at(400, 345)).toEqual({ part: 'head', side: 'center' }) // 髪のリボン(頭の上)
    expect(at(400, 440)).toEqual({ part: 'head', side: 'center' }) // 顔
    expect(at(400, 495)).toEqual({ part: 'head', side: 'center' }) // 首元(頭の範囲の下端)
    expect(at(400, 540)).toEqual({ part: 'chest', side: 'center' })
    expect(at(400, 620)).toEqual({ part: 'chest', side: 'center' }) // みぞおち
    expect(at(400, 690)).toEqual({ part: 'belly', side: 'center' })
    expect(at(400, 740)).toEqual({ part: 'hips', side: 'center' }) // スカートの上(実機で「左脚」と誤判定された位置)
  })
  it('区切りの割合が、上から順に並び、最後は1(足元)で、すべての部位(腕・手を除く)を含む', () => {
    const tos = BODY_BANDS.map((b) => b.to)
    expect([...tos].sort((a, b) => a - b)).toEqual(tos)
    expect(tos[tos.length - 1]).toBe(1)
    expect(new Set(BODY_BANDS.map((b) => b.part))).toEqual(new Set(['head', 'chest', 'belly', 'hips', 'leg', 'foot']))
  })
})

describe('classifyTouch: 脚・足(体の中心で、左右を決める)', () => {
  it('キャラの左 = 画面の右。脚・足の左右を区別する(実機で「右腕」と誤判定された位置)', () => {
    expect(at(440, 900)).toEqual({ part: 'leg', side: 'left' })
    expect(at(375, 900)).toEqual({ part: 'leg', side: 'right' })
    expect(at(430, 1160)).toEqual({ part: 'foot', side: 'left' })
    expect(at(372, 1160)).toEqual({ part: 'foot', side: 'right' })
  })
  it('後ろ向き(左の脚が画面の左)でも、脚の骨を基準に、キャラ自身の左右になる', () => {
    const back = { ...arms, leftUpperLeg: { x: 370, y: 780 }, rightUpperLeg: { x: 430, y: 780 } }
    const atBack = (x: number, y: number) => classifyTouch({ x, y }, back, box)
    expect(atBack(375, 900)).toEqual({ part: 'leg', side: 'left' })
    expect(atBack(440, 900)).toEqual({ part: 'leg', side: 'right' })
    // 正面向きの骨の位置なら、従来と同じ
    const front = { ...arms, leftUpperLeg: { x: 430, y: 780 }, rightUpperLeg: { x: 370, y: 780 } }
    expect(classifyTouch({ x: 440, y: 900 }, front, box)).toEqual({ part: 'leg', side: 'left' })
  })
})

describe('classifyTouch: 腕・手(骨の線分)', () => {
  it('腕は左右を区別する(袖の部分)', () => {
    expect(at(485, 600)).toEqual({ part: 'arm', side: 'left' })
    expect(at(315, 600)).toEqual({ part: 'arm', side: 'right' })
  })
  it('手首〜指先は「手」。実機で「腕」と判定された手の位置が、手になる', () => {
    expect(at(510, 725)).toEqual({ part: 'hand', side: 'left' })
    expect(at(292, 725)).toEqual({ part: 'hand', side: 'right' })
  })
  it('腕が体に重なる位置でも、腕の骨の近くなら腕・手が優先される', () => {
    expect(at(445, 540)?.part).toBe('arm') // 肩〜肘の途中は、胴体(胸)の範囲でも、腕
  })
  it('腕を上げたポーズ(万歳)でも、腕・手の骨に従って判定できる', () => {
    const up: Record<string, Point2> = {
      ...arms,
      leftUpperArm: { x: 437, y: 510 }, leftLowerArm: { x: 480, y: 400 }, leftHand: { x: 520, y: 300 }
    }
    expect(classifyTouch({ x: 515, y: 310 }, up, box)).toEqual({ part: 'hand', side: 'left' })
    expect(classifyTouch({ x: 465, y: 440 }, up, box)).toEqual({ part: 'arm', side: 'left' })
  })
})

describe('classifyTouch: 体の外・例外', () => {
  it('体から遠い場所は null(身体の幅の外・足元より下・頭より上)', () => {
    expect(at(700, 450)).toBeNull() // 体の横(腕の骨からも遠い)
    expect(at(400, 1300)).toBeNull()
    expect(at(400, 200)).toBeNull()
  })
  it('腕の骨が無いモデルでも落ちず、頭・胴・脚は判定できる', () => {
    expect(classifyTouch({ x: 400, y: 440 }, {}, box)).toEqual({ part: 'head', side: 'center' })
    expect(classifyTouch({ x: 400, y: 900 }, {}, box)?.part).toBe('leg')
  })
  it('身体の範囲が不正(高さ0・上下逆)なら null', () => {
    expect(classifyTouch({ x: 1, y: 1 }, arms, { top: 100, bottom: 100, centerX: 0 })).toBeNull()
    expect(classifyTouch({ x: 1, y: 1 }, arms, { top: 500, bottom: 100, centerX: 0 })).toBeNull()
  })
  it('画面上の大きさ(拡大縮小・位置)に依存しない: 半分に縮小しても、ずらしても、同じ部位になる', () => {
    const scale = (p: Point2, k: number, ox: number, oy: number): Point2 => ({ x: p.x * k + ox, y: p.y * k + oy })
    const k = 0.5
    const [ox, oy] = [37, 12]
    const small: Record<string, Point2> = Object.fromEntries(Object.entries(arms).map(([n, p]) => [n, scale(p, k, ox, oy)]))
    const smallBox = { top: box.top * k + oy, bottom: box.bottom * k + oy, centerX: box.centerX * k + ox }
    for (const [x, y] of [[400, 345], [400, 540], [400, 690], [400, 740], [440, 900], [372, 1160], [485, 600], [510, 725]]) {
      expect(classifyTouch(scale({ x, y }, k, ox, oy), small, smallBox)).toEqual(at(x, y))
    }
  })
  it('部位の一覧は、ルールの選択肢(日本語ラベルつき)として、8つある', () => {
    expect(TOUCH_PARTS.map((p) => p.value)).toEqual(['head', 'chest', 'belly', 'hips', 'arm', 'hand', 'leg', 'foot'])
    for (const p of TOUCH_PARTS) expect(p.label).not.toBe('')
  })
})
