/**
 * ルールの「対象のキャラ」の編集。characters が未指定(または空)は、すべてのキャラで動く意味。
 * 画面では、未指定のとき全員にチェックを付けて見せる。
 */

/** 画面に出すチェック済みの id(未指定なら全員) */
export function checkedCharacters(current: string[] | undefined, allIds: string[]): string[] {
  return current && current.length > 0 ? current : allIds
}

/**
 * 1人のチェックを切り替えたあとの characters。
 * 全員が揃う・誰もいなくなる場合は未指定(= すべてのキャラ)に戻す。
 */
export function toggleRuleCharacter(current: string[] | undefined, allIds: string[], id: string, on: boolean): string[] | undefined {
  const checked = checkedCharacters(current, allIds)
  const next = on ? (checked.includes(id) ? checked : [...checked, id]) : checked.filter((c) => c !== id)
  return normalizeCharacters(next, allIds)
}

/** 全員が揃っている・空なら未指定にする(後から増えたキャラも対象になる) */
export function normalizeCharacters(ids: string[], allIds: string[]): string[] | undefined {
  if (ids.length === 0) return undefined
  const all = allIds.length > 0 && allIds.every((a) => ids.includes(a))
  return all ? undefined : ids
}
