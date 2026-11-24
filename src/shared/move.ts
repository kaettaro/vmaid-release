// 機能 Mod「より自由な移動」の設定と、純粋なロジック(Electron・DOM に依存しない)。
// キャラのウィンドウを、画面の中で動かす: 歩く(歩行モーションをループしながら、ウィンドウをすべらせる)・ワープする(フェードで消えて、別の場所で現れる)。
// 移動先の選び方・歩く速さ・向き・ワープの段階は、ここで決める(main の MoveController が使う)。

import { z } from 'zod'
import type { Rect } from './geometry'

export const MOVE_ID = 'move'

const clamp = (n: number, lo: number, hi: number): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)
const num = (lo: number, hi: number, def: number) => z.number().catch(def).transform((n) => clamp(n, lo, hi))
const tag = (def: string) =>
  z
    .string()
    .catch(def)
    .transform((s) => s.trim().slice(0, 30))

const HEX = /^#[0-9a-fA-F]{6}$/
/** ワープの演出の、粒の形(画面効果の particles レイヤーと同じ) */
export const WARP_SHAPES = ['dot', 'heart', 'star', 'ring', 'square', 'diamond', 'spark'] as const
export type WarpShape = (typeof WARP_SHAPES)[number]
export const WARP_FX_MODES = ['burst', 'rise', 'fall'] as const
export const WARP_FX_WHERE = ['from', 'to', 'both'] as const

/** ワープの演出(任意の色・形の粒を、元の場所・新しい場所に出す) */
export const WarpFxSchema = z.object({
  enabled: z.boolean().catch(true),
  /** どこに出すか: from = 元いた場所 / to = 新しい場所 / both = 両方 */
  where: z.enum(WARP_FX_WHERE).catch('both'),
  shape: z.enum(WARP_SHAPES).catch('star'),
  /** 粒の色(複数なら、粒ごとにランダム)。#rrggbb */
  colors: z
    .array(z.string())
    .catch(['#b388ff', '#7fd1ff', '#ff8ac8'])
    .transform((l) => {
      const ok = l.filter((c) => HEX.test(c)).map((c) => c.toLowerCase())
      return (ok.length > 0 ? ok : ['#b388ff']).slice(0, 6)
    }),
  count: z.number().catch(40).transform((n) => Math.round(clamp(n, 5, 80))),
  size: num(4, 60, 18),
  /** 粒の出ている時間(ミリ秒) */
  durationMs: z.number().catch(1200).transform((n) => Math.round(clamp(n, 300, 5000))),
  /** burst = 中心から広がる / rise = 上へ漂う / fall = 降る */
  mode: z.enum(WARP_FX_MODES).catch('burst'),
  /** 広がる・漂う速さ(窓の大きさに対する、1 秒あたりの割合) */
  speed: num(0.02, 1.5, 0.45),
  /** 重力(正で、下へ落ちる。負で、上へ昇る) */
  gravity: num(-1, 1, 0.3)
})
export type WarpFx = z.infer<typeof WarpFxSchema>

/** 利用者が決めた、移動範囲の矩形(画面上の絶対座標。DIP) */
export const MAX_RECTS = 8
export const MIN_RECT_SIZE = 40
const RectListSchema = z
  .array(z.unknown())
  .catch([])
  .transform((list) => {
    const out: Rect[] = []
    for (const r of list) {
      if (typeof r !== 'object' || r === null) continue
      const o = r as Record<string, unknown>
      const [x, y, width, height] = [o.x, o.y, o.width, o.height].map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN))
      if ([x, y, width, height].some(Number.isNaN) || width < MIN_RECT_SIZE || height < MIN_RECT_SIZE || width > 100_000 || height > 100_000) continue
      out.push({ x, y, width, height })
      if (out.length >= MAX_RECTS) break
    }
    return out
  })

/** 信頼できない入力の矩形の並びを、安全な範囲に丸める */
export const sanitizeRects = (raw: unknown): Rect[] => RectListSchema.parse(raw)

export const MoveSchema = z.object({
  /** 動ける範囲の決め方: display = 画面(作業領域)/ rects = 画面上で決めた矩形 */
  areaMode: z.enum(['display', 'rects']).catch('display'),
  /** 画面上で決めた矩形(areaMode が rects のとき、キャラの窓が、この中に収まる) */
  rects: RectListSchema,
  warpFx: WarpFxSchema.catch(WarpFxSchema.parse({})),
  /** 放置しているとき、自動で歩き回る(ときどきワープする) */
  autoRoam: z.boolean().catch(false),
  /** 自動で動く間隔(秒)の、最短と最長 */
  roamMinSec: num(5, 3600, 30),
  roamMaxSec: num(5, 3600, 120),
  /** 自動のとき、歩かずに、ワープする割合(0〜1) */
  warpChance: num(0, 1, 0.2),
  /** 歩く速さ(画面上のピクセル/秒) */
  speed: num(40, 1200, 220),
  /** 動ける範囲: all = すべての画面 / current = いまいる画面だけ */
  area: z.enum(['all', 'current']).catch('all'),
  /** 画面の端からあける余白(ピクセル) */
  margin: num(0, 300, 20),
  /** 上下にも動く(オフなら、左右だけ。足元の高さは、そのまま) */
  freeVertical: z.boolean().catch(false),
  /** 歩くときに使うモーションのタグ(その中からランダムに 1 つ。無ければ、内蔵の「歩行」) */
  walkTag: tag('歩行'),
  /** ワープのあとに再生するモーションのタグ(その中からランダムに 1 つ。空なら、何も再生しない) */
  warpTag: tag('待機'),
  /** ワープの、消える・現れるのそれぞれの時間(ミリ秒) */
  warpFadeMs: num(100, 2000, 350)
})
export type MoveSettings = z.infer<typeof MoveSchema>
export const MovePatchSchema = MoveSchema.partial()
export type MovePatch = z.infer<typeof MovePatchSchema>

export interface MoveView extends MoveSettings {
  /** Mod が ON か */
  enabled: boolean
}

/** 移動先の種類(ルールのアクション「移動する」で選ぶ) */
export const MOVE_TARGETS = ['random', 'left', 'right', 'center', 'cursor'] as const
export type MoveTarget = (typeof MOVE_TARGETS)[number]
export const MOVE_MODES = ['walk', 'warp'] as const
export type MoveMode = (typeof MOVE_MODES)[number]

/** キャラ窓(レンダラー)へ送る、移動の状態 */
export type MoveMessage =
  /** 歩き始め。yaw は体の向き(度)、tag は歩行モーションのタグ */
  | { kind: 'walk'; yaw: number; tag: string }
  /** ワープの途中(out = 消えている / in = 現れている) */
  | { kind: 'warp'; phase: 'out' | 'in' }
  /** 動いていない。ended が true なら、移動が終わった(途中でやめたのではない)。warpTag は、ワープのあとに再生するモーションのタグ */
  | { kind: 'idle'; ended: boolean; mode: MoveMode | null; warpTag: string }

export interface Point {
  x: number
  y: number
}

/** 動くウィンドウが収まる、左上の位置の範囲(作業領域の内側。余白つき。収まらない大きさなら、中央に寄せる) */
export function positionRange(work: Rect, size: { width: number; height: number }, margin: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const lo = (start: number, len: number, need: number): number => (len - need >= 2 * margin ? start + margin : start + (len - need) / 2)
  const hi = (start: number, len: number, need: number): number => (len - need >= 2 * margin ? start + len - need - margin : start + (len - need) / 2)
  return { minX: lo(work.x, work.width, size.width), maxX: hi(work.x, work.width, size.width), minY: lo(work.y, work.height, size.height), maxY: hi(work.y, work.height, size.height) }
}

const overlapArea = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/** いまのウィンドウが、いちばん重なっている作業領域(どこにも重ならなければ、先頭) */
export function currentWorkArea(window: Rect, works: readonly Rect[]): Rect {
  let best = works[0]
  let bestArea = -1
  for (const w of works) {
    const a = overlapArea(window, w)
    if (a > bestArea) {
      best = w
      bestArea = a
    }
  }
  return best
}

export interface PickContext {
  /** いまのウィンドウの位置と大きさ */
  window: Rect
  /** すべての作業領域 */
  works: readonly Rect[]
  /** カーソルの位置(画面座標) */
  cursor: Point
  rng: () => number
  settings: Pick<MoveSettings, 'area' | 'margin' | 'freeVertical'>
  /** 利用者が決めた範囲(矩形)を使っているか。使っているときは、余白なしで、窓を、その中へ収める */
  constrained?: boolean
}

/** 移動先(ウィンドウの左上)を選ぶ。必ず、作業領域の中(余白つき)に収まる。作業領域が無ければ null */
export function pickTarget(kind: MoveTarget, ctx: PickContext): Point | null {
  if (ctx.works.length === 0) return null
  const size = { width: ctx.window.width, height: ctx.window.height }
  const here = currentWorkArea(ctx.window, ctx.works)
  // 動ける範囲: 「すべて」なら、画面の幅に比例して、ランダムに 1 つの画面を選ぶ(カーソルの近くは、カーソルのある画面)
  let work = here
  if (kind === 'cursor') {
    work = ctx.works.find((w) => ctx.cursor.x >= w.x && ctx.cursor.x < w.x + w.width && ctx.cursor.y >= w.y && ctx.cursor.y < w.y + w.height) ?? here
  } else if (ctx.settings.area === 'all' && ctx.works.length > 1) {
    const total = ctx.works.reduce((s, w) => s + w.width, 0)
    let r = ctx.rng() * total
    work = ctx.works[ctx.works.length - 1]
    for (const w of ctx.works) {
      r -= w.width
      if (r < 0) {
        work = w
        break
      }
    }
  }
  const range = positionRange(work, size, ctx.constrained ? 0 : ctx.settings.margin)
  const x = (() => {
    switch (kind) {
      case 'left':
        return range.minX
      case 'right':
        return range.maxX
      case 'center':
        return (range.minX + range.maxX) / 2
      case 'cursor':
        return ctx.cursor.x - size.width / 2 // ウィンドウの中央を、カーソルの横に
      default:
        return range.minX + ctx.rng() * (range.maxX - range.minX)
    }
  })()
  // 足元の高さ: 上下に動かないときは、いまのまま(別の画面へ移るときは、その画面の足元に)
  const keepY = work === here ? ctx.window.y : range.maxY
  const wanted = ctx.settings.freeVertical ? range.minY + ctx.rng() * (range.maxY - range.minY) : keepY
  // 上下に動かないときは、高さを、そのままにする(余白で範囲へ押し込むと、横に歩きながら、斜め上へずれる)。
  // 範囲を決めてあるとき・別の画面へ移るときだけは、範囲の中へ収める
  const y = ctx.settings.freeVertical || ctx.constrained || work !== here ? clamp(wanted, range.minY, range.maxY) : wanted
  return { x: Math.round(clamp(x, range.minX, range.maxX)), y: Math.round(y) }
}

/** 利用者が決めた矩形と、各画面の作業領域の、重なり(空でないものだけ)。矩形が、どの画面とも重ならなければ、空 */
export function rectWorks(rects: readonly Rect[], workAreas: readonly Rect[]): Rect[] {
  const out: Rect[] = []
  for (const r of rects) {
    for (const w of workAreas) {
      const x = Math.max(r.x, w.x)
      const y = Math.max(r.y, w.y)
      const right = Math.min(r.x + r.width, w.x + w.width)
      const bottom = Math.min(r.y + r.height, w.y + w.height)
      if (right - x >= 1 && bottom - y >= 1) out.push({ x, y, width: right - x, height: bottom - y })
    }
  }
  return out
}

/** 移動の長さ(ピクセル) */
export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

/** 歩く時間(ミリ秒)。短すぎる・長すぎる移動を避けるため、下限を設ける */
export function walkDurationMs(from: Point, to: Point, speed: number): number {
  return Math.max(400, (distance(from, to) / Math.max(1, speed)) * 1000)
}

/** 動き始めと止まりを、なめらかにする(0〜1 → 0〜1) */
export const easeInOut = (t: number): number => {
  const k = clamp(t, 0, 1)
  return k * k * (3 - 2 * k)
}

/** 歩いている最中の位置(経過 / 全体の時間) */
export function positionAt(from: Point, to: Point, elapsedMs: number, totalMs: number): Point {
  const k = easeInOut(totalMs <= 0 ? 1 : elapsedMs / totalMs)
  return { x: Math.round(from.x + (to.x - from.x) * k), y: Math.round(from.y + (to.y - from.y) * k) }
}

/** 歩く向きに合わせた、体の向き(度。正が画面の右)。ほとんど縦の移動なら、正面 */
export function facingYaw(from: Point, to: Point): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 0.5) return 0
  return dx > 0 ? 70 : -70
}

export type WarpPhase = 'out' | 'jump' | 'in' | 'done'

/** ワープの段階: 消える(fadeMs)→ 移る(一瞬)→ 現れる(fadeMs)。opacity は、ウィンドウの不透明度(0〜1) */
export function warpAt(elapsedMs: number, fadeMs: number): { phase: WarpPhase; opacity: number } {
  if (elapsedMs < fadeMs) return { phase: 'out', opacity: 1 - easeInOut(elapsedMs / fadeMs) }
  if (elapsedMs < fadeMs + 30) return { phase: 'jump', opacity: 0 }
  if (elapsedMs < fadeMs * 2 + 30) return { phase: 'in', opacity: easeInOut((elapsedMs - fadeMs - 30) / fadeMs) }
  return { phase: 'done', opacity: 1 }
}

/** 次の自動の移動までの待ち時間(ミリ秒)。最短・最長の間で、ランダム */
export function nextRoamDelayMs(s: Pick<MoveSettings, 'roamMinSec' | 'roamMaxSec'>, rng: () => number): number {
  const lo = Math.min(s.roamMinSec, s.roamMaxSec)
  const hi = Math.max(s.roamMinSec, s.roamMaxSec)
  return Math.round((lo + rng() * (hi - lo)) * 1000)
}

/** 自動の移動の方式: ワープの割合で、歩くか、ワープするか */
export function pickAutoMode(warpChance: number, rng: () => number): MoveMode {
  return rng() < warpChance ? 'warp' : 'walk'
}
