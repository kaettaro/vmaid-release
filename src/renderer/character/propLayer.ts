import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PROP_FORMAT_UNIT, type PropPayload } from '@shared/props/formats'
import type { PropSpec } from '@shared/packs/manifest'

/** 同時に出せる小道具の数(Mod が、増やし続けないように) */
const MAX_PROPS = 8

/** FBX・PMX が、外部ファイル・URL を読もうとしたときに、代わりに返す、1ピクセルの透明な画像(通信・ほかのファイルの読み出しを起こさない) */
const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

interface Shown {
  obj: THREE.Object3D
  /** 出した Mod の id(自分のルールなら null)。Mod を OFF にしたときに、消すのに使う */
  source: string | null
  timer: ReturnType<typeof setTimeout> | null
  /** 後始末(PMX は、読み込んだものを、まとめて解放する) */
  cleanup?: () => void
  /** glb に入っているアニメーション(あれば、ループ再生する) */
  mixer?: THREE.AnimationMixer
}

/**
 * 追加オブジェクト層: Mod の小道具(glb / fbx / pmx)を、キャラの骨に付けて表示する(骨の子にするので、モーションに追従する)。
 * VRM と MMD の、どちらのステージでも使う。骨の探し方(findBone)と、大きさの基準(unit)だけが違う。
 * fbx・pmx の読み込み用のコードは、その形式の小道具を出すときだけ、動的に読み込む。
 * 消すとき(時間切れ・「小道具を消す」・Mod の OFF・解除・モデルの入れ替え)は、メモリ(ジオメトリ・材質・テクスチャ)も解放する。
 */
export class PropLayer {
  private readonly shown = new Map<string, Shown>()
  private readonly gltf = new GLTFLoader()

  /**
   * @param findBone 骨の名前(VRM の人体ボーン名、または MMD のボーン名)から、付ける先を探す
   * @param unit 1メートルが、モデルの座標で、どれだけか(VRM は 1。MMD は、モデルの大きさから決める)
   */
  constructor(
    private readonly findBone: (name: string) => THREE.Object3D | null,
    private readonly unit: () => number
  ) {}

  /** 形式に合わせて読み込む。返すのは、付ける物と、後始末 */
  private async load(payload: PropPayload): Promise<{ obj: THREE.Object3D; cleanup?: () => void; mixer?: THREE.AnimationMixer }> {
    if (payload.kind === 'pmx') {
      // 専用プロトコルの URL から読む(テクスチャは、同じフォルダの中のもの)。物理は使わない
      const { MMDLoader } = await import('@moeru/three-mmd')
      const mmd = await new MMDLoader().loadAsync(payload.url)
      const mats = Array.isArray(mmd.mesh.material) ? mmd.mesh.material : [mmd.mesh.material]
      for (const m of mats) {
        m.alphaTest = Math.max(m.alphaTest, 0.01)
        m.needsUpdate = true
      }
      // PMX のアクセサリは、モデル全体の座標で作られている(原点が足元で、物は頭の位置にある、など)。そのまま骨に付けると遠くにずれるので、
      // 物の中心を、骨の位置に合わせる(位置は、Mod の position で調整する)
      mmd.mesh.updateMatrixWorld(true)
      const center = new THREE.Box3().setFromObject(mmd.mesh).getCenter(new THREE.Vector3())
      mmd.mesh.position.sub(center)
      const holder = new THREE.Group()
      holder.add(mmd.mesh)
      return { obj: holder, cleanup: () => mmd.dispose() }
    }
    if (payload.kind === 'glb') {
      const gltf = await this.gltf.parseAsync(toBuffer(payload.data), '')
      if (gltf.animations.length === 0) return { obj: gltf.scene }
      // 入っているアニメーションは、すべてループ再生する(振り子の揺れなど)
      const mixer = new THREE.AnimationMixer(gltf.scene)
      for (const clip of gltf.animations) mixer.clipAction(clip).play()
      return { obj: gltf.scene, mixer }
    }
    {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
      // 外部の画像(相対パス・URL)は読まない。埋め込みの画像(blob: / data:)だけ読む
      const manager = new THREE.LoadingManager()
      manager.setURLModifier((url) => (url.startsWith('blob:') || url.startsWith('data:') ? url : BLANK_IMAGE))
      return { obj: new FBXLoader(manager).parse(toBuffer(payload.data), '') }
    }
  }

  async show(id: string, payload: PropPayload, spec: PropSpec, durationSec: number, source: string | null): Promise<void> {
    this.hide(id) // 同じ小道具を出し直すときは、いまのものを消す
    if (this.shown.size >= MAX_PROPS) return
    const bone = this.findBone(spec.bone)
    if (!bone) {
      console.warn(`小道具「${id}」: 付ける骨「${spec.bone}」が、このモデルにありません`)
      return
    }
    const { obj, cleanup, mixer } = await this.load(payload)
    // 読み込み中に、同じ id が、別の呼び出しで出されていたら、こちらは捨てる
    if (this.shown.has(id)) {
      mixer?.stopAllAction()
      dispose(obj)
      cleanup?.()
      return
    }
    // 形式ごとの単位(FBX は cm、PMX は MMD の単位)を、メートルにそろえてから、Mod の指定(spec.scale)を掛ける
    const u = this.unit()
    obj.scale.setScalar(spec.scale * PROP_FORMAT_UNIT[payload.kind] * u)
    obj.position.set(spec.position[0] * u, spec.position[1] * u, spec.position[2] * u)
    obj.rotation.set(THREE.MathUtils.degToRad(spec.rotation[0]), THREE.MathUtils.degToRad(spec.rotation[1]), THREE.MathUtils.degToRad(spec.rotation[2]))
    obj.traverse((o) => (o.frustumCulled = false))
    bone.add(obj)
    this.shown.set(id, { obj, source, cleanup, mixer, timer: durationSec > 0 ? setTimeout(() => this.hide(id), durationSec * 1000) : null })
  }

  hide(id: string): void {
    const e = this.shown.get(id)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    e.mixer?.stopAllAction()
    e.obj.removeFromParent()
    dispose(e.obj)
    e.cleanup?.()
    this.shown.delete(id)
  }

  /** 毎フレーム呼ぶ。アニメーション付きの小道具を進める */
  update(dt: number): void {
    for (const e of this.shown.values()) e.mixer?.update(dt)
  }

  /** keep に含まれない Mod が出した小道具を、すべて消す。all なら、自分のルールのものも消す */
  releaseSources(keep: ReadonlySet<string>, all = false): void {
    for (const [id, e] of [...this.shown]) if (all || (e.source !== null && !keep.has(e.source))) this.hide(id)
  }

  clear(): void {
    for (const id of [...this.shown.keys()]) this.hide(id)
  }

  get count(): number {
    return this.shown.size
  }
}

const toBuffer = (data: Uint8Array): ArrayBuffer => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer

function dispose(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry.dispose()
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose()
      mat.dispose()
    }
  })
}
