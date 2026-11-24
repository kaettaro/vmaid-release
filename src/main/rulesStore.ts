import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { motionReferences, renameMotionInRuleSet, renameTagInRuleSet, rulesUsingTag } from '../shared/rules/edit'
import { convertLegacyGroupsYaml, type LegacyGroups } from '../shared/rules/legacyGroups'
import { formatIssue, parseRuleSetYaml, stringifyRuleSet } from '../shared/rules/yaml'

/** 空のマイルール。はじめから入っている反応は、公式の「基本」Mod にある */
export const EMPTY_RULES_YAML = `# マイルール(自作のルール)。ルールタブで追加・編集できます。
# はじめから入っている反応は、Mod タブの公式「基本」Mod にあります。
version: 1
rules: []
`

/** ルールファイル userData/rules.yaml(マイルール)の読み書き。無ければ、空のルールを書き出す */
export class RulesStore {
  readonly path = join(app.getPath('userData'), 'rules.yaml')

  /** ファイルの内容(無ければ、空のルールを書き出してから返す) */
  read(): string {
    if (!existsSync(this.path)) this.writeRaw(EMPTY_RULES_YAML)
    try {
      return readFileSync(this.path, 'utf-8')
    } catch {
      return EMPTY_RULES_YAML
    }
  }

  /** 検証に通ったときだけ保存する。通らなければ保存せず、エラーを返す(不正なYAMLでルールが壊れないように) */
  save(text: string): { ok: true } | { ok: false; errors: string[] } {
    const r = parseRuleSetYaml(text)
    if (!r.ruleSet) return { ok: false, errors: r.issues.map(formatIssue) }
    this.writeRaw(text)
    return { ok: true }
  }

  /**
   * モーション名が変わったとき、ルール(`motion:`)の参照も書き換える。
   * 参照していなければ、ファイルには触れない(コメントを残す)。YAMLが不正で読めない場合は、触らずに知らせる。
   */
  renameMotionReferences(from: string, to: string): { changed: boolean; rules: string[]; error?: string } {
    const parsed = parseRuleSetYaml(this.read())
    if (!parsed.ruleSet) return { changed: false, rules: [], error: 'ルールファイルが読めないため、ルールの参照は書き換えませんでした' }
    const refs = motionReferences(parsed.ruleSet, from)
    if (refs.rules.length === 0) return { changed: false, ...refs }
    this.writeRaw(stringifyRuleSet(renameMotionInRuleSet(parsed.ruleSet, from, to)))
    return { changed: true, ...refs }
  }

  /** モーションのタグの名前が変わったとき、ルール(`tag:`)の参照も書き換える(参照していなければ、ファイルには触れない) */
  renameTagReferences(from: string, to: string): { changed: boolean; rules: string[]; error?: string } {
    const parsed = parseRuleSetYaml(this.read())
    if (!parsed.ruleSet) return { changed: false, rules: [], error: 'ルールファイルが読めないため、ルールの参照は書き換えませんでした' }
    const rules = rulesUsingTag(parsed.ruleSet, from)
    if (rules.length === 0) return { changed: false, rules }
    this.writeRaw(stringifyRuleSet(renameTagInRuleSet(parsed.ruleSet, from, to)))
    return { changed: true, rules }
  }

  /**
   * 旧形式のモーショングループ(motionGroups・group)が、ファイルに残っていれば、タグへ変換して書き直す。
   * 元のファイルは rules.yaml.groups.bak に残す。変換したなら、グループ → タグの割り当てを返す(呼び出し側が、モーションにタグを付ける)
   */
  migrateLegacyGroups(): LegacyGroups | null {
    if (!existsSync(this.path)) return null
    let text: string
    try {
      text = readFileSync(this.path, 'utf-8')
    } catch {
      return null
    }
    const converted = convertLegacyGroupsYaml(text)
    if (!converted) return null
    try {
      writeFileSync(`${this.path}.groups.bak`, text, 'utf-8')
    } catch {
      // バックアップに失敗しても、変換は続ける
    }
    this.writeRaw(converted.text)
    return converted.legacy
  }

  /** マイルールを空にする。今のファイルは .bak に残す */
  reset(): void {
    if (existsSync(this.path)) {
      try {
        writeFileSync(`${this.path}.bak`, readFileSync(this.path, 'utf-8'), 'utf-8')
      } catch {
        // バックアップに失敗しても、初期化は続ける
      }
    }
    this.writeRaw(EMPTY_RULES_YAML)
  }

  private writeRaw(text: string): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, text, 'utf-8')
    renameSync(tmp, this.path) // 書き込み途中で壊れないよう、一時ファイル経由
  }
}
