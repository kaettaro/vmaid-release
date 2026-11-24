// BVH のテキスト → VRMA(glTF Binary)。取り込み時に1回だけ変換して使う(再生側は VRMA のまま)。純粋関数。
import { parseBvh } from './bvh'
import { retargetBvh, type RetargetOptions, type RetargetReport } from './bvhRetarget'
import { buildVrmaFromTracks } from './builder'

/** 変換の仕様を変えたら上げる(変換済みキャッシュの名前に入れて、古い結果を使い回さない) */
export const BVH_CONVERTER_VERSION = 4

export type BvhConvertResult = { ok: true; vrma: Uint8Array; report: RetargetReport } | { ok: false; reason: string }

export function convertBvhToVrma(text: string, name: string, opts: RetargetOptions = {}): BvhConvertResult {
  const parsed = parseBvh(text)
  if (!parsed.ok) return parsed
  const r = retargetBvh(parsed.bvh, opts)
  if (!r.ok) return r
  const { times, bones, hipsTranslation } = r.tracks
  const vrma = buildVrmaFromTracks({ name, generator: 'VMaid BVH import', times, bones, hipsTranslation })
  return { ok: true, vrma, report: r.report }
}
