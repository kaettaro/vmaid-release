import { describe, expect, it } from 'vitest'
import { checkVrmaBytes } from '../motionLibrary'
import { BVH_CONVERTER_VERSION, convertBvhToVrma } from './bvhToVrma'
import { humanoidJoints, randomFrames, toBvhText } from './bvhTestUtil'

/** GLB の JSON チャンクを取り出す */
interface Gltf {
  extensionsUsed: string[]
  extensions: { VRMC_vrm_animation: { humanoid: { humanBones: Record<string, unknown> } } }
  nodes: Array<{ name: string; translation: number[] }>
  animations: Array<{ name: string; channels: Array<{ target: { node: number; path: string } }> }>
  accessors: Array<{ count: number }>
  buffers: Array<{ byteLength: number }>
}

function glbJson(b: Uint8Array): { json: Gltf; bin: Uint8Array } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const len = dv.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(b.slice(20, 20 + len)))
  const binLen = dv.getUint32(20 + len, true)
  return { json, bin: b.slice(28 + len, 28 + len + binLen) }
}

describe('convertBvhToVrma', () => {
  const joints = humanoidJoints('A', 10)
  const text = toBvhText(joints, randomFrames(joints, 20, 9), 1 / 30)

  it('VRMA(glTF Binary)を作る。ヒューマノイドの対応・回転トラック・hips の移動が入る', () => {
    const r = convertBvhToVrma(text, 'test')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(checkVrmaBytes(r.vrma)).toEqual({ ok: true })
    const { json, bin } = glbJson(r.vrma)
    expect(json.extensionsUsed).toContain('VRMC_vrm_animation')
    const human = json.extensions.VRMC_vrm_animation.humanoid.humanBones
    expect(Object.keys(human)).toContain('hips')
    expect(Object.keys(human)).toContain('leftHand')
    expect(json.animations[0].name).toBe('test')
    const targets = json.animations[0].channels.map((c) => `${json.nodes[c.target.node].name}.${c.target.path}`)
    expect(targets).toContain('hips.translation')
    expect(targets).toContain('leftUpperArm.rotation')
    // 各トラックの要素数が、時刻の数と合う
    const timeCount = json.accessors[0].count
    expect(timeCount).toBe(20)
    for (const a of json.accessors.slice(1)) expect(a.count).toBe(timeCount)
    expect(bin.length).toBe(json.buffers[0].byteLength)
    // 腰の基準位置がメートル(単位 10 → 1.0m)になっている
    const hips = json.nodes.find((n) => n.name === 'hips')
    expect(hips?.translation[1]).toBeCloseTo(1, 4)
    expect(r.report.unitScale).toBeCloseTo(0.1)
  })

  it('同じ入力なら同じバイト列(キャッシュが安定する)', () => {
    const a = convertBvhToVrma(text, 'x')
    const b = convertBvhToVrma(text, 'x')
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(Buffer.from(a.vrma).equals(Buffer.from(b.vrma))).toBe(true)
  })

  it('BVH でないテキストは理由つきで断る', () => {
    const r = convertBvhToVrma('これは BVH ではありません', 'x')
    expect(r.ok).toBe(false)
  })

  it('変換版の番号は正の整数', () => {
    expect(Number.isInteger(BVH_CONVERTER_VERSION)).toBe(true)
    expect(BVH_CONVERTER_VERSION).toBeGreaterThan(0)
  })
})
