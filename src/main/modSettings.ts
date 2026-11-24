import { safeStorage } from 'electron'
import { parseUrlList } from '../shared/scripts/origins'
import type { ScriptSpec } from '../shared/scripts/spec'
import type { SettingsStore } from './settingsStore'

// スクリプト Mod の設定項目(接続先・トークンなど)の保存と読み出し。値は settings.json の mods.modSettings に、文字列で持つ。
// secret(トークンなど)は、safeStorage で暗号化して保存する(平文は残さない。レンダラーにも返さない)。暗号化できない環境では、保存を断る。

const SECRET_PREFIX = 'enc:'

export type SetResult = { ok: true } | { ok: false; message: string }

/** 設定の値を保存する。宣言にない項目・型に合わない値は断る。空文字は、解除(既定値に戻す) */
export function setModSetting(store: SettingsStore, spec: ScriptSpec, modId: string, name: string, raw: string): SetResult {
  const def = spec.settings.find((s) => s.name === name)
  if (!def) return { ok: false, message: 'この Mod に、その設定項目はありません' }
  const value = raw.trim()
  // 実行ファイルのパスは、「選ぶ…」ボタン(ファイル選択ダイアログ。setModFilePath)からだけ。解除(空)は、ここから
  if (def.kind === 'file' && value !== '') return { ok: false, message: '実行ファイルは、「選ぶ…」ボタンから選んでください' }
  if (def.kind === 'urls' && raw.length > 6000) return { ok: false, message: '長すぎます' }
  if (def.kind !== 'urls' && value.length > 2000) return { ok: false, message: '長すぎます' }
  if (value !== '' && def.kind === 'number' && !Number.isFinite(Number(value))) return { ok: false, message: '数値で入力してください' }
  if (value !== '' && def.kind === 'boolean' && value !== 'true' && value !== 'false') return { ok: false, message: 'true か false で指定してください' }
  if (value !== '' && def.kind === 'enum' && !(def.options ?? []).some((o) => o.value === value)) return { ok: false, message: '選択肢にない値です' }
  let stored = value
  if (value !== '' && def.kind === 'urls') {
    const r = parseUrlList(raw)
    if (!r.ok) return { ok: false, message: r.message }
    stored = r.urls.join('\n') // 整えた形で保存する(重複・空行・コメントを除く)
    if (stored.length > 3900) return { ok: false, message: 'URL の合計が長すぎます' }
  }
  if (value !== '' && def.kind === 'secret') {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: 'この環境では、秘密の値(トークン)を暗号化して保存できないため、保存できません' }
    stored = SECRET_PREFIX + safeStorage.encryptString(value).toString('base64')
  }
  store.update((s) => {
    const cur = { ...(s.mods.modSettings[modId] ?? {}) }
    if (value === '') delete cur[name]
    else cur[name] = stored
    if (Object.keys(cur).length === 0) delete s.mods.modSettings[modId]
    else s.mods.modSettings[modId] = cur
  })
  return { ok: true }
}

/** ファイル選択ダイアログで選んだ、実行ファイルのパスを保存する(kind: file の項目だけ。ダイアログの結果以外を渡さないこと) */
export function setModFilePath(store: SettingsStore, spec: ScriptSpec, modId: string, name: string, path: string): SetResult {
  if (spec.settings.find((s) => s.name === name)?.kind !== 'file') return { ok: false, message: 'この Mod に、その設定項目はありません' }
  if (path === '' || path.length > 1000) return { ok: false, message: 'パスが長すぎます' }
  store.update((s) => {
    s.mods.modSettings[modId] = { ...(s.mods.modSettings[modId] ?? {}), [name]: path }
  })
  return { ok: true }
}

/** スクリプトに渡す、設定の値(型つき。secret は復号する)。未設定なら、宣言の既定値、それも無ければ null */
export function readModSetting(store: SettingsStore, spec: ScriptSpec, modId: string, name: string): string | number | boolean | null {
  const def = spec.settings.find((s) => s.name === name)
  if (!def || def.kind === 'file') return null // 実行ファイルのパスは、スクリプトに渡さない(main の起動処理だけが読む)
  const raw = store.get().mods.modSettings[modId]?.[name]
  let text: string | undefined = raw
  if (raw !== undefined && def.kind === 'secret') {
    try {
      text = raw.startsWith(SECRET_PREFIX) && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(raw.slice(SECRET_PREFIX.length), 'base64')) : undefined
    } catch {
      text = undefined
    }
  }
  if (text === undefined) return def.default ?? null
  if (def.kind === 'number') return Number(text)
  if (def.kind === 'boolean') return text === 'true'
  return text
}

/** 画面に見せる値。secret は、値を返さず、設定済みかだけ */
export function viewModSetting(store: SettingsStore, spec: ScriptSpec, modId: string): Array<{ name: string; label: string; kind: string; hint?: string; value: string; isSet: boolean; default?: string; options?: Array<{ value: string; label: string }> }> {
  return spec.settings.map((def) => {
    const raw = store.get().mods.modSettings[modId]?.[def.name]
    return {
      name: def.name,
      label: def.label,
      kind: def.kind,
      ...(def.hint ? { hint: def.hint } : {}),
      ...(def.options ? { options: def.options } : {}),
      value: def.kind === 'secret' ? '' : (raw ?? ''),
      isSet: raw !== undefined,
      ...(def.default !== undefined ? { default: String(def.default) } : {})
    }
  })
}
