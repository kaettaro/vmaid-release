// 機能 Mod「効果音(SE)」の設定と、純粋なロジック。Electron に依存しない(レンダラーと main の両方で使う)。
// 名前をつけた音ファイルを持ち、ルールのアクション「効果音を鳴らす」で鳴らす。曲(BGM)は、ダンス Mod 側(dance.ts)。

import { z } from 'zod'
import { normalizeText } from './rules/template'

/** 効果音の数の上限 */
export const MAX_SOUNDS = 200
/** 読み込む音ファイルの大きさの上限(バイト)。デコード後はもっと大きくなるので、長い曲のメモリ使用を抑える */
export const MAX_AUDIO_BYTES = 80 * 1024 * 1024
/** 選べる音ファイルの拡張子(Chromium がデコードできるもの) */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] as const

const clamp = (n: number, lo: number, hi: number): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)

export const SoundSchema = z.object({
  /** ルールで呼ぶ名前 */
  name: z.string().trim().min(1).max(40),
  /** 音ファイルのパス(利用者が選んだもの。素材は同梱しない) */
  path: z.string().min(1).max(1000),
  /** この音の音量(0〜1)。全体の音量にかけ合わせる */
  volume: z.number().catch(1).transform((n) => clamp(n, 0, 1))
})

export type Sound = z.infer<typeof SoundSchema>

/** 1件ずつ検証して、壊れたものだけを捨てる。同じ名前(正規化後)が重なったら、後のものを使う */
export function parseSounds(list: unknown): Sound[] {
  if (!Array.isArray(list)) return []
  const byName = new Map<string, Sound>()
  for (const e of list) {
    const r = SoundSchema.safeParse(e)
    if (r.success) byName.set(normalizeText(r.data.name), r.data)
  }
  return [...byName.values()].slice(0, MAX_SOUNDS)
}

export const SeSchema = z.object({
  sounds: z.unknown().catch([]).transform(parseSounds),
  /** 全体の音量(0〜1) */
  volume: z.number().catch(0.8).transform((n) => clamp(n, 0, 1))
})

export type SeSettings = z.infer<typeof SeSchema>

/** 設定画面からの変更(一部の項目) */
export const SePatchSchema = z
  .object({
    sounds: z.array(z.unknown()).max(MAX_SOUNDS * 2).optional(),
    volume: z.number().optional()
  })
  .strict()

export type SePatch = z.infer<typeof SePatchSchema>

/** レンダラーに渡す状態 */
export interface SeView extends SeSettings {
  /** 機能 Mod「効果音」が ON か */
  enabled: boolean
}

/** 名前から効果音を探す(全角・半角・大小文字・空白は区別しない) */
export function findSound(sounds: readonly Sound[], name: string): Sound | undefined {
  const key = normalizeText(name)
  return key === '' ? undefined : sounds.find((s) => normalizeText(s.name) === key)
}

/** 鳴らせる音ファイルか(拡張子) */
export function isAudioPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext)
}

/** スピーカーに出す音量 */
export function soundGain(master: number, volume: number): number {
  return clamp(master * volume, 0, 1)
}
