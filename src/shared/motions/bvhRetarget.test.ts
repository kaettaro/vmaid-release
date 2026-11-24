import { describe, expect, it } from 'vitest'
import { parseBvh } from './bvh'
import { guessUnitScale, resolveBoneName, retargetBvh } from './bvhRetarget'
import { bvhForwardKinematics, humanoidJoints, randomFrames, toBvhText, tracksForwardKinematics, type SynthJoint } from './bvhTestUtil'

function load(arms: 'T' | 'A', unit: number, frames = 12, seed = 7, frameTime = 1 / 30) {
  const joints = humanoidJoints(arms, unit)
  const p = parseBvh(toBvhText(joints, randomFrames(joints, frames, seed), frameTime))
  if (!p.ok) throw new Error(p.reason)
  return p.bvh
}

describe('resolveBoneName', () => {
  it('VRM の名前はそのまま(大文字小文字は問わない)', () => {
    expect(resolveBoneName('leftUpperLeg')).toBe('leftUpperLeg')
    expect(resolveBoneName('LeftUpperLeg')).toBe('leftUpperLeg')
    expect(resolveBoneName('hips')).toBe('hips')
    expect(resolveBoneName('rightIndexProximal')).toBe('rightIndexProximal')
  })
  it('Mixamo 系の名前を VRM の名前に直す', () => {
    expect(resolveBoneName('mixamorig:Hips')).toBe('hips')
    expect(resolveBoneName('mixamorig:Spine1')).toBe('chest')
    expect(resolveBoneName('mixamorig:Spine2')).toBe('upperChest')
    expect(resolveBoneName('mixamorig:LeftArm')).toBe('leftUpperArm')
    expect(resolveBoneName('mixamorig:LeftForeArm')).toBe('leftLowerArm')
    expect(resolveBoneName('mixamorig:RightUpLeg')).toBe('rightUpperLeg')
    expect(resolveBoneName('mixamorig:LeftToeBase')).toBe('leftToes')
    expect(resolveBoneName('mixamorig:LeftHandThumb1')).toBe('leftThumbMetacarpal')
    expect(resolveBoneName('mixamorig:RightHandPinky3')).toBe('rightLittleDistal')
    expect(resolveBoneName('mixamorig:LeftHandIndex4')).toBeNull() // 先端は VRM に無い
  })
  it('VRM 0.x 流の親指(Proximal / Intermediate / Distal)は、VRM 1.0 の並びに直す', () => {
    const names = new Set(['leftthumbproximal', 'leftthumbintermediate', 'leftthumbdistal'])
    expect(resolveBoneName('leftThumbProximal', names)).toBe('leftThumbMetacarpal')
    expect(resolveBoneName('leftThumbIntermediate', names)).toBe('leftThumbProximal')
    expect(resolveBoneName('leftThumbDistal', names)).toBe('leftThumbDistal')
    // Intermediate が無い(VRM 1.0 流)ときは、そのまま
    expect(resolveBoneName('leftThumbProximal', new Set(['leftthumbproximal', 'leftthumbdistal']))).toBe('leftThumbProximal')
  })
  it('対応できない名前は null', () => {
    expect(resolveBoneName('Armature')).toBeNull()
    expect(resolveBoneName('tail1')).toBeNull()
  })
})

describe('guessUnitScale', () => {
  it('腰の高さから単位を推定する', () => {
    expect(guessUnitScale(1.0)).toBe(1) // m
    expect(guessUnitScale(10.686)).toBe(0.1) // dm 相当(Spicy-VRM-Animations の BVH)
    expect(guessUnitScale(95)).toBe(0.01) // cm
    expect(guessUnitScale(0)).toBe(1)
  })
})

/** chillf.bvh と同じ構造の合成クリップ: 先頭1フレームが立ち姿、残りは「床の約1m下で横たわった」静止ポーズ(腰: 位置 -1m、Z 回転 -98°) */
function lyingClip(frames = 20, bounce = 0, leading = 1) {
  const joints: SynthJoint[] = humanoidJoints('T', 1)
  const n = joints.reduce((s, j) => s + (j.channels?.length ?? 3), 0)
  const standing = Array.from({ length: n }, () => 0)
  standing[1] = 1 // hips の Y = 1m(立ち姿)
  const rows = [standing]
  // 先頭の過渡フレーム(立ち姿 → 本来のポーズへ、数フレームで飛ぶ)。leading=1 なら、立ち姿の1フレームだけ
  for (let f = 1; f < leading; f++) {
    const t = f / leading
    const row = Array.from({ length: n }, () => 0)
    row[1] = 1 - 2.02 * t
    row[5] = -98.7 * t
    rows.push(row)
  }
  for (let f = leading; f < frames; f++) {
    const row = Array.from({ length: n }, () => 0)
    // hips: X Y Z Yrot Xrot Zrot
    row[0] = -0.27
    row[1] = -1.02 + bounce * Math.sin(f)
    row[2] = -0.25
    row[4] = -34
    row[5] = -98.7
    rows.push(row)
  }
  const p = parseBvh(toBvhText(joints, rows, 1 / 30))
  if (!p.ok) throw new Error(p.reason)
  return p.bvh
}

describe('retargetBvh: 腰の水平位置', () => {
  /** 腰を x, z の位置(m)に置いたまま、少し横に動くクリップ */
  function offsetClip(x0: number, z0: number) {
    const joints: SynthJoint[] = humanoidJoints('T', 1)
    const n = joints.reduce((s, j) => s + (j.channels?.length ?? 3), 0)
    const rows = Array.from({ length: 10 }, (_, f) => {
      const row = Array.from({ length: n }, () => 0)
      row[0] = x0 + f * 0.01
      row[1] = 1
      row[2] = z0
      return row
    })
    const p = parseBvh(toBvhText(joints, rows, 1 / 30))
    if (!p.ok) throw new Error(p.reason)
    return p.bvh
  }

  it('最初のフレームの水平位置を原点にそろえ、そのあとの動きは保つ。高さは変えない', () => {
    const r = retargetBvh(offsetClip(5, -3), { unitScale: 1 })
    if (!r.ok) throw new Error(r.reason)
    const h = r.tracks.hipsTranslation
    expect([h[0], h[1], h[2]]).toEqual([0, 1, 0])
    expect(h[9 * 3]).toBeCloseTo(0.09, 6) // 9 フレーム目までに 0.09m 動いた
    expect(h[9 * 3 + 1]).toBe(1)
    expect(r.report.recenteredMeters).toBeCloseTo(Math.hypot(5, 3), 5)
    expect(r.report.warnings.join('\n')).toContain('原点にそろえ')
  })

  it('recenter: false なら、そのまま', () => {
    const r = retargetBvh(offsetClip(5, -3), { unitScale: 1, recenter: false })
    if (!r.ok) throw new Error(r.reason)
    expect(r.tracks.hipsTranslation.slice(0, 3)).toEqual([5, 1, -3])
    expect(r.report.recenteredMeters).toBe(0)
  })

  it('原点に近いクリップでは、注意を出さない', () => {
    const r = retargetBvh(offsetClip(0.01, 0.02), { unitScale: 1 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.report.warnings.join('\n')).not.toContain('原点')
  })
})

describe('retargetBvh: 先頭フレームの外れ値と、足元の高さ', () => {
  it('先頭の1フレームだけが別物なら取り除き、時刻は 0 から始める', () => {
    const bvh = lyingClip(20)
    const r = retargetBvh(bvh, { unitScale: 1 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.report.droppedFirstFrame).toBe(true)
    expect(r.tracks.times).toHaveLength(19)
    expect(r.tracks.times[0]).toBe(0)
    expect(r.report.warnings.join('\n')).toContain('先頭の1フレーム')
  })

  it.each([2, 3, 5])('過渡フレームが先頭に %i 個あっても(立ち姿 → 本来のポーズへ段階的に飛ぶ)、まとめて取り除く', (leading) => {
    const bvh = lyingClip(30, 0, leading)
    const r = retargetBvh(bvh, { unitScale: 1 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.report.droppedLeadingFrames).toBe(leading)
    expect(r.tracks.times).toHaveLength(30 - leading)
    expect(r.report.warnings.join('\n')).toContain(`先頭の${leading}フレーム`)
  })

  it('先頭が過渡フレームでも、そのあとに動きのあるクリップは、取り除かない(速い本物の動きを削らない)', () => {
    const bvh = load('T', 1, 30, 4)
    const r = retargetBvh(bvh, { unitScale: 1 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.report.droppedLeadingFrames).toBe(0)
  })

  it('床の下に埋まったクリップは、最低点が基準姿勢の最低点にそろうよう高さを補正する', () => {
    const bvh = lyingClip(20)
    const r = retargetBvh(bvh, { unitScale: 1 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.report.groundShiftMeters).toBeGreaterThan(0.9)
    expect(r.report.warnings.join('\n')).toContain('高さを')
    // 変換後の骨格で FK して、全フレームの最低点が、立ち姿の最低点(合成骨格の足首の高さ 0.15m)とほぼ同じ
    let lowest = Infinity
    for (let f = 0; f < r.tracks.times.length; f++) {
      for (const p of Object.values(tracksForwardKinematics(r.tracks, f))) lowest = Math.min(lowest, p[1])
    }
    expect(lowest).toBeCloseTo(0.15, 2)
  })

  it('通常の立ちクリップ(上下に少し動く程度)は、取り除きも補正もしない', () => {
    const bvh = load('T', 1, 30, 4)
    const r = retargetBvh(bvh, { unitScale: 1 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.report.droppedFirstFrame).toBe(false)
    expect(r.report.groundShiftMeters).toBe(0)
    expect(r.tracks.times).toHaveLength(30)
  })
})

describe('retargetBvh', () => {
  it.each([
    ['T ポーズ', 'T'],
    ['A ポーズ(腕が斜め下)', 'A']
  ] as const)('%s: 変換後の骨格の関節位置が、元の BVH の FK と一致する', (_label, arms) => {
    const bvh = load(arms, 1)
    const r = retargetBvh(bvh, { unitScale: 1, recenter: false })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (let f = 0; f < bvh.frames; f++) {
      const ref = bvhForwardKinematics(bvh, f)
      const got = tracksForwardKinematics(r.tracks, f)
      bvh.joints.forEach((j, i) => {
        const p = got[j.name]
        expect(p, j.name).toBeDefined()
        expect(p[0]).toBeCloseTo(ref[i][0], 5)
        expect(p[1]).toBeCloseTo(ref[i][1], 5)
        expect(p[2]).toBeCloseTo(ref[i][2], 5)
      })
    }
  })

  it('T ポーズでは補正が入らず、回転は BVH の値そのまま(単位回転のトラックも出る)', () => {
    const bvh = load('T', 1, 3)
    const r = retargetBvh(bvh, { unitScale: 1 })
    if (!r.ok) throw new Error(r.reason)
    const hand = r.tracks.bones.find((b) => b.name === 'leftHand')!
    expect(hand.rotations).toHaveLength(3 * 4)
    // 基準の腕は +X 向き(T ポーズ)。補正が無いので、親からの相対位置も元のまま
    expect(hand.translation[0]).toBeCloseTo(0.25)
    expect(hand.translation[1]).toBeCloseTo(0)
  })

  it('A ポーズは、出力の基準姿勢が T ポーズ(腕が ±X 向き)になる', () => {
    const bvh = load('A', 1, 2)
    const r = retargetBvh(bvh, { unitScale: 1 })
    if (!r.ok) throw new Error(r.reason)
    const lower = r.tracks.bones.find((b) => b.name === 'leftLowerArm')!
    expect(lower.translation[0]).toBeCloseTo(0.25, 5)
    expect(lower.translation[1]).toBeCloseTo(0, 5)
    const rlower = r.tracks.bones.find((b) => b.name === 'rightLowerArm')!
    expect(rlower.translation[0]).toBeCloseTo(-0.25, 5)
  })

  it('単位が違っても(dm / cm)、auto の推定でメートルに直る', () => {
    for (const unit of [0.1 ** -1, 100]) {
      // unit=10: 腰の高さ 10(dm 相当)/ unit=100: 100(cm 相当)
      const bvh = load('T', unit, 2)
      const r = retargetBvh(bvh)
      if (!r.ok) throw new Error(r.reason)
      expect(r.report.unitScale).toBeCloseTo(1 / unit, 6)
      const hips = r.tracks.bones.find((b) => b.name === 'hips')!
      expect(hips.translation[1]).toBeCloseTo(1, 4)
    }
  })

  it('60fps の BVH は約 30fps に間引く', () => {
    const bvh = load('T', 1, 61, 3, 1 / 60)
    const r = retargetBvh(bvh)
    if (!r.ok) throw new Error(r.reason)
    expect(r.tracks.times).toHaveLength(31)
    expect(r.tracks.times[1]).toBeCloseTo(2 / 60)
    expect(r.report.durationSec).toBeCloseTo(1.0)
  })

  it('30fps 以下の BVH は間引かない', () => {
    const bvh = load('T', 1, 10, 3, 1 / 24)
    const r = retargetBvh(bvh)
    if (!r.ok) throw new Error(r.reason)
    expect(r.tracks.times).toHaveLength(10)
  })

  it('補間が遠回りにならないよう、隣り合うフレームのクォータニオンの符号をそろえる', () => {
    const bvh = load('T', 1, 30, 11)
    const r = retargetBvh(bvh)
    if (!r.ok) throw new Error(r.reason)
    for (const b of r.tracks.bones) {
      if (!b.rotations) continue
      for (let f = 1; f < r.tracks.times.length; f++) {
        let dot = 0
        for (let k = 0; k < 4; k++) dot += b.rotations[(f - 1) * 4 + k] * b.rotations[f * 4 + k]
        expect(dot, b.name).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('対応できない関節は無視して一覧に出し、その子は最も近い対応ボーンにつなぐ', () => {
    const joints = humanoidJoints('T')
    // chest と neck の間に、VRM に無い関節 "extra" を挟む
    const tweaked = joints.map((j) => (j.name === 'neck' ? { ...j, parent: 'extra' } : j))
    tweaked.splice(3, 0, { name: 'extra', parent: 'chest', offset: [0, 0.05, 0] })
    const p = parseBvh(toBvhText(tweaked, randomFrames(tweaked, 6, 5), 1 / 30))
    if (!p.ok) throw new Error(p.reason)
    const r = retargetBvh(p.bvh, { unitScale: 1 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.report.ignored).toEqual(['extra'])
    const neck = r.tracks.bones.find((b) => b.name === 'neck')!
    expect(neck.parent).toBe('chest')
    expect(neck.rotations).toBeDefined() // 挟まった関節の回転は、対応する子(neck)に合成される
  })

  it('hips が無い・左右が逆の BVH は理由つきで断る', () => {
    const noHips = humanoidJoints('T').map((j) => (j.name === 'hips' ? { ...j, name: 'Armature' } : j.parent === 'hips' ? { ...j, parent: 'Armature' } : j))
    const p1 = parseBvh(toBvhText(noHips, randomFrames(noHips, 2, 1), 1 / 30))
    if (!p1.ok) throw new Error(p1.reason)
    const r1 = retargetBvh(p1.bvh)
    expect(r1.ok).toBe(false)

    const mirrored = humanoidJoints('T').map((j) => ({ ...j, offset: [-j.offset[0], j.offset[1], j.offset[2]] as [number, number, number] }))
    const p2 = parseBvh(toBvhText(mirrored, randomFrames(mirrored, 2, 1), 1 / 30))
    if (!p2.ok) throw new Error(p2.reason)
    const r2 = retargetBvh(p2.bvh)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.reason).toContain('左右が逆')
  })
})
