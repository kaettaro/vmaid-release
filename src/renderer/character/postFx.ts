import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

export interface PostParams {
  exposure: number
  tonemap: 'none' | 'aces'
  saturation: number
  /** 0 ならブルームを計算しない */
  bloom: number
  bloomThreshold: number
  bloomRadius: number
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

/** 明るい所だけを取り出す。透過ウィンドウなので、アルファで割って(元の色に戻して)から判定し、かけ戻す */
const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tSrc, vUv);
  vec3 rgb = c.a > 0.001 ? c.rgb / c.a : vec3(0.0);
  float lum = max(rgb.r, max(rgb.g, rgb.b));
  float k = max(lum - threshold, 0.0) / max(lum, 1e-4);
  gl_FragColor = vec4(rgb * k * c.a, c.a);
}`

const COPY_FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }`

/** 9 点のガウスぼかし(1 方向) */
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 dir; // 1 テクセルぶんの向き
varying vec2 vUv;
void main() {
  vec4 sum = texture2D(tSrc, vUv) * 0.2270270270;
  sum += texture2D(tSrc, vUv + dir * 1.3846153846) * 0.3162162162;
  sum += texture2D(tSrc, vUv - dir * 1.3846153846) * 0.3162162162;
  sum += texture2D(tSrc, vUv + dir * 3.2307692308) * 0.0702702703;
  sum += texture2D(tSrc, vUv - dir * 3.2307692308) * 0.0702702703;
  gl_FragColor = sum;
}`

/**
 * 仕上げ。アルファは、シーンのものをそのまま使う(にじみで、キャラの外側が不透明にならない = クリック透過を壊さない)。
 * 色は、アルファで割って(元の色に戻して)から、露出・ブルーム・階調・彩度・出力の色空間へ変換し、アルファをかけ戻す。
 */
const FINAL_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform vec3 bloomWeights;
uniform float bloomStrength;
uniform float exposure;
uniform float saturation;
uniform int tonemap;
varying vec2 vUv;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec4 s = texture2D(tScene, vUv);
  float a = s.a;
  vec3 rgb = a > 0.001 ? s.rgb / a : vec3(0.0);
  if (bloomStrength > 0.0) {
    vec3 b = texture2D(tBloom0, vUv).rgb * bloomWeights.x + texture2D(tBloom1, vUv).rgb * bloomWeights.y + texture2D(tBloom2, vUv).rgb * bloomWeights.z;
    // にじみは、キャラの輪郭の内側にだけ足す(外側のアルファを増やさない)
    rgb += b * bloomStrength * smoothstep(0.3, 1.0, a);
  }
  rgb *= exposure;
  if (tonemap == 1) rgb = aces(rgb);
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = max(mix(vec3(luma), rgb, saturation), 0.0);
  vec4 o = vec4(rgb, 1.0);
  o = linearToOutputTexel(o);
  gl_FragColor = vec4(o.rgb * a, a);
}`

/**
 * 透過ウィンドウ向けの、小さな後処理(ブルーム・階調・彩度)。three 標準の EffectComposer / UnrealBloomPass は、
 * ブルームがアルファを壊して(背景まで不透明になって)クリック透過の判定が崩れるので、使わない。
 * シーンを半精度の RGBA(MSAA つき)へ描き、明るい所を縮小してぼかし、仕上げでキャンバスへ描く。
 */
export class PostFx {
  private sceneRT: THREE.WebGLRenderTarget | null = null
  /** ブルームの段(1/2・1/4・1/8 の解像度)。それぞれ、ぼかしの往復用に 2 枚 */
  private levels: Array<{ a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget }> = []
  private width = 0
  private height = 0
  private readonly quad = new FullScreenQuad()
  private readonly bright = this.shader(BRIGHT_FRAG, { tSrc: { value: null }, threshold: { value: 0.85 } })
  private readonly copy = this.shader(COPY_FRAG, { tSrc: { value: null } })
  private readonly blur = this.shader(BLUR_FRAG, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } })
  private readonly final = this.shader(FINAL_FRAG, {
    tScene: { value: null },
    tBloom0: { value: null },
    tBloom1: { value: null },
    tBloom2: { value: null },
    bloomWeights: { value: new THREE.Vector3(1, 1, 1) },
    bloomStrength: { value: 0 },
    exposure: { value: 1 },
    saturation: { value: 1 },
    tonemap: { value: 0 }
  })

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  private shader(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending })
  }

  private target(w: number, h: number, samples = 0): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples, depthBuffer: samples > 0, colorSpace: THREE.LinearSRGBColorSpace })
  }

  private ensureSize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    if (this.sceneRT && size.x === this.width && size.y === this.height) return
    this.disposeTargets()
    this.width = size.x
    this.height = size.y
    this.sceneRT = this.target(size.x, size.y, 4)
    this.levels = [2, 4, 8].map((d) => ({ a: this.target(Math.round(size.x / d), Math.round(size.y / d)), b: this.target(Math.round(size.x / d), Math.round(size.y / d)) }))
  }

  private pass(mat: THREE.ShaderMaterial, src: THREE.Texture, out: THREE.WebGLRenderTarget | null): void {
    mat.uniforms.tSrc.value = src
    this.quad.material = mat
    this.renderer.setRenderTarget(out)
    this.quad.render(this.renderer)
  }

  private blurLevel(l: { a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget }): void {
    const { width, height } = l.a
    this.blur.uniforms.dir.value.set(1 / width, 0)
    this.pass(this.blur, l.a.texture, l.b)
    this.blur.uniforms.dir.value.set(0, 1 / height)
    this.pass(this.blur, l.b.texture, l.a)
  }

  render(scene: THREE.Scene, camera: THREE.Camera, p: PostParams): void {
    this.ensureSize()
    const r = this.renderer
    const prev = r.getRenderTarget()
    r.setRenderTarget(this.sceneRT)
    r.render(scene, camera)

    const bloomOn = p.bloom > 0.001
    if (bloomOn) {
      this.bright.uniforms.threshold.value = p.bloomThreshold
      this.pass(this.bright, this.sceneRT!.texture, this.levels[0].a)
      this.blurLevel(this.levels[0])
      this.pass(this.copy, this.levels[0].a.texture, this.levels[1].a)
      this.blurLevel(this.levels[1])
      this.pass(this.copy, this.levels[1].a.texture, this.levels[2].a)
      this.blurLevel(this.levels[2])
    }
    const u = this.final.uniforms
    u.tScene.value = this.sceneRT!.texture
    u.tBloom0.value = this.levels[0].a.texture
    u.tBloom1.value = this.levels[1].a.texture
    u.tBloom2.value = this.levels[2].a.texture
    // 半径が大きいほど、粗い(広くにじむ)段の重みを増やす
    const rad = Math.min(1, Math.max(0, p.bloomRadius))
    u.bloomWeights.value.set(1 - 0.6 * rad, 0.7, 0.3 + 0.7 * rad)
    u.bloomStrength.value = bloomOn ? p.bloom : 0
    u.exposure.value = p.exposure
    u.saturation.value = p.saturation
    u.tonemap.value = p.tonemap === 'aces' ? 1 : 0
    this.quad.material = this.final
    r.setRenderTarget(null)
    this.quad.render(r)
    r.setRenderTarget(prev)
  }

  private disposeTargets(): void {
    this.sceneRT?.dispose()
    this.sceneRT = null
    for (const l of this.levels) {
      l.a.dispose()
      l.b.dispose()
    }
    this.levels = []
  }

  dispose(): void {
    this.disposeTargets()
    this.quad.dispose()
    for (const m of [this.bright, this.copy, this.blur, this.final]) m.dispose()
  }
}
