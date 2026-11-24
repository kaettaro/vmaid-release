import { z } from 'zod'

// 内蔵LLMのモデル登録表(resources/models.json)と、その扱い。Electron非依存の純粋ロジック。

export const ModelEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string(),
  family: z.string(),
  /** 既定候補にできるのは寛容ライセンスのみ(CLAUDE.md)。ここでは表示用の文字列 */
  license: z.string(),
  url: z.string().url().refine((u) => u.startsWith('https://'), 'https のみ'),
  /** SHA-256(16進・小文字)。ダウンロード後に必ず検証する */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().positive(),
  quant: z.string(),
  contextLength: z.number().int().positive(),
  /** 動かすのに必要なメモリの目安(GB) */
  minRamGB: z.number().positive(),
  notes: z.string().default('')
})

export const RegistrySchema = z.object({
  version: z.literal(1),
  models: z.array(ModelEntrySchema).min(1)
})

export type ModelEntry = z.infer<typeof ModelEntrySchema>

export function parseRegistry(raw: unknown): ModelEntry[] {
  const parsed = RegistrySchema.parse(raw)
  const ids = new Set<string>()
  for (const m of parsed.models) {
    if (ids.has(m.id)) throw new Error(`モデルIDが重複しています: ${m.id}`)
    ids.add(m.id)
  }
  return parsed.models
}

/** 大きいモデルを既定にしてよいメモリ量(GB)。macOSの統合メモリではGPUが使えるのは全体の約7割のため余裕を見る */
export const BIG_MODEL_MIN_TOTAL_RAM_GB = 16

/**
 * PCのメモリに合わせた既定モデル。メモリが十分あれば最も大きい(=高品質な)モデル、足りなければ
 * 動かせる中で最大のモデル。どれも動かせない場合は最小のモデル(動かない可能性は呼び出し側で警告)。
 * @param preferred 既定候補の優先順(ID)。先に挙げたものを、動かせるなら優先する
 */
export function pickDefaultModel(models: ModelEntry[], totalRamGB: number, preferred: string[] = []): ModelEntry {
  const fits = models.filter((m) => m.minRamGB <= totalRamGB)
  if (fits.length === 0) return [...models].sort((a, b) => a.sizeBytes - b.sizeBytes)[0]
  // 16GB以上の機種は、優先順の先頭(高品質)を。それ未満は「動かせる中で最小ではなく、軽量モデルを優先」するため、
  // 優先順のうち動かせるものの中から、メモリに余裕のある(minRamGB×1.5 以内)ものを選ぶ
  const roomy = totalRamGB >= BIG_MODEL_MIN_TOTAL_RAM_GB ? fits : fits.filter((m) => m.minRamGB * 1.0 <= totalRamGB - 1.5)
  const pool = roomy.length > 0 ? roomy : fits
  for (const id of preferred) {
    const m = pool.find((x) => x.id === id)
    if (m) return m
  }
  return [...pool].sort((a, b) => b.sizeBytes - a.sizeBytes)[0]
}

/** ダウンロード先ファイル名。IDから決める(URL由来の文字列をパスに使わない) */
export function modelFileName(entry: Pick<ModelEntry, 'id'>): string {
  return `${entry.id}.gguf`
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  return `${Math.round(n / 1e3)} KB`
}
