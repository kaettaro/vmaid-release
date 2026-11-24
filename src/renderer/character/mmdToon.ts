import * as THREE from 'three'

/**
 * トゥーンテクスチャの補正。
 * @moeru/three-mmd は、トゥーンの画像を 90° 回して(グラデーションを横向きにして)使うが、回した結果を、元と同じ幅×高さのキャンバスへ描くため、
 * 縦長・横長の画像(例 16×250)では、ほとんどが切れて透明になる。直射光が 0 になり、肌が灰色にくすんで見える。
 * ここで、元の画像を読み直し、幅と高さを入れ替えたキャンバスへ回して描いて、差し替える。正方形(共有トゥーン 32×32 など)は、そのまま。
 */

interface ToonMaterial extends THREE.Material {
  toonMap?: THREE.Texture
  sphereMap?: THREE.Texture
  descriptor?: { toonMapFileName?: string; isDefaultToonTexture?: boolean }
  mmdUniforms?: { mmdToonMap: { value: THREE.Texture | undefined }; mmdSphereMap: { value: THREE.Texture | undefined } }
}

/** 画像を、右へ 90° 回した、幅と高さを入れ替えたキャンバス(縦のグラデーションが、横になる。上 = 明るい側 → 右) */
export function rotateToonImage(image: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const w = image.width
  const h = image.height
  const canvas = document.createElement('canvas')
  canvas.width = h
  canvas.height = w
  const ctx = canvas.getContext('2d')!
  ctx.translate(h / 2, w / 2)
  ctx.rotate(0.5 * Math.PI)
  ctx.translate(-w / 2, -h / 2)
  ctx.drawImage(image, 0, 0)
  return canvas
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // 汚染されたキャンバスは、テクスチャにできない(ライブラリの読み込みと同じ)
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** 正方形でないトゥーン画像を持つ材質の、トゥーンを差し替える。モデルを読み込んだあと、背景で呼ぶ(待たない) */
export async function fixToonTextures(materials: THREE.Material[], baseUrl: string): Promise<number> {
  const cache = new Map<string, Promise<THREE.Texture | null>>()
  let fixed = 0
  await Promise.all(
    (materials as ToonMaterial[]).map(async (m) => {
      const file = m.descriptor?.toonMapFileName
      if (!file || m.descriptor?.isDefaultToonTexture || !m.toonMap || !m.mmdUniforms) return
      const key = file.replaceAll('\\', '/')
      let pending = cache.get(key)
      if (!pending) {
        pending = loadImage(new URL(key, baseUrl).href).then((img) => {
          if (!img || img.width === img.height) return null // 正方形は、ライブラリの回転で正しい
          const t = new THREE.CanvasTexture(rotateToonImage(img))
          t.flipY = false
          t.magFilter = THREE.NearestFilter
          t.minFilter = THREE.NearestFilter
          t.generateMipmaps = false
          t.wrapS = THREE.RepeatWrapping
          t.wrapT = THREE.RepeatWrapping
          t.colorSpace = THREE.SRGBColorSpace
          return t
        })
        cache.set(key, pending)
      }
      const t = await pending
      if (!t) return
      m.toonMap = t
      m.mmdUniforms.mmdToonMap.value = t
      if (!m.sphereMap) m.mmdUniforms.mmdSphereMap.value = t
      m.needsUpdate = true
      fixed++
    })
  )
  return fixed
}
