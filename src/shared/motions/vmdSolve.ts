// VMD のキーを 30fps でサンプリングし、標準 MMD 骨格に当てはめて、足 IK を解く(IK を回転に焼き込む)。純粋関数。
// 座標は、右手系(VRM 1.0 と同じ。正面が +Z)へ変換して計算する: 位置 (x, y, z) → (x, y, -z)、回転 (x, y, z, w) → (-x, -y, z, w)。
// IK は CCD(MMD と同じ考え方): 先端が IK ボーンの位置に届くよう、リンクの骨を、先端に近い順に、繰り返し回す。
//   ひざのように「X 軸まわりだけ・一方向だけ」曲がる骨は、YZ 平面に投影した角度で回し、範囲に収める。

import { MMD_IKS, MMD_MOVABLE, MMD_SKELETON } from './mmdSkeleton'
import { Q_IDENTITY, qAxisAngle, qDot, qFromTo, qInv, qMul, qNormalize, qRotate, vAdd, vCross, vDot, vLen, vNormalize, vSub, type Quat, type Vec3 } from './quat'
import type { Curve, Vmd, VmdBoneKey } from './vmdParse'

/** VMD のフレームレート */
export const VMD_FPS = 30

export interface SolvedBone {
  /** フレームごとの世界回転(右手系・基準姿勢=単位)。x, y, z, w を並べた配列 */
  worldRot: Float32Array
}

export interface SolveReport {
  /** IK が目標に届かなかった(収束しなかった)のべフレーム数 */
  ikMisses: number
  /** VMD にあるが、標準骨格に無いため使わなかったボーン名 */
  unknownBones: string[]
  /** IK を OFF にしているフレームがあった(その間は、足の FK のキーをそのまま使う) */
  ikWasOff: boolean
}

export interface SolvedClip {
  frames: number
  /** 世界回転を持つ骨(標準骨格の骨) */
  bones: Map<string, SolvedBone>
  /** 各骨の基準姿勢のワールド位置(右手系。MMD の単位のまま) */
  rest: Map<string, Vec3>
  /** 「下半身」の世界位置の変化(フレームごと。x, y, z を並べた配列。MMD の単位・右手系) */
  hipsPos: Float32Array
  report: SolveReport
}

/** ベジェ曲線: 横軸の位置 x(0〜1)に対する値 y(0〜1) */
export function bezier(c: Curve, x: number): number {
  if (c.x1 === c.y1 && c.x2 === c.y2) return x
  if (x <= 0) return 0
  if (x >= 1) return 1
  const cx = 3 * c.x1
  const bx = 3 * (c.x2 - c.x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * c.y1
  const by = 3 * (c.y2 - c.y1) - cy
  const ay = 1 - cy - by
  // x(t) = x となる t を、二分法で求める(曲線は単調)
  let lo = 0
  let hi = 1
  let t = x
  for (let i = 0; i < 30; i++) {
    const v = ((ax * t + bx) * t + cx) * t
    if (Math.abs(v - x) < 1e-7) break
    if (v > x) hi = t
    else lo = t
    t = (lo + hi) / 2
  }
  return ((ay * t + by) * t + cy) * t
}

const qSlerp = (a: Quat, b: Quat, t: number): Quat => {
  let bb = b
  let d = qDot(a, b)
  if (d < 0) {
    bb = [-b[0], -b[1], -b[2], -b[3]]
    d = -d
  }
  if (d > 0.9995) return qNormalize([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t])
  const theta = Math.acos(d)
  const s = Math.sin(theta)
  const wa = Math.sin((1 - t) * theta) / s
  const wb = Math.sin(t * theta) / s
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb]
}

/** 左手系 → 右手系 */
const posFromMmd = (p: readonly [number, number, number]): Vec3 => [p[0], p[1], -p[2]]
const rotFromMmd = (q: readonly [number, number, number, number]): Quat => qNormalize([-q[0], -q[1], q[2], q[3]])

/** 任意の軸まわりの回転 */
function qAxis(axis: Vec3, rad: number): Quat {
  const s = Math.sin(rad / 2)
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)]
}

/** あるフレームでの、1 つの骨のキーの値(補間済み) */
function sampleKey(keys: VmdBoneKey[], frame: number, cursor: { i: number }): { rot: Quat; pos: Vec3 } {
  while (cursor.i + 1 < keys.length && keys[cursor.i + 1].frame <= frame) cursor.i++
  const a = keys[cursor.i]
  const b = keys[cursor.i + 1]
  const ra = rotFromMmd(a.rotation)
  const pa = posFromMmd(a.position)
  if (!b || frame <= a.frame) return { rot: ra, pos: pa }
  const span = b.frame - a.frame
  const t = (frame - a.frame) / span
  const rb = rotFromMmd(b.rotation)
  const pb = posFromMmd(b.position)
  // b のキーの補間曲線で、a から b へ。位置の z は、符号を反転して使うので、曲線の値はそのまま
  const kx = bezier(b.curves.x, t)
  const ky = bezier(b.curves.y, t)
  const kz = bezier(b.curves.z, t)
  const kr = bezier(b.curves.rot, t)
  return {
    rot: qSlerp(ra, rb, kr),
    pos: [pa[0] + (pb[0] - pa[0]) * kx, pa[1] + (pb[1] - pa[1]) * ky, pa[2] + (pb[2] - pa[2]) * kz]
  }
}

const IK_EPS = 1e-4
/** IK の位置の許容誤差(MMD の単位。ひざから足首までが約 5.7 なので、約 0.2%) */
const IK_TOLERANCE = 0.01
/** これ以上離れたら、届かなかったとみなす(MMD の単位。約 1.6cm) */
const IK_MISS_DISTANCE = 0.2

/** 検証用: IK を解くたびに呼ばれる(フレーム・IK の名前・目標までの残りの距離・先頭リンクの局所 X 回転・目標と先端の位置) */
export type IkProbe = (info: { frame: number; ik: string; dist: number; link0X: number; target: Vec3; effector: Vec3; hips: Vec3 }) => void

/**
 * subdiv: 1 フレームを何分割して解くか(1 = 30fps のまま / 2 = 60fps)。キーの間を細かく解くと、補間曲線(ベジェ)と IK の動きが、なめらかに残る。
 * 返す frames は、サンプル数((最後のフレーム × subdiv) + 1)。
 */
export function solveVmd(vmd: Vmd, probe?: IkProbe, subdiv = 1): SolvedClip {
  const n = MMD_SKELETON.length
  const index = new Map(MMD_SKELETON.map((r, i) => [r[0], i]))
  const parent = MMD_SKELETON.map((r) => (r[1] === null ? -1 : (index.get(r[1]) ?? -1)))
  const restPos: Vec3[] = []
  const restLocal: Vec3[] = []
  MMD_SKELETON.forEach((r, i) => {
    restPos[i] = posFromMmd(r[2])
    restLocal[i] = parent[i] < 0 ? restPos[i] : vSub(restPos[i], restPos[parent[i]])
  })
  const children: number[][] = MMD_SKELETON.map(() => [])
  parent.forEach((p, i) => p >= 0 && children[p].push(i))

  const unknownBones = [...vmd.bones.keys()].filter((name) => !index.has(name))
  const tracks: Array<VmdBoneKey[] | null> = MMD_SKELETON.map((r) => vmd.bones.get(r[0]) ?? null)
  const cursors = MMD_SKELETON.map(() => ({ i: 0 }))
  const iks = MMD_IKS.map((ik) => ({
    ...ik,
    boneIdx: index.get(ik.bone) ?? -1,
    targetIdx: index.get(ik.target) ?? -1,
    linkIdx: ik.links.map((l) => index.get(l.bone) ?? -1)
  })).filter((ik) => ik.boneIdx >= 0 && ik.targetIdx >= 0 && ik.linkIdx.every((x) => x >= 0))

  const frames = Math.max(1, vmd.lastFrame * subdiv + 1)
  const localRot: Quat[] = MMD_SKELETON.map(() => Q_IDENTITY)
  const localTrans: Vec3[] = MMD_SKELETON.map(() => [0, 0, 0])
  const wRot: Quat[] = MMD_SKELETON.map(() => Q_IDENTITY)
  const wPos: Vec3[] = MMD_SKELETON.map(() => [0, 0, 0])

  const updateWorld = (i: number): void => {
    const p = parent[i]
    const offset = vAdd(restLocal[i], localTrans[i])
    if (p < 0) {
      wRot[i] = localRot[i]
      wPos[i] = offset
    } else {
      wRot[i] = qNormalize(qMul(wRot[p], localRot[i]))
      wPos[i] = vAdd(wPos[p], qRotate(wRot[p], offset))
    }
  }
  const updateSubtree = (i: number): void => {
    updateWorld(i)
    for (const c of children[i]) updateSubtree(c)
  }

  /**
   * 脚の IK(ひざ = X 軸まわりだけ・一方向に曲がる / 足 = 自由)の、解析解。
   * ① 足首が目標に届く距離になる、ひざの角度を、二分法で決める(足首までの距離は、ひざを曲げるほど単調に縮む)。
   * ② 足(付け根)を、足首が目標の方を向くように、最小の回転で回す。
   * CCD だと、脚がほぼ伸びていて目標が同じ線上にあるとき、ひざがほとんど曲がらず、収束しないため。
   */
  const solveLeg = (knee: number, hip: number, ankle: number, xRange: readonly [number, number], target: Vec3): void => {
    const lo = -xRange[1] // 右手系では、MMD の範囲の符号が反転する
    const hi = -xRange[0]
    const kOff = vAdd(restLocal[knee], localTrans[knee])
    const aOff = restLocal[ankle]
    const reach = (theta: number): number => vLen(vAdd(kOff, qRotate(qAxisAngle('x', theta), aOff)))
    const dTarget = vLen(vSub(target, wPos[hip]))
    const dist = Math.max(reach(hi), Math.min(reach(lo), dTarget)) // 届く範囲に収める
    let a = lo
    let b = hi
    for (let i = 0; i < 40; i++) {
      const mid = (a + b) / 2
      if (reach(mid) > dist) a = mid // まだ遠い → もっと曲げる
      else b = mid
    }
    localRot[knee] = qAxisAngle('x', (a + b) / 2)
    updateSubtree(knee)
    const inv = qInv(wRot[hip])
    const e = vNormalize(qRotate(inv, vSub(wPos[ankle], wPos[hip])))
    const t = vNormalize(qRotate(inv, vSub(target, wPos[hip])))
    localRot[hip] = qNormalize(qMul(localRot[hip], qFromTo(e, t)))
    updateSubtree(hip)
  }

  const out = new Map<string, Float32Array>()
  const outIdx = MMD_SKELETON.map((r) => r[0])
  outIdx.forEach((name) => out.set(name, new Float32Array(frames * 4)))
  const hipsIdx = index.get('下半身') ?? 0
  const hipsPos = new Float32Array(frames * 3)
  const report: SolveReport = { ikMisses: 0, unknownBones, ikWasOff: false }

  /** そのフレームで、IK が ON か(プロパティのキーが無ければ ON) */
  let ikCursor = -1
  const ikOn = (frame: number, name: string): boolean => {
    while (ikCursor + 1 < vmd.ikStates.length && vmd.ikStates[ikCursor + 1].frame <= frame) ikCursor++
    const s = ikCursor >= 0 ? vmd.ikStates[ikCursor].states[name] : undefined
    return s !== false
  }

  for (let sIdx = 0; sIdx < frames; sIdx++) {
    const f = sIdx / subdiv // VMD のフレーム(小数)
    for (let i = 0; i < n; i++) {
      const keys = tracks[i]
      if (keys && keys.length > 0) {
        const s = sampleKey(keys, f, cursors[i])
        localRot[i] = s.rot
        localTrans[i] = MMD_MOVABLE.has(MMD_SKELETON[i][0]) ? s.pos : [0, 0, 0]
      } else {
        localRot[i] = Q_IDENTITY
        localTrans[i] = [0, 0, 0]
      }
    }
    for (let i = 0; i < n; i++) updateWorld(i) // 親が先に並んでいる

    for (const ik of iks) {
      if (!ikOn(f, ik.bone)) {
        report.ikWasOff = true
        continue
      }
      const target = wPos[ik.boneIdx]
      const knee = ik.linkIdx[0]
      const hip = ik.linkIdx[1]
      if (ik.links.length === 2 && ik.links[0].xRange && parent[ik.targetIdx] === knee && parent[knee] === hip) {
        solveLeg(knee, hip, ik.targetIdx, ik.links[0].xRange, target)
        probe?.({ frame: f, ik: ik.bone, dist: vLen(vSub(wPos[ik.targetIdx], target)), link0X: 2 * Math.atan2(localRot[knee][0], localRot[knee][3]), target, effector: wPos[ik.targetIdx], hips: wPos[hipsIdx] })
        if (vLen(vSub(wPos[ik.targetIdx], target)) >= IK_MISS_DISTANCE) report.ikMisses++
        continue
      }
      let reached = false
      for (let it = 0; it < ik.loop && !reached; it++) {
        for (let li = 0; li < ik.linkIdx.length; li++) {
          const L = ik.linkIdx[li]
          const effector = wPos[ik.targetIdx]
          if (vLen(vSub(effector, target)) < IK_TOLERANCE) {
            reached = true
            break
          }
          const inv = qInv(wRot[L])
          const e = vNormalize(qRotate(inv, vSub(effector, wPos[L])))
          const t = vNormalize(qRotate(inv, vSub(target, wPos[L])))
          const range = ik.links[li].xRange
          if (range) {
            // X 軸まわりだけ・範囲つき(右手系では、MMD の範囲の符号が反転する)
            const e2: Vec3 = [0, e[1], e[2]]
            const t2: Vec3 = [0, t[1], t[2]]
            if (vLen(e2) < IK_EPS || vLen(t2) < IK_EPS) continue
            const en = vNormalize(e2)
            const tn = vNormalize(t2)
            let angle = Math.atan2(vCross(en, tn)[0], vDot(en, tn))
            angle = Math.max(-ik.limit, Math.min(ik.limit, angle))
            const lq = localRot[L][3] < 0 ? ([-localRot[L][0], -localRot[L][1], -localRot[L][2], -localRot[L][3]] as Quat) : localRot[L]
            const cur = 2 * Math.atan2(lq[0], lq[3]) // 局所回転は X 軸まわりだけとみなす
            const lo = -range[1]
            const hi = -range[0]
            const next = Math.max(lo, Math.min(hi, cur + angle))
            localRot[L] = qAxisAngle('x', next)
          } else {
            const d = Math.max(-1, Math.min(1, vDot(e, t)))
            let angle = Math.acos(d)
            if (angle < IK_EPS) continue
            angle = Math.min(angle, ik.limit)
            const axis = vCross(e, t)
            if (vLen(axis) < 1e-9) continue
            localRot[L] = qNormalize(qMul(localRot[L], qAxis(vNormalize(axis), angle)))
          }
          updateSubtree(L)
        }
      }
      probe?.({ frame: f, ik: ik.bone, dist: vLen(vSub(wPos[ik.targetIdx], target)), link0X: 2 * Math.atan2(localRot[ik.linkIdx[0]][0], localRot[ik.linkIdx[0]][3]), target, effector: wPos[ik.targetIdx], hips: wPos[hipsIdx] })
      // 脚の IK だけ数える(つま先 IK は、骨の長さが基準姿勢と合わず、位置にはぴったり届かないのがふつう)
      if (ik.links.length > 1 && !reached && vLen(vSub(wPos[ik.targetIdx], target)) >= IK_MISS_DISTANCE) report.ikMisses++
    }

    for (let i = 0; i < n; i++) {
      const q = wRot[i]
      const a = out.get(outIdx[i]) as Float32Array
      a[sIdx * 4] = q[0]
      a[sIdx * 4 + 1] = q[1]
      a[sIdx * 4 + 2] = q[2]
      a[sIdx * 4 + 3] = q[3]
    }
    hipsPos[sIdx * 3] = wPos[hipsIdx][0]
    hipsPos[sIdx * 3 + 1] = wPos[hipsIdx][1]
    hipsPos[sIdx * 3 + 2] = wPos[hipsIdx][2]
  }

  const bones = new Map<string, SolvedBone>([...out].map(([name, worldRot]) => [name, { worldRot }]))
  const rest = new Map<string, Vec3>(MMD_SKELETON.map((r, i) => [r[0], restPos[i]]))
  return { frames, bones, rest, hipsPos, report }
}
