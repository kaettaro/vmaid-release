// モーション名の一覧と、名前から実体(どこのファイルか)を引く規則。Electron 非依存の純粋関数。
// 以前は、全モーションの VRMA のバイト列を毎回まとめて送っていた(数百MB級)。いまは名前だけを送り、
// 再生するときに1件ずつ読み込む。同じ名前が複数あるときは、あとのものが優先される(登録 > パック > 内蔵)。

export type MotionSource = 'library' | 'pack' | 'builtin'

/** 内蔵 → パック → 登録 の順に並べた、重複のない名前の一覧(最初に出た位置を保つ) */
export function mergeMotionNames(builtin: readonly string[], pack: readonly string[], library: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of [builtin, pack, library]) {
    for (const n of list) {
      if (seen.has(n)) continue
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

/** 名前の実体がどこにあるか(同名なら、登録 > パック > 内蔵)。どこにも無ければ null */
export function pickMotionSource(
  name: string,
  sources: { builtin: ReadonlySet<string>; pack: ReadonlySet<string>; library: ReadonlySet<string> }
): MotionSource | null {
  if (sources.library.has(name)) return 'library'
  if (sources.pack.has(name)) return 'pack'
  if (sources.builtin.has(name)) return 'builtin'
  return null
}

export interface MotionSourcesInput {
  builtin: readonly string[]
  /** 内蔵モーションが最初から持つタグ */
  builtinTags: Readonly<Record<string, readonly string[]>>
  pack: ReadonlyArray<{ name: string; path: string; tags: readonly string[] }>
  library: ReadonlyArray<{ name: string; path: string; faces?: string[] }>
  /** 利用者が付けたタグ(モーション名 → タグ) */
  userTags: Readonly<Record<string, readonly string[]>>
}

export interface MotionListItem {
  name: string
  origin: 'builtin' | 'pack' | 'user'
  path?: string
  /** VMD に足してある、表情の VMD のパス */
  faces?: string[]
  tags: string[]
  lockedTags: string[]
}

/**
 * 設定画面の一覧(内蔵 → パック → 登録の順。同名は1行で、出どころは 登録 > パック > 内蔵)。
 * タグは「最初から持つタグ(内蔵・パックの、外せないもの)+ 利用者が付けたもの」。登録モーションには、最初から持つタグは無い
 */
export function buildMotionList(input: MotionSourcesInput): MotionListItem[] {
  const packBy = new Map(input.pack.map((e) => [e.name, e]))
  const libBy = new Map(input.library.map((e) => [e.name, e]))
  const builtinSet = new Set(input.builtin)
  const names = mergeMotionNames(input.builtin, input.pack.map((e) => e.name), input.library.map((e) => e.name))
  return names.map((name) => {
    const lib = libBy.get(name)
    const pack = packBy.get(name)
    const origin = lib ? 'user' : pack ? 'pack' : builtinSet.has(name) ? 'builtin' : 'user'
    const locked = origin === 'pack' ? [...(pack?.tags ?? [])] : origin === 'builtin' ? [...(input.builtinTags[name] ?? [])] : []
    const user = input.userTags[name] ?? []
    const tags = [...new Set([...locked, ...user])]
    return { name, origin, ...(lib ? { path: lib.path } : {}), ...(lib?.faces && lib.faces.length > 0 ? { faces: lib.faces } : {}), tags, lockedTags: locked }
  })
}

/** モーション名 → 実効のタグ(タグが1つ以上あるものだけ) */
export function tagMapOf(items: readonly MotionListItem[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const it of items) if (it.tags.length > 0) out[it.name] = it.tags
  return out
}
