import { stringify } from 'yaml'
import { BUILTIN_MOTION_NAMES } from '../motions/builtin'
import { featureModsUsedByRules } from '../mods/migrate'
import type { Rule } from '../rules/types'
import { MAX_PACK_MOTIONS, MAX_PROMPT_CHARS, PACK_ID_RE, parsePackYaml } from './manifest'
import { packToZip, type PackFiles } from './transfer'

// 「Mod としてエクスポート」: 自分のルール・モーション・指示文を、1つの Mod(.vmaidmod)にまとめる。純粋ロジック。
// 含めるもの: 選んだルール、選んだモーション(と、ルールが使っているモーション)、指示文。
// 含めないもの: モデル(VRM)・個人の設定・会話履歴・APIキー(入力に無いので、含まれようがない)。

export interface ExportMotion {
  name: string
  /** 利用者が付けたタグ */
  tags: string[]
  data: Uint8Array
}

export interface ExportInput {
  id: string
  name: string
  version: string
  description: string
  rules: Rule[]
  motions: ExportMotion[]
  /** 会話の指示文(空なら含めない) */
  promptText: string
  promptLayer: 'persona' | 'state'
}

export type ExportResult = { ok: true; zip: Uint8Array; warnings: string[]; fileCount: number } | { ok: false; error: string }

/** ルールの playMotion が指す、モーション名(重複なし) */
export function motionsUsedByRules(rules: readonly Rule[]): string[] {
  return [...new Set(rules.flatMap((r) => r.do.flatMap((a) => (a.action === 'playMotion' && typeof a.motion === 'string' && !a.motion.includes('{{') ? [a.motion] : []))))]
}

export function buildUserMod(input: ExportInput): ExportResult {
  if (!PACK_ID_RE.test(input.id)) return { ok: false, error: 'id は、英小文字・数字・ハイフンで、2〜41文字にしてください(例: my-mod)' }
  if (input.name.trim() === '') return { ok: false, error: '名前を入れてください' }
  const prompt = input.promptText.trim()
  if (prompt.length > MAX_PROMPT_CHARS) return { ok: false, error: `指示文は ${MAX_PROMPT_CHARS} 文字までです` }
  if (input.rules.length === 0 && input.motions.length === 0 && prompt === '') return { ok: false, error: '含めるルール・モーション・指示文を、1つ以上選んでください' }
  if (input.motions.length > MAX_PACK_MOTIONS) return { ok: false, error: `モーションは ${MAX_PACK_MOTIONS} 件までです` }

  const files: PackFiles = {}
  const motions = input.motions.map((m, i) => {
    const file = `motions/${String(i + 1).padStart(3, '0')}.vrma`
    files[file] = m.data
    return { name: m.name, file, ...(m.tags.length > 0 ? { tags: m.tags } : {}) }
  })

  const warnings: string[] = []
  const included = new Set(input.motions.map((m) => m.name))
  const builtin = new Set(BUILTIN_MOTION_NAMES)
  for (const name of motionsUsedByRules(input.rules)) {
    if (!included.has(name) && !builtin.has(name)) warnings.push(`ルールが使うモーション「${name}」は含まれていません(相手の環境に同じ名前が無いと、再生されません)`)
  }
  const requires = [...featureModsUsedByRules({ version: 1, rules: input.rules })].sort()

  const manifest = {
    id: input.id,
    name: input.name.trim(),
    version: input.version.trim() || '0.1.0',
    ...(input.description.trim() ? { description: input.description.trim() } : {}),
    // 利用者が作ったものは、再配布が許されている素材とは限らない。私用として書き出す(配布用にするかは、自分で確認して変える)
    distribution: 'private',
    ...(requires.length > 0 ? { requires } : {}),
    ...(prompt ? { prompt: { layer: input.promptLayer, text: prompt } } : {}),
    ...(motions.length > 0 ? { motions } : {}),
    ...(input.rules.length > 0 ? { rules: input.rules } : {})
  }
  const text = stringify(manifest, { lineWidth: 0 })
  // 書き出したものが、取り込みの検査に通ることを、ここで確かめる(通らないものを、相手に渡さない)
  const check = parsePackYaml(text)
  if (!check.pack) return { ok: false, error: `書き出す内容に問題があります: ${check.errors.join(' / ')}` }
  files['mod.yaml'] = new TextEncoder().encode(text)
  try {
    return { ok: true, zip: packToZip(files), warnings, fileCount: Object.keys(files).length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
