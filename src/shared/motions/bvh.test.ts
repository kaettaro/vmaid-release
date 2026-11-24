import { describe, expect, it } from 'vitest'
import { MAX_BVH_FRAMES, MAX_BVH_JOINTS, parseBvh } from './bvh'
import { channelCount, humanoidJoints, randomFrames, toBvhText } from './bvhTestUtil'

const simple = `HIERARCHY
ROOT hips
{
  OFFSET 0 1 0
  CHANNELS 6 Xposition Yposition Zposition Yrotation Xrotation Zrotation
  JOINT spine
  {
    OFFSET 0 0.1 0
    CHANNELS 3 Zrotation Xrotation Yrotation
    End Site
    {
      OFFSET 0 0.1 0
    }
  }
}
MOTION
Frames: 2
Frame Time: 0.0333333
0 1 0 10 20 30 1 2 3
0 1.1 0 0 0 0 4 5 6
`

describe('parseBvh', () => {
  it('階層・チャンネルの並び・フレームを読む', () => {
    const r = parseBvh(simple)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { bvh } = r
    expect(bvh.joints.map((j) => [j.name, j.parent])).toEqual([['hips', -1], ['spine', 0]])
    expect(bvh.joints[0].offset).toEqual([0, 1, 0])
    expect(bvh.joints[0].channels).toEqual(['Xposition', 'Yposition', 'Zposition', 'Yrotation', 'Xrotation', 'Zrotation'])
    expect(bvh.joints[1].channelStart).toBe(6)
    expect(bvh.stride).toBe(9)
    expect(bvh.frames).toBe(2)
    expect(bvh.frameTime).toBeCloseTo(0.0333333)
    expect(Array.from(bvh.data.slice(0, 9))).toEqual([0, 1, 0, 10, 20, 30, 1, 2, 3])
    expect(bvh.data[10]).toBeCloseTo(1.1)
  })

  it('CRLF・タブ・複数の空白・小文字のキーワードでも読める', () => {
    const text = simple.replace(/\n/g, '\r\n').replace(/ {2}/g, '\t').replace('Frame Time:', 'frame time :')
    expect(parseBvh(text).ok).toBe(true)
  })

  it('合成した人型 BVH を読める(関節数・チャンネル数が合う)', () => {
    const joints = humanoidJoints('T')
    const text = toBvhText(joints, randomFrames(joints, 5, 1), 1 / 30)
    const r = parseBvh(text)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bvh.joints).toHaveLength(joints.length)
      expect(r.bvh.stride).toBe(channelCount(joints))
    }
  })

  it.each([
    ['MOTION が無い', simple.slice(0, simple.indexOf('MOTION'))],
    ['HIERARCHY で始まらない', simple.replace('HIERARCHY', 'HIERARCHI')],
    ['波括弧が閉じていない', simple.replace('  }\n}\nMOTION', '  }\nMOTION')],
    ['未対応のチャンネル', simple.replace('Xposition', 'Wposition')],
    ['OFFSET が数値でない', simple.replace('OFFSET 0 1 0', 'OFFSET 0 a 0')],
    ['Frames が不正', simple.replace('Frames: 2', 'Frames: x')],
    ['Frame Time が 0', simple.replace('0.0333333', '0')],
    ['データが足りない', simple.replace('0 1.1 0 0 0 0 4 5 6\n', '0 1.1 0\n')],
    ['数値が不正', simple.replace('4 5 6', '4 five 6')],
    ['ROOT が複数', simple.replace('MOTION', 'ROOT b\n{\nOFFSET 0 0 0\nCHANNELS 0\n}\nMOTION')]
  ])('壊れた入力を理由つきで断る: %s', (_name, text) => {
    const r = parseBvh(text)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
  })

  it('関節が多すぎる・フレームが多すぎる入力は断る', () => {
    let many = 'HIERARCHY\nROOT r\n{\nOFFSET 0 0 0\nCHANNELS 3 Xrotation Yrotation Zrotation\n'
    for (let i = 0; i < MAX_BVH_JOINTS + 1; i++) many += `JOINT j${i}\n{\nOFFSET 0 0 0\nCHANNELS 3 Xrotation Yrotation Zrotation\n}\n`
    many += '}\nMOTION\nFrames: 1\nFrame Time: 0.03\n0 0 0\n'
    expect(parseBvh(many).ok).toBe(false)
    expect(parseBvh(simple.replace('Frames: 2', `Frames: ${MAX_BVH_FRAMES + 1}`)).ok).toBe(false)
  })

  it('深くネストした入力でも落ちない(再帰を使わない)', () => {
    const depth = 3000
    let h = 'HIERARCHY\nROOT r\n{\nOFFSET 0 0 0\nCHANNELS 3 Xrotation Yrotation Zrotation\n'
    for (let i = 0; i < depth; i++) h += 'JOINT a\n{\n'
    const r = parseBvh(h + '\nMOTION\nFrames: 1\nFrame Time: 0.03\n0 0 0\n')
    expect(r.ok).toBe(false) // 閉じていない or 関節が多すぎる。例外で落ちないこと
  })
})
