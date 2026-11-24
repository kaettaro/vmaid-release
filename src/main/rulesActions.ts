import { readFileSync, writeFileSync } from 'node:fs'
import { app, dialog } from 'electron'
import { mergeRuleSets } from '../shared/rules/edit'
import { convertLegacyGroupsYaml, type LegacyGroups } from '../shared/rules/legacyGroups'
import { formatIssue, parseRuleSetYaml, stringifyRuleSet } from '../shared/rules/yaml'
import type { RulesImportResult } from '../shared/ipc'
import type { RulesStore } from './rulesStore'

/** 現在のルールを、共有用のYAMLファイルとして書き出す(保存先は保存ダイアログ) */
export function exportRules(store: RulesStore): { ok: boolean; message: string } {
  app.focus({ steal: true })
  const path = dialog.showSaveDialogSync({
    title: 'ルールを書き出す',
    defaultPath: 'vmaid-rules.yaml',
    filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }]
  })
  if (!path) return { ok: false, message: '' }
  writeFileSync(path, store.read(), 'utf-8')
  return { ok: true, message: `ルールを書き出しました: ${path}` }
}

/**
 * ルールのYAMLファイルを取り込む。共有されたルールは、検証に通ったものだけを受け付け、
 * 中身(ルール数・アクションの種類)を確認ダイアログで見せてから、「追加」か「置き換え」を選ばせる。
 * (ルールが実行できるのは、モーション・表情・セリフだけで、ファイルやネットワークには触れない)
 */
export function importRules(store: RulesStore, onLegacyGroups: (legacy: LegacyGroups) => void = () => {}): RulesImportResult {
  app.focus({ steal: true })
  const paths = dialog.showOpenDialogSync({
    title: 'ルールを取り込む',
    properties: ['openFile'],
    filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }]
  })
  if (!paths || paths.length === 0) return { ok: false, message: '' }
  let text: string
  try {
    text = readFileSync(paths[0], 'utf-8')
  } catch {
    return { ok: false, message: 'ファイルを読み込めませんでした' }
  }
  if (text.length > 500_000) return { ok: false, message: 'ファイルが大きすぎます' }
  // 旧形式のモーショングループが含まれていれば、タグへ変換する(グループのメンバーへのタグ付けは、取り込みが確定してから)
  const legacy = convertLegacyGroupsYaml(text)
  if (legacy) text = legacy.text
  const parsed = parseRuleSetYaml(text)
  if (!parsed.ruleSet) return { ok: false, message: '取り込めませんでした', errors: parsed.issues.map(formatIssue) }
  const incoming = parsed.ruleSet

  const kinds = new Set(incoming.rules.flatMap((r) => r.do.map((a) => a.action as string)))
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    message: `${incoming.rules.length}件のルールを取り込みます`,
    detail:
      `ルール: ${incoming.rules.map((r) => r.id).join(', ')}\n実行する動作の種類: ${[...kinds].join(', ') || '(なし)'}\n\n` +
      `「追加」は、いまのルールの末尾に加えます(idが被るものは別のidにします)。\n「置き換え」は、いまのルールをすべてこのファイルの内容にします(元は rules.yaml.bak に残ります)。`,
    buttons: ['追加', '置き換え', 'キャンセル'],
    defaultId: 0,
    cancelId: 2
  })
  if (choice === 2) return { ok: false, message: '' }

  const current = parseRuleSetYaml(store.read()).ruleSet
  if (choice === 0 && current) {
    const merged = mergeRuleSets(current, incoming)
    const saved = store.save(stringifyRuleSet(merged.ruleSet))
    if (!saved.ok) return { ok: false, message: '取り込めませんでした', errors: saved.errors }
    if (legacy) onLegacyGroups(legacy.legacy)
    const notes = [
      merged.renamed.length ? `idが被った ${merged.renamed.map((r) => `${r.from}→${r.to}`).join(', ')} は別のidにしました` : '',
      legacy ? '旧形式のモーショングループは、モーションのタグに変換しました' : ''
    ].filter(Boolean)
    return { ok: true, message: `${incoming.rules.length}件を追加しました。${notes.join(' / ')}`.trim() }
  }
  store.reset() // 置き換え: いまのファイルを .bak に残してから
  const saved = store.save(text)
  if (!saved.ok) return { ok: false, message: '取り込めませんでした', errors: saved.errors }
  if (legacy) onLegacyGroups(legacy.legacy)
  return { ok: true, message: `${incoming.rules.length}件のルールに置き換えました${legacy ? '(旧形式のモーショングループは、モーションのタグに変換しました)' : ''}` }
}
