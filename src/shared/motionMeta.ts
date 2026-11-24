// モーションのタグ(メタデータ)の管理。Electron 非依存の純粋関数。
// 保存は userData/motion-meta.json に「モーション名 → タグ」で持つ(内蔵・パック・登録のすべてに付けられる)。
// 内蔵・パックが最初から持つタグ(既定のタグ)は、ここには保存せず、実効のタグは「既定 + 利用者が付けたもの」。

export const MAX_TAG_CHARS = 30
export const MAX_TAGS_PER_MOTION = 50

export type MotionTags = Record<string, string[]>

export interface MotionMeta {
  version: 1
  /** モーション名 → 利用者が付けたタグ(空の配列は持たない) */
  tags: MotionTags
}

export const emptyMeta = (): MotionMeta => ({ version: 1, tags: {} })

/** タグを整える: 前後の空白を除き、1〜30文字、制御文字・カンマ・読点を含まない。不正なら null */
export function normalizeTag(raw: string): string | null {
  const tag = raw.normalize('NFKC').trim()
  // eslint-disable-next-line no-control-regex
  if (tag === '' || [...tag].length > MAX_TAG_CHARS || /[\u0000-\u001f\u007f,、;;]/.test(tag)) return null
  return tag
}

/** 入力欄の文字列を、タグの一覧にする(カンマ・読点・空白・改行で区切る。不正なものは捨てる。重複は1つ) */
export function parseTagInput(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/[\s,、;;]+/)) {
    const t = normalizeTag(part)
    if (t !== null && !out.includes(t)) out.push(t)
  }
  return out
}

const uniq = (list: readonly string[]): string[] => [...new Set(list)]

/** 保存された生データから読む。壊れた項目は、その項目だけ捨てる(全体を捨てない) */
export function parseMeta(raw: unknown): MotionMeta {
  const meta = emptyMeta()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return meta
  const tags = (raw as { tags?: unknown }).tags
  if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) return meta
  for (const [name, list] of Object.entries(tags as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const clean = uniq(list.flatMap((t) => (typeof t === 'string' ? [normalizeTag(t)] : [])).filter((t): t is string => t !== null)).slice(0, MAX_TAGS_PER_MOTION)
    if (clean.length > 0) meta.tags[name] = clean
  }
  return meta
}

/** 名前の集まりに、タグを足す。変更が無ければ、同じオブジェクトを返す */
export function addTags(meta: MotionMeta, names: readonly string[], tags: readonly string[]): MotionMeta {
  const add = uniq(tags.flatMap((t) => (normalizeTag(t) ? [normalizeTag(t) as string] : [])))
  if (add.length === 0 || names.length === 0) return meta
  let changed = false
  const next: MotionTags = { ...meta.tags }
  for (const name of names) {
    const cur = next[name] ?? []
    const merged = uniq([...cur, ...add]).slice(0, MAX_TAGS_PER_MOTION)
    if (merged.length !== cur.length) {
      next[name] = merged
      changed = true
    }
  }
  return changed ? { version: 1, tags: next } : meta
}

/**
 * モーションごとに別のタグを、まとめて足す(取り込み時の、フォルダ名のタグなど)。
 * 1件ずつ addTags を呼ぶと、そのたびに全体をコピーして件数の2乗で遅くなるので、1回のコピーで済ませる
 */
export function addTagsEach(meta: MotionMeta, pairs: ReadonlyArray<readonly [string, readonly string[]]>): MotionMeta {
  let next: MotionTags | null = null
  for (const [name, tags] of pairs) {
    const add = uniq(tags.flatMap((t) => (normalizeTag(t) ? [normalizeTag(t) as string] : [])))
    if (add.length === 0) continue
    const cur = (next ?? meta.tags)[name] ?? []
    const merged = uniq([...cur, ...add]).slice(0, MAX_TAGS_PER_MOTION)
    if (merged.length === cur.length) continue
    next ??= { ...meta.tags }
    next[name] = merged
  }
  return next ? { version: 1, tags: next } : meta
}

/** 名前の集まりから、タグを外す(空になった項目は消す) */
export function removeTags(meta: MotionMeta, names: readonly string[], tags: readonly string[]): MotionMeta {
  const drop = new Set(tags)
  if (drop.size === 0 || names.length === 0) return meta
  let changed = false
  const next: MotionTags = { ...meta.tags }
  for (const name of names) {
    const cur = next[name]
    if (!cur) continue
    const rest = cur.filter((t) => !drop.has(t))
    if (rest.length === cur.length) continue
    changed = true
    if (rest.length === 0) delete next[name]
    else next[name] = rest
  }
  return changed ? { version: 1, tags: next } : meta
}

/** 名前の集まりのタグを、まとめて入れ替える(空にもできる) */
export function setTags(meta: MotionMeta, names: readonly string[], tags: readonly string[]): MotionMeta {
  const clean = uniq(tags.flatMap((t) => (normalizeTag(t) ? [normalizeTag(t) as string] : []))).slice(0, MAX_TAGS_PER_MOTION)
  const next: MotionTags = { ...meta.tags }
  for (const name of names) {
    if (clean.length === 0) delete next[name]
    else next[name] = [...clean]
  }
  return { version: 1, tags: next }
}

/** タグそのものを、全モーションで付け替える(名前の変更。変更後が既にあれば、まとまる)。from が無ければ、同じオブジェクト */
export function renameTag(meta: MotionMeta, from: string, to: string): MotionMeta {
  const target = normalizeTag(to)
  if (target === null || target === from) return meta
  let changed = false
  const next: MotionTags = {}
  for (const [name, list] of Object.entries(meta.tags)) {
    if (list.includes(from)) {
      next[name] = uniq(list.map((t) => (t === from ? target : t)))
      changed = true
    } else {
      next[name] = list
    }
  }
  return changed ? { version: 1, tags: next } : meta
}

/** タグそのものを、全モーションから消す */
export function deleteTag(meta: MotionMeta, tag: string): MotionMeta {
  const names = Object.entries(meta.tags).filter(([, l]) => l.includes(tag)).map(([n]) => n)
  return removeTags(meta, names, [tag])
}

/** モーション名の変更に、タグを追従させる(変更後の名前に、元のタグを移す。変更後に既にあるタグとは合わせる) */
export function renameMotionTags(meta: MotionMeta, from: string, to: string): MotionMeta {
  const cur = meta.tags[from]
  if (!cur || from === to) return meta
  const next: MotionTags = { ...meta.tags }
  delete next[from]
  next[to] = uniq([...(next[to] ?? []), ...cur]).slice(0, MAX_TAGS_PER_MOTION)
  return { version: 1, tags: next }
}

/** モーションを外すとき、その名前のタグを消す */
export function removeMotionTags(meta: MotionMeta, names: readonly string[]): MotionMeta {
  const drop = names.filter((n) => n in meta.tags)
  if (drop.length === 0) return meta
  const next: MotionTags = { ...meta.tags }
  for (const n of drop) delete next[n]
  return { version: 1, tags: next }
}

/** 実効のタグ(既定のタグ + 利用者が付けたタグ。重複なし、既定が先) */
export function effectiveTags(defaults: readonly string[] | undefined, user: readonly string[] | undefined): string[] {
  return uniq([...(defaults ?? []), ...(user ?? [])])
}

export interface TagCount {
  tag: string
  count: number
}

/** 名前の集まりについて、タグごとの件数(多い順、同数なら名前順) */
export function tagCounts(tagsByName: Readonly<Record<string, readonly string[]>>, names: readonly string[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const n of names) for (const t of tagsByName[n] ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'))
}

/** そのタグが付いているモーション名(names の順) */
export function namesWithTag(tagsByName: Readonly<Record<string, readonly string[]>>, tag: string, names: readonly string[]): string[] {
  return names.filter((n) => tagsByName[n]?.includes(tag))
}

/** 取り込むパスから、サブフォルダ名のタグを作る(root からの相対のフォルダ名。root 直下のファイルはタグなし)。不正な名前は捨てる */
export function folderTags(root: string, filePath: string): string[] {
  const split = (p: string): string[] => p.split(/[\\/]+/).filter((s) => s !== '')
  const r = split(root)
  const f = split(filePath).slice(0, -1) // ファイル名を除く
  if (f.length <= r.length) return []
  return uniq(f.slice(r.length).flatMap((s) => (normalizeTag(s) ? [normalizeTag(s) as string] : [])))
}

/** フォルダ名(ファイルが入っている直近のフォルダ)をタグにする。複数ファイルの取り込み用 */
export function parentFolderTag(filePath: string): string[] {
  const dir = filePath.split(/[\\/]+/).filter((s) => s !== '').slice(-2, -1)[0]
  const t = dir ? normalizeTag(dir) : null
  return t ? [t] : []
}
