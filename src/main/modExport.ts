import { writeFileSync } from 'node:fs'
import { dialog, app } from 'electron'
import { z } from 'zod'
import type { ModExportInfo, ModExportRequest, ModExportResult } from '../shared/modsApi'
import { buildUserMod, motionsUsedByRules } from '../shared/packs/export'
import { MOD_FILE_EXT } from '../shared/packs/transfer'
import { parseRuleSetYaml } from '../shared/rules/yaml'
import type { Rule } from '../shared/rules/types'
import { motionItems, readMotionData, type MotionDeps } from './motions'

/** 画面から来る書き出しの依頼の形(信用せず、検証する) */
export const ModExportRequestSchema = z.object({
  id: z.string().max(60),
  name: z.string().max(60),
  version: z.string().max(30),
  description: z.string().max(1000),
  ruleIds: z.array(z.string().max(80)).max(5000),
  motionNames: z.array(z.string().max(200)).max(300),
  promptText: z.string().max(5000),
  promptLayer: z.enum(['persona', 'state'])
})

/** 自分のルール(rules.yaml)だけ。有効な Mod のルールは含まれない */
function userRules(rulesText: string): Rule[] {
  return parseRuleSetYaml(rulesText).ruleSet?.rules ?? []
}

export function modExportInfo(d: MotionDeps, rulesText: string, characterPrompt: string): ModExportInfo {
  return {
    rules: userRules(rulesText).map((r) => ({ id: r.id, description: r.description ?? '' })),
    motions: motionItems(d)
      .filter((m) => m.origin === 'user')
      .map((m) => ({ name: m.name, tags: m.tags.filter((t) => !m.lockedTags.includes(t)) })),
    characterPrompt
  }
}

/** 選んだものを、.vmaidmod に書き出す。保存先を選ぶダイアログを出す(キャンセルなら message は空) */
export function exportUserMod(d: MotionDeps, rulesText: string, req: ModExportRequest): ModExportResult {
  const fail = (message: string): ModExportResult => ({ ok: false, message, warnings: [] })
  const user = motionItems(d).filter((m) => m.origin === 'user')
  const userByName = new Map(user.map((m) => [m.name, m]))
  const wantedRules = new Set(req.ruleIds)
  const rules = userRules(rulesText).filter((r) => wantedRules.has(r.id))
  // ルールが使っている、自分のモーションは、自動で含める(含め忘れて、相手の環境で再生されなくなるのを避ける)
  const names = [...new Set([...req.motionNames, ...motionsUsedByRules(rules).filter((n) => userByName.has(n))])]
  const motions = []
  for (const name of names) {
    const item = userByName.get(name)
    if (!item) return fail(`モーション「${name}」は、自分が登録したものではないため、含められません`)
    const data = readMotionData(d.store, d.packs, name)
    if (!data) return fail(`モーション「${name}」を読み込めませんでした`)
    motions.push({ name, tags: item.tags.filter((t) => !item.lockedTags.includes(t)), data })
  }
  const built = buildUserMod({ ...req, rules, motions })
  if (!built.ok) return fail(built.error)
  app.focus({ steal: true })
  const path = dialog.showSaveDialogSync({
    title: 'Mod を書き出す',
    defaultPath: `${req.id}${MOD_FILE_EXT}`,
    filters: [{ name: 'VMaid Mod', extensions: [MOD_FILE_EXT.slice(1)] }]
  })
  if (!path) return fail('')
  try {
    writeFileSync(path, built.zip)
  } catch (e) {
    return fail(`書き出せませんでした: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { ok: true, message: `${built.fileCount}個のファイルを書き出しました: ${path}`, warnings: built.warnings }
}
