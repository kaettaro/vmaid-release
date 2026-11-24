// 画面効果(機能 Mod「画面効果」)の共有ロジック。Electron 非依存。
// 効果は「レイヤーの組み合わせ」というデータで表す(スクリプトは使わない)。組み込みの効果も、利用者が作る効果も、同じ形式。
import { parseDocument } from 'yaml'
import { z } from 'zod'

// --- 効果の定義(レイヤー) ---

/** 色: #rrggbb、または main(ルール・設定で指定した色。無ければ、効果の color) */
const ColorSchema = z.string().regex(/^(#[0-9a-fA-F]{6}|main)$/, '色は #rrggbb か main で書いてください')
const alpha = (d: number): z.ZodDefault<z.ZodNumber> => z.number().min(0).max(1).default(d)

const LayerSchema = z.discriminatedUnion('type', [
  /** 渦巻き。速さは、1秒あたりの回転数(±0.3 まで。ゆっくり) */
  z.object({
    type: z.literal('spiral'),
    color: ColorSchema.default('main'),
    alpha: alpha(0.55),
    arms: z.number().int().min(1).max(8).default(2),
    speed: z.number().min(-0.3).max(0.3).default(0.08),
    turns: z.number().min(3).max(20).default(9)
  }),
  /** 霧。やわらかい円がゆっくり漂う */
  z.object({
    type: z.literal('fog'),
    color: ColorSchema.default('main'),
    alpha: alpha(0.5),
    blobs: z.number().int().min(3).max(16).default(8),
    size: z.number().min(0.15).max(0.8).default(0.35),
    speed: z.number().min(0).max(0.2).default(0.03)
  }),
  /** 周辺を暗く(色づける) */
  z.object({ type: z.literal('vignette'), color: ColorSchema.default('main'), alpha: alpha(0.9), inner: z.number().min(0).max(0.9).default(0.25) }),
  /** ゆっくり明るさが変わる(点滅は避ける: 0.5Hz まで) */
  z.object({ type: z.literal('pulse'), color: ColorSchema.default('main'), alpha: alpha(0.5), hz: z.number().min(0.05).max(0.5).default(0.3) }),
  /** 全体を色で覆う */
  z.object({ type: z.literal('fill'), color: ColorSchema.default('main'), alpha: alpha(0.5) }),
  /** 粒。既定は、ゆっくり上へ漂う。emit で、中心から広がる(burst)・降る(fall)も選べる。colors があれば、粒ごとにランダムな色 */
  z.object({
    type: z.literal('particles'),
    color: ColorSchema.default('main'),
    /** 複数の色(粒ごとに、ランダム)。あれば、color の代わりに使う */
    colors: z.array(ColorSchema).max(6).optional(),
    alpha: alpha(0.6),
    shape: z.enum(['dot', 'heart', 'star', 'ring', 'square', 'diamond', 'spark']).default('dot'),
    count: z.number().int().min(5).max(80).default(30),
    size: z.number().min(4).max(60).default(16),
    /** rise / fall: 1 秒に、窓の高さの何割 / burst: 窓の大きさの何割を、1 秒で広がるか */
    speed: z.number().min(0.01).max(1.5).default(0.05),
    emit: z.enum(['rise', 'burst', 'fall']).default('rise'),
    /** burst・fall の、粒の寿命(秒)。過ぎると、消える */
    lifeSec: z.number().min(0.2).max(10).default(1.2),
    /** burst の重力(窓の高さの何割/秒²。正で、下へ) */
    gravity: z.number().min(-1).max(1).default(0)
  }),
  /** 中心から広がる輪 */
  z.object({
    type: z.literal('rings'),
    color: ColorSchema.default('main'),
    alpha: alpha(0.5),
    count: z.number().int().min(2).max(10).default(5),
    speed: z.number().min(0.02).max(0.3).default(0.08)
  })
])

export type EffectLayer = z.infer<typeof LayerSchema>
export const LAYER_TYPES = ['spiral', 'fog', 'vignette', 'pulse', 'fill', 'particles', 'rings'] as const

export const MAX_LAYERS = 6
export const MAX_EFFECT_YAML_BYTES = 8 * 1024

const EffectSchema = z.object({
  /** 一覧に出す名前 */
  label: z.string().trim().min(1).max(40).optional(),
  /** 主な色(ルール・設定で色を指定しなかったときに使う。レイヤーの color: main に使われる) */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '色は #rrggbb で書いてください').default('#b388ff'),
  layers: z.array(LayerSchema).min(1, 'layers を1つ以上書いてください').max(MAX_LAYERS, `layers は ${MAX_LAYERS} 個までです`)
})

export type EffectSpec = z.infer<typeof EffectSchema>

/** 効果の名前(ルール・設定・ファイル名に使う) */
export const EFFECT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/** 効果の YAML を検証して読む。エラーは、直し方が分かる日本語で返す */
export function parseEffectYaml(text: string): { spec: EffectSpec | null; errors: string[] } {
  if (text.length > MAX_EFFECT_YAML_BYTES) return { spec: null, errors: [`大きすぎます(${MAX_EFFECT_YAML_BYTES / 1024}KB まで)`] }
  const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true })
  if (doc.errors.length > 0) return { spec: null, errors: doc.errors.map((e) => `YAML の書き方が正しくありません: ${e.message.split('\n')[0]}`) }
  const r = EffectSchema.safeParse(doc.toJS())
  if (r.success) return { spec: r.data, errors: [] }
  return { spec: null, errors: r.error.issues.map((i) => `${i.path.join('.') || '(最上位)'}: ${i.message}`) }
}

/** 組み込みの効果(YAML で持つ。利用者が「コピーして作る」ときの雛形にもなる) */
export const BUILTIN_EFFECT_YAML: Record<string, string> = {
  spiral: `label: 渦巻き
color: "#b388ff"
layers:
  - { type: spiral, alpha: 0.55, arms: 2, speed: 0.08, turns: 9 }
`,
  'pink-fog': `label: ピンクの霧
color: "#ff8ac8"
layers:
  - { type: fog, alpha: 0.85, blobs: 9, size: 0.45, speed: 0.03 }
  - { type: vignette, alpha: 0.5, inner: 0.35 }
`,
  hearts: `label: ハートが漂う
color: "#ff6fae"
layers:
  - { type: vignette, alpha: 0.35, inner: 0.4 }
  - { type: particles, shape: heart, alpha: 0.7, count: 24, size: 22, speed: 0.04 }
`,
  rings: `label: 広がる輪
color: "#7fd1ff"
layers:
  - { type: rings, alpha: 0.5, count: 5, speed: 0.07 }
`,
  pulse: `label: 脈動
color: "#b388ff"
layers:
  - { type: pulse, alpha: 0.5, hz: 0.3 }
`,
  vignette: `label: 周辺を暗くする
color: "#101030"
layers:
  - { type: vignette, alpha: 0.9, inner: 0.25 }
`,
  fade: `label: 色で覆う
color: "#101030"
layers:
  - { type: fill, alpha: 0.8 }
`
}

export const BUILTIN_EFFECT_NAMES = Object.keys(BUILTIN_EFFECT_YAML)

export function builtinEffect(name: string): EffectSpec | null {
  const y = BUILTIN_EFFECT_YAML[name]
  return y ? parseEffectYaml(y).spec : null
}

// --- 出す指示 ---

export const OVERLAY_SCOPES = ['screen', 'character'] as const
/** ルール・設定から選べる範囲: screen = すべての画面 / character = キャラの近くだけ。(main が内部で使う rect = 指定した矩形だけ。ワープの演出用。ルールからは選べない) */
export type OverlayScope = (typeof OVERLAY_SCOPES)[number] | 'rect'

/** ルール・設定から来る指示(効果は名前で指す) */
export interface OverlayRequest {
  effect: string
  /** 濃さ(0〜1) */
  intensity: number
  /** 色(#rrggbb)。空なら、効果の主な色 */
  color: string
  /** 出しておく秒数(0 なら「画面効果を消す」まで) */
  durationSec: number
  scope: OverlayScope
}

/** 効果の中身を解決した、描く側へ渡す指示 */
export interface OverlayPayload {
  spec: EffectSpec
  intensity: number
  /** 解決済みの主な色(#rrggbb) */
  color: string
  durationSec: number
  scope: OverlayScope
  /** scope が rect のとき: 効果を出す矩形(画面上の絶対座標。DIP) */
  rects?: Array<{ x: number; y: number; width: number; height: number }>
  /** true なら、出るときの、ゆっくりした現れ方をしない(すぐ描く。ワープの演出など) */
  instant?: boolean
}

/** 出しっぱなしにできる上限(0 = 消すまで、は許すが、ルール側の指定は 1 時間まで) */
export const OVERLAY_MAX_SEC = 3600

export const OVERLAY_DEFAULTS: OverlayRequest = { effect: 'spiral', intensity: 0.6, color: '', durationSec: 0, scope: 'screen' }

const COLOR = /^#[0-9a-fA-F]{6}$/

/** 信頼できない入力(ルール・IPC)を、安全な範囲に丸める。効果の名前の形が不正なら null(存在するかは、呼ぶ側が確かめる) */
export function sanitizeOverlayRequest(raw: unknown): OverlayRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.effect !== 'string' || !EFFECT_NAME_RE.test(o.effect)) return null
  const num = (v: unknown, fallback: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
  return {
    effect: o.effect,
    intensity: num(o.intensity, OVERLAY_DEFAULTS.intensity, 0, 1),
    color: typeof o.color === 'string' && COLOR.test(o.color) ? o.color.toLowerCase() : '',
    durationSec: num(o.durationSec, OVERLAY_DEFAULTS.durationSec, 0, OVERLAY_MAX_SEC),
    scope: o.scope === 'character' ? 'character' : 'screen'
  }
}

/** 指示と効果の定義から、描く側へ渡すものを作る */
export function toPayload(req: OverlayRequest, spec: EffectSpec): OverlayPayload {
  return { spec, intensity: req.intensity, color: (req.color || spec.color).toLowerCase(), durationSec: req.durationSec, scope: req.scope }
}

/** キャラの近くに出すときの範囲: キャラのウィンドウを、左右に 80%・上下に 30% ずつ広げた矩形 */
export function characterOverlayBounds(win: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const px = Math.round(win.width * 0.8)
  const py = Math.round(win.height * 0.3)
  return { x: win.x - px, y: win.y - py, width: win.width + px * 2, height: win.height + py * 2 }
}

// --- 設定画面と main のやり取り ---

export interface OverlayEffectInfo {
  name: string
  label: string
  /** 組み込み(編集・削除できない。コピーして作る) */
  builtin: boolean
  yaml: string
  /** 読み込めなかったときの理由(利用者が手で置いたファイルの不備) */
  error: string | null
}

export interface OverlayEffectResult {
  ok: boolean
  message: string
  effects: OverlayEffectInfo[]
}

/** ワープの演出: 設定から、粒の効果を作る(画面効果の仕組みで描く) */
export function warpEffectSpec(fx: { shape: string; colors: readonly string[]; count: number; size: number; durationMs: number; mode: string; speed: number; gravity: number }): EffectSpec {
  const r = EffectSchema.safeParse({
    color: fx.colors[0] ?? '#b388ff',
    layers: [
      {
        type: 'particles',
        colors: [...fx.colors],
        alpha: 0.95,
        shape: fx.shape,
        count: fx.count,
        size: fx.size,
        speed: fx.speed,
        emit: fx.mode,
        lifeSec: Math.max(0.2, fx.durationMs / 1000),
        gravity: fx.gravity
      }
    ]
  })
  if (r.success) return r.data
  return EffectSchema.parse({ layers: [{ type: 'particles' }] })
}

/** 矩形を、窓の大きさの何割か外側へ広げる(粒が、窓の縁で切れないように) */
export function expandRect(r: { x: number; y: number; width: number; height: number }, ratio: number): { x: number; y: number; width: number; height: number } {
  const px = Math.round(r.width * ratio)
  const py = Math.round(r.height * ratio)
  return { x: r.x - px, y: r.y - py, width: r.width + px * 2, height: r.height + py * 2 }
}
