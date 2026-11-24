import { describe, expect, it } from 'vitest'
import { BONE_NAMES, eulerToQuat } from './builder'
import { BUILTIN_MOTION_NAMES, generateBuiltinMotions } from './builtin'

interface GltfJson {
  extensionsUsed: string[]
  extensions: { VRMC_vrm_animation: { specVersion: string; humanoid: { humanBones: Record<string, { node: number }> } } }
  nodes: Array<{ name: string }>
  animations: Array<{
    samplers: Array<{ input: number; output: number }>
    channels: Array<{ sampler: number; target: { node: number; path: string } }>
  }>
  accessors: Array<{ bufferView: number; count: number; type: string; min?: number[]; max?: number[] }>
  bufferViews: Array<{ byteOffset: number; byteLength: number }>
}

/** GLB を解析して JSON チャンクと BIN の長さを返す */
function parseGlb(data: Uint8Array): { json: GltfJson; binLength: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  expect(new TextDecoder().decode(data.slice(0, 4))).toBe('glTF')
  expect(view.getUint32(4, true)).toBe(2)
  expect(view.getUint32(8, true)).toBe(data.length) // 全体長が実サイズと一致
  const jsonLen = view.getUint32(12, true)
  expect(new TextDecoder().decode(data.slice(16, 20))).toBe('JSON')
  const json = JSON.parse(new TextDecoder().decode(data.slice(20, 20 + jsonLen)))
  const binHead = 20 + jsonLen
  const binLength = view.getUint32(binHead, true)
  expect(new TextDecoder().decode(data.slice(binHead + 4, binHead + 7))).toBe('BIN')
  expect(binHead + 8 + binLength).toBe(data.length)
  expect(jsonLen % 4).toBe(0)
  expect(binLength % 4).toBe(0)
  return { json, binLength }
}

describe('内蔵モーション', () => {
  const motions = generateBuiltinMotions()

  it('名前が重複せず、idle / talk を含む', () => {
    expect(new Set(BUILTIN_MOTION_NAMES).size).toBe(BUILTIN_MOTION_NAMES.length)
    expect(BUILTIN_MOTION_NAMES).toEqual(expect.arrayContaining(['idle', 'wave', 'talk', 'nod', 'dance1', 'dance2', 'dance3']))
  })

  for (const m of motions) {
    describe(m.name, () => {
      const { json, binLength } = parseGlb(m.data)

      it('VRMA拡張・humanoid・アニメーションを持つ', () => {
        expect(json.extensionsUsed).toContain('VRMC_vrm_animation')
        expect(json.extensions.VRMC_vrm_animation.specVersion).toBe('1.0')
        expect(Object.keys(json.extensions.VRMC_vrm_animation.humanoid.humanBones).sort()).toEqual([...BONE_NAMES].sort())
        expect(json.animations).toHaveLength(1)
      })

      it('全チャンネルが存在するノードを指し、humanBones に登録されている', () => {
        const humanNodes = new Set(Object.values(json.extensions.VRMC_vrm_animation.humanoid.humanBones).map((b) => b.node))
        for (const ch of json.animations[0].channels) {
          expect(json.nodes[ch.target.node]).toBeDefined()
          expect(humanNodes.has(ch.target.node)).toBe(true)
          // 移動トラックは hips だけ(VRMA仕様)
          if (ch.target.path === 'translation') expect(json.nodes[ch.target.node].name).toBe('hips')
        }
      })

      it('サンプラーの入出力の要素数が揃い、accessorがBINに収まる', () => {
        for (const s of json.animations[0].samplers) {
          expect(json.accessors[s.output].count).toBe(json.accessors[s.input].count)
        }
        for (const a of json.accessors) {
          const view = json.bufferViews[a.bufferView]
          const comps = ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]
          expect(view.byteLength).toBe(a.count * comps * 4)
          expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(binLength)
        }
      })

      it('時刻が単調増加で、回転は単位クォータニオン', () => {
        const input = json.accessors[json.animations[0].samplers[0].input]
        expect(input.min![0]).toBe(0)
        expect(input.max![0]).toBeGreaterThan(0.5)
      })
    })
  }

  it('ループさせる idle / talk は最初と最後の姿勢が一致する(継ぎ目が出ない)', async () => {
    const { BUILTIN_MOTION_DEFS } = await import('./builtin')
    for (const name of ['idle', 'talk']) {
      const def = BUILTIN_MOTION_DEFS.find((d) => d.name === name)!
      const a = def.pose(0, def.durationSec).rot
      const b = def.pose(def.durationSec, def.durationSec).rot
      for (const bone of Object.keys(a)) {
        a[bone].forEach((v, i) => expect(b[bone][i]).toBeCloseTo(v, 6))
      }
    }
  })
})

describe('eulerToQuat', () => {
  it('単位クォータニオンになる', () => {
    const q = eulerToQuat([0.3, -0.5, 1.2])
    expect(Math.hypot(...q)).toBeCloseTo(1, 6)
    expect(eulerToQuat([0, 0, 0])).toEqual([0, 0, 0, 1])
  })
})
