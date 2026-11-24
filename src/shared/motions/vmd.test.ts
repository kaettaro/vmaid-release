import { describe, expect, it } from 'vitest'
import { MORPH_TO_VRM } from '../mmd/morphToVrm'
import { MMD_IKS, MMD_SKELETON, MMD_TO_VRM, VRM_PARENT } from './mmdSkeleton'
import { buildVmd } from './vmdFixture'
import { looksLikeVmd, parseVmd, vmdKind, type Vmd } from './vmdParse'
import { bezier, solveVmd } from './vmdSolve'
import { convertVmdToVrma, mergeVmds } from './vmdToVrma'

const parse = (bytes: Uint8Array): Vmd => {
  const r = parseVmd(bytes)
  if (!r.ok) throw new Error(r.reason)
  return r.vmd
}

/** VRMA(glTF Binary)の JSON 部分 */
function gltfJson(glb: Uint8Array): { nodes: Array<{ name: string }>; animations: Array<{ channels: unknown[] }>; extensions: { VRMC_vrm_animation: { humanoid: { humanBones: Record<string, { node: number }> }; expressions?: { preset: Record<string, { node: number }> } } } } {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  const len = view.getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)))
}

describe('VMD の読み込み', () => {
  it('ボーン・モーフ・IK の ON/OFF を読む。名前は Shift-JIS', () => {
    const bytes = buildVmd({
      model: 'モデル',
      bones: [
        { name: 'センター', frame: 10, position: [1, 2, 3] },
        { name: 'センター', frame: 0 },
        { name: '左足ＩＫ', frame: 0 }
      ],
      morphs: [{ name: 'まばたき', frame: 5, weight: 0.5 }],
      ikStates: [{ frame: 0, states: { 左足ＩＫ: false } }]
    })
    const v = parse(bytes)
    expect([...v.bones.keys()]).toEqual(['センター', '左足ＩＫ'])
    expect(v.bones.get('センター')!.map((k) => k.frame)).toEqual([0, 10]) // 時間順
    expect(v.bones.get('センター')![1].position).toEqual([1, 2, 3])
    expect(v.morphs.get('まばたき')).toEqual([{ frame: 5, weight: 0.5 }])
    expect(v.ikStates).toEqual([{ frame: 0, states: { 左足ＩＫ: false } }])
    expect(v.lastFrame).toBe(10)
  })

  it('壊れたファイルは、理由つきで断る(ヘッダ違い・途中で切れている・件数が大きすぎる)', () => {
    expect(looksLikeVmd(new Uint8Array(100))).toBe(false)
    expect(parseVmd(new Uint8Array(100)).ok).toBe(false)
    const good = buildVmd({ bones: [{ name: 'センター', frame: 0 }] })
    const cut = parseVmd(good.subarray(0, 100)) // ボーンの途中で切れている
    expect(cut.ok).toBe(false)
    const huge = new Uint8Array(good)
    new DataView(huge.buffer).setUint32(50, 0xffffffff, true)
    expect(parseVmd(huge).ok).toBe(false)
  })

  it('中身の種類: 体 / 表情 / 両方 / 空', () => {
    expect(vmdKind(parse(buildVmd({ bones: [{ name: 'センター', frame: 0 }] })))).toBe('body')
    expect(vmdKind(parse(buildVmd({ morphs: [{ name: 'あ', frame: 0, weight: 1 }] })))).toBe('face')
    expect(vmdKind(parse(buildVmd({ bones: [{ name: 'センター', frame: 0 }], morphs: [{ name: 'あ', frame: 0, weight: 1 }] })))).toBe('both')
    expect(vmdKind(parse(buildVmd({})))).toBe('empty')
  })

  it('フィクスチャの Shift-JIS の名前が、正しく読み戻せる(表の誤りを防ぐ)', () => {
    const names = ['センター', '上半身', '下半身', '左腕', '左ひじ', '左足', '左ひざ', '左足首', '左足ＩＫ', 'まばたき', 'あ', '笑い', '謎のモーフ']
    const v = parse(buildVmd({ bones: names.map((name, i) => ({ name, frame: i })) }))
    expect([...v.bones.keys()]).toEqual(names)
  })
})

describe('補間とサンプリング', () => {
  it('ベジェ曲線: 直線は、そのまま。端は 0 と 1。ゆっくり始まる曲線は、中間が小さい', () => {
    const lin = { x1: 20 / 127, y1: 20 / 127, x2: 107 / 127, y2: 107 / 127 }
    expect(bezier(lin, 0.5)).toBeCloseTo(0.5, 2)
    const easeIn = { x1: 0.8, y1: 0, x2: 1, y2: 0.2 }
    expect(bezier(easeIn, 0)).toBe(0)
    expect(bezier(easeIn, 1)).toBe(1)
    expect(bezier(easeIn, 0.5)).toBeLessThan(0.3)
  })

  it('センターの位置は、キーの間を直線で補間する(右手系: z の符号が反転)', () => {
    const v = parse(
      buildVmd({
        bones: [
          { name: 'センター', frame: 0, position: [0, 0, 0] },
          { name: 'センター', frame: 10, position: [2, 4, 6] }
        ]
      })
    )
    const s = solveVmd(v)
    const y = (f: number): number => s.hipsPos[f * 3 + 1]
    const base = y(0)
    expect(y(5) - base).toBeCloseTo(2, 0) // 4 の半分(補間の曲線の近似で、誤差を許す)
    expect(s.hipsPos[10 * 3] - s.hipsPos[0]).toBeCloseTo(2, 5)
    expect(s.hipsPos[10 * 3 + 2] - s.hipsPos[2]).toBeCloseTo(-6, 5)
  })
})

describe('足 IK', () => {
  const ikBone = '左足ＩＫ'

  it('キーが何も無い(基準姿勢)なら、全身が基準姿勢のまま(単位回転)', () => {
    const s = solveVmd(parse(buildVmd({ bones: [{ name: 'センター', frame: 0 }] })))
    for (const [name, b] of s.bones) {
      const w = b.worldRot
      expect(Math.abs(w[3]), name).toBeGreaterThan(0.99)
    }
  })

  it('センターを下げても、足首は、IK の目標に届く。ひざは、後ろへ曲がる範囲だけ', () => {
    const v = parse(
      buildVmd({
        bones: [
          { name: 'センター', frame: 0, position: [0, 0, 0] },
          { name: 'センター', frame: 10, position: [0, -2.5, 0] },
          { name: ikBone, frame: 0 }
        ]
      })
    )
    const seen: Array<{ frame: number; dist: number; kx: number }> = []
    const s = solveVmd(v, (i) => {
      if (i.ik === ikBone) seen.push({ frame: i.frame, dist: i.dist, kx: i.link0X })
    })
    expect(s.report.ikMisses).toBe(0)
    for (const r of seen) {
      expect(r.dist).toBeLessThan(0.05)
      expect(r.kx).toBeGreaterThanOrEqual(0.0087 - 1e-6) // 右手系の範囲(MMD の符号の反転)
      expect(r.kx).toBeLessThanOrEqual(Math.PI + 1e-6)
    }
    // 下げるほど、ひざは曲がる
    expect(seen[10].kx).toBeGreaterThan(seen[0].kx + 0.2)
  })

  it('届かない(遠すぎる)ときは、足を伸ばしきって、届かなかった数に数える', () => {
    const v = parse(
      buildVmd({
        bones: [
          { name: 'センター', frame: 0, position: [0, 3, 0] },
          { name: ikBone, frame: 0 }
        ]
      })
    )
    expect(solveVmd(v).report.ikMisses).toBe(2) // 左右の足
  })

  it('IK を OFF にしたフレームは、解かない(足の FK のキーのまま)', () => {
    const v = parse(
      buildVmd({
        bones: [
          { name: 'センター', frame: 0, position: [0, 0, 0] },
          { name: 'センター', frame: 10, position: [0, -2.5, 0] },
          { name: ikBone, frame: 0 }
        ],
        ikStates: [{ frame: 0, states: { [ikBone]: false } }]
      })
    )
    const s = solveVmd(v)
    expect(s.report.ikWasOff).toBe(true)
    expect(s.report.ikMisses).toBe(0)
  })
})

describe('VRMA への変換', () => {
  const body = buildVmd({
    bones: [
      { name: 'センター', frame: 0 },
      { name: 'センター', frame: 30, position: [0, -1, 0] },
      { name: '上半身', frame: 30, rotation: [0.1, 0, 0, Math.sqrt(1 - 0.01)] },
      { name: '左足ＩＫ', frame: 0 }
    ]
  })
  const face = buildVmd({
    morphs: [
      { name: 'まばたき', frame: 0, weight: 0 },
      { name: 'まばたき', frame: 30, weight: 1 },
      { name: 'あ', frame: 10, weight: 0.5 },
      { name: '笑い', frame: 0, weight: 0.25 },
      { name: '謎のモーフ', frame: 5, weight: 1 }
    ]
  })

  it('体と表情を合わせて、1 つの VRMA にする。使うボーン・表情・警告が報告に出る', () => {
    const r = convertVmdToVrma([parse(body), parse(face)], 'dance')
    if (!r.ok) throw new Error(r.reason)
    const j = gltfJson(r.vrma)
    const humanBones = j.extensions.VRMC_vrm_animation.humanoid.humanBones
    for (const need of ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperLeg', 'leftToes']) expect(humanBones[need], need).toBeDefined()
    const presets = j.extensions.VRMC_vrm_animation.expressions?.preset ?? {}
    expect(Object.keys(presets).sort()).toEqual(['aa', 'blink', 'happy'])
    expect(r.report.expressions.sort()).toEqual(['aa', 'blink', 'happy'])
    expect(r.report.unmappedMorphs).toEqual(['謎のモーフ'])
    expect(r.report.warnings.join('\n')).toContain('謎のモーフ')
    expect(r.report.frames).toBe(61) // 30 フレーム(1 秒)を、60fps で解く(2 分割)
    expect(r.report.durationSec).toBeCloseTo(1, 5)
  })

  it('表情だけの VMD でも、変換できる(体は基準姿勢)。体も表情も無ければ、断る', () => {
    const r = convertVmdToVrma([parse(face)], 'face')
    expect(r.ok).toBe(true)
    expect(convertVmdToVrma([parse(buildVmd({}))], 'x').ok).toBe(false)
    expect(convertVmdToVrma([], 'x').ok).toBe(false)
  })

  it('A ポーズの基準の腕は、T ポーズの VRM に合わせて、腕を下ろした姿勢になる(キーが無くても)', () => {
    const r = convertVmdToVrma([parse(buildVmd({ bones: [{ name: 'センター', frame: 0 }] }))], 'rest')
    if (!r.ok) throw new Error(r.reason)
    // 左上腕の最初のフレームの回転: Z 軸まわりに、約 −45°(腕が下がる)
    const view = new DataView(r.vrma.buffer, r.vrma.byteOffset, r.vrma.byteLength)
    const jsonLen = view.getUint32(12, true)
    const j = gltfJson(r.vrma) as unknown as { animations: Array<{ channels: Array<{ sampler: number; target: { node: number; path: string } }>; samplers: Array<{ output: number }> }>; accessors: Array<{ bufferView: number }>; bufferViews: Array<{ byteOffset: number }>; extensions: { VRMC_vrm_animation: { humanoid: { humanBones: Record<string, { node: number }> } } } }
    const node = j.extensions.VRMC_vrm_animation.humanoid.humanBones.leftUpperArm.node
    const ch = j.animations[0].channels.find((c) => c.target.node === node && c.target.path === 'rotation')!
    const acc = j.accessors[j.animations[0].samplers[ch.sampler].output]
    const binStart = 20 + jsonLen + 8
    const off = binStart + j.bufferViews[acc.bufferView].byteOffset
    const q = [0, 1, 2, 3].map((i) => view.getFloat32(off + i * 4, true))
    const angleZ = 2 * Math.atan2(q[2], q[3]) * (180 / Math.PI)
    expect(angleZ).toBeLessThan(-30)
    expect(angleZ).toBeGreaterThan(-60)
    expect(Math.abs(q[0])).toBeLessThan(0.1)
  })

  it('同じ骨・モーフのキーは、まとめるときに時間順に並ぶ', () => {
    const m = mergeVmds([parse(buildVmd({ morphs: [{ name: 'あ', frame: 20, weight: 1 }] })), parse(buildVmd({ morphs: [{ name: 'あ', frame: 5, weight: 0 }] }))])
    expect(m.morphs.get('あ')!.map((k) => k.frame)).toEqual([5, 20])
    expect(m.lastFrame).toBe(20)
  })
})

describe('テンプレートと対応表の整合', () => {
  const names = new Set(MMD_SKELETON.map((r) => r[0]))

  it('骨の親は、前に並んでいる。IK の骨・先端・リンクは、すべて骨格にある', () => {
    const seen = new Set<string>()
    for (const [name, parent] of MMD_SKELETON) {
      if (parent !== null) expect(seen.has(parent), `${name} の親 ${parent}`).toBe(true)
      seen.add(name)
    }
    for (const ik of MMD_IKS) {
      expect(names.has(ik.bone)).toBe(true)
      expect(names.has(ik.target)).toBe(true)
      for (const l of ik.links) expect(names.has(l.bone)).toBe(true)
    }
  })

  it('VRM の対応: 対応する MMD の骨がすべてあり、VRM の親が先に並ぶ', () => {
    const seen = new Set<string>()
    for (const [vrm, mmd] of MMD_TO_VRM) {
      expect(names.has(mmd), mmd).toBe(true)
      const parent = VRM_PARENT[vrm]
      if (parent) expect(seen.has(parent), `${vrm} の親 ${parent}`).toBe(true)
      seen.add(vrm)
    }
  })

  it('モーフの対応先は、VRM の表情プリセット名', () => {
    const presets = new Set(['happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'blinkLeft', 'blinkRight'])
    for (const v of Object.values(MORPH_TO_VRM)) expect(presets.has(v), v).toBe(true)
  })
})

describe('細かく解く(subdiv)', () => {
  const lin = { x1: 20 / 127, y1: 20 / 127, x2: 107 / 127, y2: 107 / 127 }
  const ease = { x1: 100 / 127, y1: 0, x2: 30 / 127, y2: 1 } // 始めと終わりがゆるやか
  const vmd = (curve: typeof lin): Vmd => ({
    modelName: '',
    bones: new Map([['上半身', [
      { frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], curves: { x: lin, y: lin, z: lin, rot: lin } },
      { frame: 10, position: [0, 0, 0], rotation: [0, Math.sin(0.5), 0, Math.cos(0.5)], curves: { x: lin, y: lin, z: lin, rot: curve } }
    ]]]),
    morphs: new Map(),
    ikStates: [],
    lastFrame: 10
  })
  const angleAt = (c: ReturnType<typeof solveVmd>, i: number): number => {
    const a = c.bones.get('上半身')!.worldRot
    return 2 * Math.atan2(Math.abs(a[i * 4 + 1]!), a[i * 4 + 3]!)
  }

  it('2 分割なら、サンプルが (最後のフレーム × 2) + 1 になり、キーの間のフレームにも、補間曲線の値が入る', () => {
    const one = solveVmd(vmd(ease))
    const two = solveVmd(vmd(ease), undefined, 2)
    expect(one.frames).toBe(11)
    expect(two.frames).toBe(21)
    // 偶数番目のサンプルは、1 分割のフレームと一致する
    for (let f = 0; f <= 10; f++) expect(angleAt(two, f * 2)).toBeCloseTo(angleAt(one, f), 5)
    // 半フレームのサンプルは、前後の間(ゆるやかな曲線の始め: 直線より小さい)
    expect(angleAt(two, 1)).toBeGreaterThan(angleAt(one, 0))
    expect(angleAt(two, 1)).toBeLessThan(angleAt(one, 1))
  })
})
