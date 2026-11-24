// モーションごとの、「それを使っているルール」の一覧(モーション一覧・再生ウィンドウに、割り当て済みのルールを出すため)。純粋ロジック。

import type { Rule } from './types'

/**
 * モーションの名前 → それを再生するルールの id の一覧(ルールの並び順。重複なし)。
 * 数えるもの: アクション playMotion の `motion`(名前の指定)と、`tag`(そのタグが付いたモーションすべて)。
 * 数えないもの: `{{slot:…}}` などのテンプレート(実行するまで決まらない)・playDance の楽曲の表。
 * tagsOf は、モーションの名前 → 実効のタグ。
 */
export function collectMotionRefs(rules: readonly Pick<Rule, 'id' | 'do'>[], tagsOf: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const add = (name: string, id: string): void => {
    const list = (out[name] ??= [])
    if (!list.includes(id)) list.push(id)
  }
  const byTag = new Map<string, string[]>()
  for (const [name, tags] of Object.entries(tagsOf)) for (const t of tags) byTag.set(t, [...(byTag.get(t) ?? []), name])
  for (const r of rules) {
    for (const a of r.do) {
      if (a.action !== 'playMotion') continue
      if (typeof a.motion === 'string' && a.motion !== '' && !a.motion.includes('{{')) add(a.motion, r.id)
      if (typeof a.tag === 'string' && a.tag !== '' && !a.tag.includes('{{')) for (const name of byTag.get(a.tag) ?? []) add(name, r.id)
    }
  }
  return out
}
