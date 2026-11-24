import { MAX_SAMPLED_FRAMES, type SampledSkeleton } from '../shared/motions/skeletonToBvh'
import { looksLikeFbx } from '../shared/props/formats'

// FBX を、three の FBXLoader で読み、最初のアニメーションを、一定の間隔で動かしながら、各骨のワールド姿勢を集める。
// Electron の main(Node)で動く。three は、使うときだけ、動的に読み込む(FBX を取り込まない人には、読み込みの負担を足さない)。
// FBXLoader は、テクスチャを DOM(画像)で読むので、Node には無い document を、ごく小さな代用品で、読み込みの間だけ置く
// (画像は読まない。骨とアニメーションだけが必要)。

export type SampleResult = { ok: true; skeleton: SampledSkeleton } | { ok: false; reason: string }

/** 1ファイルの上限(バイト) */
export const MAX_FBX_BYTES = 100 * 1024 * 1024
const FPS = 30
const MAX_SECONDS = 600

export { looksLikeFbx }

export async function sampleFbx(data: Uint8Array): Promise<SampleResult> {
  if (data.length > MAX_FBX_BYTES) return { ok: false, reason: `大きすぎます(上限 ${MAX_FBX_BYTES / 1024 / 1024}MB)` }
  if (!looksLikeFbx(data)) return { ok: false, reason: 'FBX ファイルではありません' }
  const THREE = await import('three')
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
  const g = globalThis as { document?: unknown }
  const hadDocument = 'document' in g
  if (!hadDocument) {
    g.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_v: string) {} }) }
  }
  try {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    const group = new FBXLoader().parse(buffer, '')
    const clip = group.animations[0]
    if (!clip || clip.tracks.length === 0) return { ok: false, reason: 'アニメーションが含まれていません' }

    const bones: InstanceType<typeof THREE.Bone>[] = []
    group.traverse((o) => {
      const b = o as InstanceType<typeof THREE.Bone>
      if (!b.isBone) return
      // FBXLoader は、骨ごとに、同じ名前の子(同じ位置の複製)を作ることがある。複製は、使わない
      const p = b.parent as InstanceType<typeof THREE.Bone> | null
      if (p?.isBone && p.name === b.name) return
      bones.push(b)
    })
    if (bones.length === 0) return { ok: false, reason: '骨(スケルトン)が含まれていません' }
    const indexOf = new Map(bones.map((b, i) => [b, i]))
    const parentOf = bones.map((b) => {
      for (let p = b.parent; p; p = p.parent) if (indexOf.has(p as never)) return indexOf.get(p as never) as number
      return -1
    })

    const read = (): { pos: [number, number, number][]; rot: [number, number, number, number][] } => {
      const pos: [number, number, number][] = []
      const rot: [number, number, number, number][] = []
      const p = new THREE.Vector3()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      for (const b of bones) {
        b.matrixWorld.decompose(p, q, s)
        pos.push([p.x, p.y, p.z])
        rot.push([q.x, q.y, q.z, q.w])
      }
      return { pos, rot }
    }

    group.updateMatrixWorld(true)
    const rest = read()
    const duration = Math.min(clip.duration, MAX_SECONDS)
    const count = Math.min(MAX_SAMPLED_FRAMES, Math.max(2, Math.ceil(duration * FPS) + 1))
    const step = duration / (count - 1)
    const mixer = new THREE.AnimationMixer(group)
    mixer.clipAction(clip).play()
    const frames = []
    for (let i = 0; i < count; i++) {
      mixer.setTime(i * step)
      group.updateMatrixWorld(true)
      frames.push(read())
    }
    return {
      ok: true,
      skeleton: {
        joints: bones.map((b, i) => ({ name: b.name || `bone${i}`, parent: parentOf[i], restPos: rest.pos[i], restRot: rest.rot[i] })),
        frameTime: step,
        frames
      }
    }
  } catch (e) {
    return { ok: false, reason: `FBX として読めません(${e instanceof Error ? e.message : String(e)})` }
  } finally {
    if (!hadDocument) delete g.document
  }
}
