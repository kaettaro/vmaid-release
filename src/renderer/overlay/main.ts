import type { EffectLayer, OverlayPayload } from '@shared/overlay'

/**
 * 画面効果を描く。効果は「レイヤーの組み合わせ」(main が検証済み)。点滅は避ける(明るさの変化は、ゆっくりした波だけ)。
 * 描く側は、受け取った値をもう一度、安全な範囲に丸める(信用しすぎない)。
 */

/** 描画の解像度は、画面の半分(全画面で毎フレーム描くため。ぼんやりした効果なので、見た目は変わらない) */
const SCALE = 0.5
const FADE_SEC = 0.8

const canvas = document.getElementById('c') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

let payload: OverlayPayload | null = null
let startedAt = 0
let hiding: number | null = null // 消え始めた時刻(ms)
/** 粒・霧の、レイヤーごとの状態(出すたびに作り直す) */
let layerState: Array<unknown> = []

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min))

function resize(): void {
  canvas.width = Math.max(1, Math.round(window.innerWidth * SCALE))
  canvas.height = Math.max(1, Math.round(window.innerHeight * SCALE))
}
window.addEventListener('resize', resize)
resize()

type Rgb = [number, number, number]
function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgba = (c: Rgb, a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1).toFixed(3)})`

/** 出る・消える時の、ゆっくりした透明度の変化(0〜1) */
function envelope(now: number, p: OverlayPayload): number {
  const t = (now - startedAt) / 1000
  let a = p.instant ? 1 : Math.min(1, t / FADE_SEC)
  if (hiding !== null) a = Math.min(a, Math.max(0, 1 - (now - hiding) / 1000 / FADE_SEC))
  else if (p.durationSec > 0) a = Math.min(a, Math.max(0, (p.durationSec - t) / FADE_SEC))
  return a
}

/** 粒の初期配置(レイヤーごとに1回) */
interface Particle {
  x: number
  y: number
  phase: number
  scale: number
  /** 色の番号(colors があるとき) */
  ci: number
  /** burst: 広がる向き(ラジアン)と、速さの個体差 */
  angle: number
  vary: number
}
function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: Math.random(),
    y: Math.random(),
    phase: Math.random() * Math.PI * 2,
    scale: 0.6 + Math.random() * 0.8,
    ci: Math.floor(Math.random() * 1000),
    angle: Math.random() * Math.PI * 2,
    vary: 0.5 + Math.random() * 0.8
  }))
}

function shapePath(shape: string, x: number, y: number, r: number): void {
  ctx.beginPath()
  if (shape === 'heart') {
    ctx.moveTo(x, y + r * 0.9)
    ctx.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.2, x, y - r * 0.4)
    ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.6, y - r * 0.2, x, y + r * 0.9)
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad)
      else ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad)
    }
    ctx.closePath()
  } else if (shape === 'square') {
    ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6)
  } else if (shape === 'diamond') {
    ctx.moveTo(x, y - r * 1.15)
    ctx.lineTo(x + r * 0.8, y)
    ctx.lineTo(x, y + r * 1.15)
    ctx.lineTo(x - r * 0.8, y)
    ctx.closePath()
  } else if (shape === 'spark') {
    // 細い 4 つの光の筋(中心がくびれた、きらめき)
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? r * 1.2 : r * 0.2
      const a = -Math.PI / 2 + (i * Math.PI) / 4
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad)
      else ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad)
    }
    ctx.closePath()
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2)
  }
}

function drawLayer(layer: EffectLayer, i: number, main: Rgb, k: number, t: number): void {
  const w = canvas.width
  const h = canvas.height
  const c = layer.color === 'main' ? main : hexToRgb(layer.color)
  const a = clamp(layer.alpha, 0, 1) * k
  switch (layer.type) {
    case 'spiral': {
      const cx = w / 2
      const cy = h / 2
      const maxR = Math.hypot(cx, cy)
      const rot = t * clamp(layer.speed, -0.3, 0.3) * Math.PI * 2
      const arms = Math.round(clamp(layer.arms, 1, 8))
      const pitch = maxR / clamp(layer.turns, 3, 20)
      ctx.lineCap = 'butt'
      ctx.strokeStyle = rgba(c, a)
      ctx.lineWidth = pitch / (arms * 2)
      for (let n = 0; n < arms; n++) {
        ctx.beginPath()
        const base = rot + (n * Math.PI * 2) / arms
        for (let r = 2; r <= maxR; r += 3) {
          const ang = base - (r / pitch) * Math.PI * 2
          const x = cx + Math.cos(ang) * r
          const y = cy + Math.sin(ang) * r
          if (r === 2) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      break
    }
    case 'fog': {
      const n = Math.round(clamp(layer.blobs, 3, 16))
      const base = Math.min(w, h) * clamp(layer.size, 0.15, 0.8)
      const sp = clamp(layer.speed, 0, 0.2)
      const st = layerState[i] as number[] | undefined
      const seeds = st ?? Array.from({ length: n * 3 }, () => Math.random() * Math.PI * 2)
      layerState[i] = seeds
      for (let b = 0; b < n; b++) {
        const x = w * (0.5 + 0.55 * Math.sin(seeds[b * 3] + t * sp * 2 * Math.PI * 0.6))
        const y = h * (0.5 + 0.55 * Math.sin(seeds[b * 3 + 1] + t * sp * 2 * Math.PI * 0.45))
        const r = base * (0.7 + 0.3 * Math.sin(seeds[b * 3 + 2] + t * sp * 2 * Math.PI * 0.3))
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, rgba(c, a * 0.8))
        g.addColorStop(1, rgba(c, 0))
        ctx.fillStyle = g
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
      }
      break
    }
    case 'vignette': {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * clamp(layer.inner, 0, 0.9), w / 2, h / 2, Math.hypot(w, h) / 2)
      g.addColorStop(0, rgba(c, 0))
      g.addColorStop(1, rgba(c, a))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      break
    }
    case 'pulse': {
      const wave = 0.5 + 0.5 * Math.sin(t * clamp(layer.hz, 0.05, 0.5) * Math.PI * 2)
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2)
      g.addColorStop(0, rgba(c, 0))
      g.addColorStop(1, rgba(c, a * (0.25 + 0.75 * wave)))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      break
    }
    case 'fill':
      ctx.fillStyle = rgba(c, a)
      ctx.fillRect(0, 0, w, h)
      break
    case 'particles': {
      const n = Math.round(clamp(layer.count, 5, 80))
      const ps = (layerState[i] as Particle[] | undefined) ?? makeParticles(n)
      layerState[i] = ps
      const size = clamp(layer.size, 4, 60) * SCALE
      const sp = clamp(layer.speed, 0.01, 1.5)
      const palette = (layer.colors ?? []).filter((x) => /^(#[0-9a-fA-F]{6}|main)$/.test(x)).map((x) => (x === 'main' ? main : hexToRgb(x)))
      const emit = layer.emit
      const life = clamp(layer.lifeSec, 0.2, 10)
      const grav = clamp(layer.gravity, -1, 1)
      ctx.lineWidth = Math.max(1, size * 0.15)
      for (const p of ps) {
        const col = palette.length > 0 ? palette[p.ci % palette.length] : c
        let x: number
        let y: number
        let fade = 1
        if (emit === 'burst') {
          // 中心から、四方へ広がる。重力で、下へ(負なら上へ)。寿命で、消える(一度きり)
          const age = t
          if (age > life) continue
          const d = sp * age * p.vary
          x = 0.5 + Math.cos(p.angle) * d * 0.5
          y = 0.5 + Math.sin(p.angle) * d * 0.5 + 0.5 * grav * age * age
          fade = Math.min(1, (1 - age / life) * 2)
        } else if (emit === 'fall') {
          const age = t
          if (age > life) continue
          y = ((p.y + t * sp * p.scale) % 1.2) - 0.1
          x = p.x + Math.sin(p.phase + t * 0.6) * 0.02
          fade = Math.min(1, (1 - age / life) * 2)
        } else {
          y = 1.1 - ((p.y + t * sp * p.scale) % 1.2)
          x = p.x + Math.sin(p.phase + t * 0.6) * 0.02
        }
        ctx.fillStyle = rgba(col, a * fade)
        ctx.strokeStyle = rgba(col, a * fade)
        shapePath(layer.shape, x * w, y * h, size * p.scale)
        if (layer.shape === 'ring') ctx.stroke()
        else ctx.fill()
      }
      break
    }
    case 'rings': {
      const n = Math.round(clamp(layer.count, 2, 10))
      const sp = clamp(layer.speed, 0.02, 0.3)
      const maxR = Math.hypot(w, h) / 2
      ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.01)
      for (let r = 0; r < n; r++) {
        const phase = (t * sp + r / n) % 1
        ctx.strokeStyle = rgba(c, a * (1 - phase))
        ctx.beginPath()
        ctx.arc(w / 2, h / 2, phase * maxR, 0, Math.PI * 2)
        ctx.stroke()
      }
      break
    }
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame)
  const p = payload
  if (!p) return
  const env = envelope(now, p)
  if (hiding !== null && env <= 0) {
    payload = null
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    return
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const t = (now - startedAt) / 1000
  const k = clamp(p.intensity, 0, 1) * env
  const main = hexToRgb(/^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#b388ff')
  p.spec.layers.slice(0, 6).forEach((layer, i) => drawLayer(layer, i, main, k, t))
}

window.vmaid.onOverlayShow((next) => {
  payload = next
  startedAt = performance.now()
  hiding = null
  layerState = []
  // キャラの近くだけのときは、窓の縁がはっきり見えないよう、楕円の形に、ふちをぼかす
  const mask = next.scope === 'character' || next.scope === 'rect' ? 'radial-gradient(ellipse closest-side, #000 55%, transparent 100%)' : 'none'
  canvas.style.maskImage = mask
  canvas.style.webkitMaskImage = mask
})
window.vmaid.onOverlayHide(() => {
  if (payload) hiding = performance.now()
})
requestAnimationFrame(frame)
