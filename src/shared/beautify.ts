// 機能 Mod「美化(リアル)」「美化(トゥーン)」の設定と、純粋なロジック。Electron・three に依存しない。
// どちらも、モデルの描画(ライト・陰影・後処理)を変えるだけ。通信しない・ファイルを書き換えない。同時に ON にできるのは、どちらか一方。

import { z } from 'zod'

export const BEAUTIFY_REAL_ID = 'beautify-real'
export const BEAUTIFY_TOON_ID = 'beautify-toon'

const clamp = (n: number, lo: number, hi: number): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)
const num = (lo: number, hi: number, def: number) => z.number().catch(def).transform((n) => clamp(n, lo, hi))

export const RealSchema = z.object({
  /** 選んだプリセットの名前(表示用。値を触ると 'custom') */
  preset: z.string().max(30).catch('natural'),
  /** 主光(キーライト)の強さ(1 = 標準の明るさ)・色温度(K。低いほど暖かい)・向き(左右 -90〜90 度 / 高さ 0〜85 度) */
  keyIntensity: num(0, 3, 0.75),
  keyTemp: num(2500, 10000, 5200),
  keyAzimuth: num(-90, 90, 25),
  keyElevation: num(0, 85, 35),
  /** 補助光(影側を起こす)・輪郭光(背後からの縁の光)・環境光 */
  fillIntensity: num(0, 2, 0.25),
  rimIntensity: num(0, 3, 0.5),
  ambient: num(0, 2, 0.8),
  /** 露出・階調(トーンマッピング)・彩度 */
  exposure: num(0.4, 2.5, 1),
  tonemap: z.enum(['none', 'aces']).catch('aces'),
  saturation: num(0.5, 1.6, 1.3),
  /** 影のやわらかさ(0 = もとの陰影、1 = なめらかな陰影。VRM の MToon のみ) */
  softShading: num(0, 1, 0.6),
  /** 自分の体や髪が落とす影(キャラの外には落とさない)・その濃さ */
  shadow: z.boolean().catch(true),
  shadowStrength: num(0, 1, 0.6),
  /** 明るい所のにじみ(ブルーム)。キャラの輪郭の外へはにじませない(クリック透過を壊さないため) */
  bloom: num(0, 1.5, 0.2),
  bloomThreshold: num(0.3, 1.5, 0.85),
  bloomRadius: num(0, 1, 0.5)
})

export const ToonSchema = z.object({
  preset: z.string().max(30).catch('anime'),
  lightIntensity: num(0, 3, 1),
  lightAzimuth: num(-90, 90, 20),
  lightElevation: num(0, 85, 40),
  ambient: num(0, 2, 1),
  /** 影の位置(-1〜1。大きいほど、影が増える)・影の境目のくっきり度(0 = ぼかす、1 = くっきり) */
  shadeShift: num(-1, 1, 0.1),
  shadeEdge: num(0, 1, 0.9),
  /** 縁の光(リムライト)の強さ・輪郭線の太さの倍率(0 = 輪郭線なし。輪郭線を持つモデルだけ) */
  rim: num(0, 1, 0.4),
  outline: num(0, 3, 1),
  saturation: num(0.5, 1.8, 1.15)
})

export type RealParams = z.infer<typeof RealSchema>
export type ToonParams = z.infer<typeof ToonSchema>

export const REAL_PRESETS: Record<string, { label: string; values: Partial<RealParams> }> = {
  natural: { label: 'ナチュラル', values: {} },
  studio: { label: 'スタジオ', values: { keyIntensity: 1, keyTemp: 6200, fillIntensity: 0.45, rimIntensity: 0.8, ambient: 0.9, exposure: 1.05, saturation: 1.25, bloom: 0.15, shadowStrength: 0.5 } },
  cinematic: { label: 'シネマ', values: { keyIntensity: 1.2, keyTemp: 4400, keyAzimuth: 45, keyElevation: 25, fillIntensity: 0.12, rimIntensity: 1.2, ambient: 0.45, exposure: 0.95, saturation: 1.1, bloom: 0.4, bloomThreshold: 0.75, shadowStrength: 0.8 } }
}

export const TOON_PRESETS: Record<string, { label: string; values: Partial<ToonParams> }> = {
  anime: { label: 'アニメ調', values: {} },
  soft: { label: 'ソフト', values: { shadeEdge: 0.45, shadeShift: 0.15, rim: 0.2, outline: 0.7, saturation: 1 } },
  crisp: { label: 'くっきり', values: { shadeEdge: 1, shadeShift: -0.1, rim: 0.4, outline: 1.6, saturation: 1.3, lightIntensity: 1.15 } }
}

/** プリセットの全項目(未指定は、既定値) */
export function presetValues(kind: 'real' | 'toon', name: string): RealParams | ToonParams {
  if (kind === 'real') return RealSchema.parse({ ...REAL_PRESETS[name]?.values, preset: REAL_PRESETS[name] ? name : 'natural' })
  return ToonSchema.parse({ ...TOON_PRESETS[name]?.values, preset: TOON_PRESETS[name] ? name : 'anime' })
}

const obj = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}), schema)

export const BeautifySchema = z.object({
  real: obj(RealSchema),
  toon: obj(ToonSchema)
})

export type BeautifySettings = z.infer<typeof BeautifySchema>

/** 設定画面からの変更(一部の項目)。マージ後に BeautifySchema で整える */
export const BeautifyPatchSchema = z
  .object({
    real: z.record(z.string().max(30), z.unknown()).optional(),
    toon: z.record(z.string().max(30), z.unknown()).optional()
  })
  .strict()

export type BeautifyPatch = z.infer<typeof BeautifyPatchSchema>

/** レンダラーに渡す状態 */
export interface BeautifyView extends BeautifySettings {
  realEnabled: boolean
  toonEnabled: boolean
}

/** ステージに渡す、いま使う美化(どちらも OFF なら null) */
export type ResolvedBeautify = { mode: 'real'; p: RealParams } | { mode: 'toon'; p: ToonParams } | null

/** 両方 ON のときは、トゥーンを使う(通常は、片方を ON にすると、もう片方を OFF にする) */
export function resolveBeautify(v: Pick<BeautifyView, 'real' | 'toon' | 'realEnabled' | 'toonEnabled'>): ResolvedBeautify {
  if (v.toonEnabled) return { mode: 'toon', p: v.toon }
  if (v.realEnabled) return { mode: 'real', p: v.real }
  return null
}

/** 片方の美化 Mod を ON にするとき、もう片方を OFF にする(排他) */
export function exclusiveOff(id: string): string | null {
  if (id === BEAUTIFY_REAL_ID) return BEAUTIFY_TOON_ID
  if (id === BEAUTIFY_TOON_ID) return BEAUTIFY_REAL_ID
  return null
}

/** 色温度(K)を、光の色(0〜1 の RGB)にする(Tanner Helland の近似。白 = 6600K 付近) */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = clamp(kelvin, 1000, 40000) / 100
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const c = (v: number): number => clamp(v, 0, 255) / 255
  return [c(r), c(g), c(b)]
}

/** 光の向き: azimuth = 正面から右へ(度)、elevation = 水平から上へ(度)。カメラは +z から見ている。モデルへ向かう光源の位置(単位ベクトル) */
export function lightPosition(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
}
