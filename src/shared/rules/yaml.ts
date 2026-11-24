import { isMap, isSeq, LineCounter, parseDocument, stringify, type Node } from 'yaml'
import { parseRuleSet } from './schema'
import type { RuleIssue, RuleSet } from './types'

// ルールのYAML入出力。不正なYAMLは保存・適用せず、エラーを行番号つきで返す(SPEC 6.4)。

export interface YamlParseResult {
  ruleSet: RuleSet | null
  issues: RuleIssue[]
}

/** パス(`rules[1].do[0].group`)を、YAMLの行番号に引き直す */
function lineForPath(root: Node | null, path: string, lc: LineCounter): number | undefined {
  if (!root || path === '') return undefined
  const parts = path.match(/[^.[\]]+/g) ?? []
  let node: unknown = root
  for (const part of parts) {
    if (isMap(node)) node = node.get(part, true)
    else if (isSeq(node)) node = node.get(Number(part), true)
    else break
    if (node === undefined) break
  }
  const range = (node as { range?: [number, number, number] } | undefined)?.range
  return range ? lc.linePos(range[0]).line : undefined
}

export function parseRuleSetYaml(text: string): YamlParseResult {
  const lc = new LineCounter()
  const doc = parseDocument(text, { lineCounter: lc, prettyErrors: false, uniqueKeys: true })
  const issues: RuleIssue[] = doc.errors.map((e) => ({
    path: '',
    message: `YAMLの書き方が正しくありません: ${e.message.split('\n')[0]}`,
    // prettyErrors を切っているため linePos は付かない。文字位置(pos)から行番号を求める
    line: e.pos ? lc.linePos(e.pos[0]).line : undefined
  }))
  if (issues.length > 0) return { ruleSet: null, issues }

  const result = parseRuleSet(doc.toJS())
  const withLines = result.issues.map((i) => ({ ...i, line: lineForPath(doc.contents as Node | null, i.path, lc) }))
  return { ruleSet: result.ruleSet, issues: withLines }
}

export const YAML_HEADER = `# VMaid のルール(if-then)。設定画面の「ルール」タブで編集するか、このファイルを直接編集できます。
# 設定画面で編集すると、このファイルは書き直され、ルールの途中のコメントは残りません(ルールの説明は description に書くと残ります)。
`

/** RuleSet をYAMLにする(GUI編集の保存用。YAML中のコメントは保持されないので、定型の説明を先頭に付ける) */
export function stringifyRuleSet(ruleSet: RuleSet): string {
  return YAML_HEADER + stringify(ruleSet, { lineWidth: 0 })
}

/** 「N行目: メッセージ」の形に整える(画面・ログ用) */
export function formatIssue(i: RuleIssue): string {
  return `${i.line ? `${i.line}行目: ` : ''}${i.message}${i.path ? ` [${i.path}]` : ''}`
}
