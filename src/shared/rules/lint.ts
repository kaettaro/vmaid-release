import { analyzeRuleSet, describeProblem, type RuleRegistry } from './registry'
import { hasTemplate } from './template'
import type { RuleIssue, RuleSet } from './types'

// 「書き方は正しいが、中身が変」なものの検出(警告)。エラーではないので、保存はできる。
// 例: 登録されていないモーションを指している(再生されない)、モーションが1つも無いタグ、重複する言葉。

export interface LintContext {
  /** 登録済みのモーション名 */
  motions: readonly string[]
  /** タグごとの、モーションの数(タグを指定した playMotion が、再生できるか調べる)。省略すると、タグは調べない */
  tagCounts?: ReadonlyArray<{ tag: string; count: number }>
  /** 存在するキャラのid(あれば、ルールの characters に、存在しないキャラがないか調べる) */
  characterIds?: readonly string[]
  /** 使える種類の定義(機能 Mod の ON/OFF)。あれば、OFF の Mod の種類を使うルールを警告する */
  registry?: RuleRegistry
}

export function lintRuleSet(rs: RuleSet, ctx: LintContext): RuleIssue[] {
  const warnings: RuleIssue[] = []
  const motions = new Set(ctx.motions)

  const tagCount = ctx.tagCounts ? new Map(ctx.tagCounts.map((t) => [t.tag, t.count])) : null

  const characterIds = ctx.characterIds ? new Set(ctx.characterIds) : null
  if (ctx.registry) {
    const index = new Map(rs.rules.map((r, i) => [r.id, i]))
    for (const [id, problems] of analyzeRuleSet(rs, ctx.registry)) {
      warnings.push({ path: `rules[${index.get(id)}]`, message: `ルール「${id}」は、いまは動きません。${[...new Set(problems.map(describeProblem))].join(' / ')}` })
    }
  }
  rs.rules.forEach((r, i) => {
    const unknown = characterIds ? (r.characters ?? []).filter((c) => !characterIds.has(c)) : []
    if (unknown.length > 0) {
      warnings.push({ path: `rules[${i}].characters`, message: `ルール「${r.id}」: キャラ ${unknown.join(', ')} は存在しないため、そのキャラでは動きません` })
    }
    r.do.forEach((a, j) => {
      if (a.action !== 'playMotion') return
      const path = `rules[${i}].do[${j}]`
      if (typeof a.motion === 'string' && !hasTemplate(a.motion) && !motions.has(a.motion)) {
        warnings.push({ path, message: `ルール「${r.id}」: モーション「${a.motion}」は登録されていないため、再生されません` })
      }
      if (typeof a.tag === 'string' && tagCount && !((tagCount.get(a.tag) ?? 0) > 0)) {
        warnings.push({ path, message: `ルール「${r.id}」: タグ「${a.tag}」が付いたモーションが1つも無いため、再生されません` })
      }
    })
    if (r.when.trigger === 'userMessage') {
      const kws = r.when.keywords as string[]
      if (new Set(kws).size !== kws.length) warnings.push({ path: `rules[${i}].when.keywords`, message: `ルール「${r.id}」: 同じ言葉が重複しています` })
    }
  })
  return warnings
}
