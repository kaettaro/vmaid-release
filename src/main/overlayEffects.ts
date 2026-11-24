import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_EFFECT_NAMES, BUILTIN_EFFECT_YAML, builtinEffect, EFFECT_NAME_RE, MAX_EFFECT_YAML_BYTES, parseEffectYaml, type EffectSpec, type OverlayEffectInfo } from '../shared/overlay'

/** 自作の画面効果の置き場: userData/overlay-effects/<名前>.yaml(手で置いても、設定画面で作っても、同じ。共有もこのファイル) */
const MAX_CUSTOM_EFFECTS = 50

export class OverlayEffectStore {
  constructor(private readonly dir: string) {}

  private fileOf(name: string): string {
    return join(this.dir, `${name}.yaml`)
  }

  /** 組み込み + 自作の一覧(組み込みが先。自作は名前順) */
  list(): OverlayEffectInfo[] {
    const builtin = BUILTIN_EFFECT_NAMES.map((name): OverlayEffectInfo => ({ name, label: builtinEffect(name)?.label ?? name, builtin: true, yaml: BUILTIN_EFFECT_YAML[name], error: null }))
    const custom: OverlayEffectInfo[] = []
    if (existsSync(this.dir)) {
      for (const f of readdirSync(this.dir).sort()) {
        const name = f.replace(/\.yaml$/, '')
        if (!f.endsWith('.yaml') || !EFFECT_NAME_RE.test(name) || BUILTIN_EFFECT_NAMES.includes(name)) continue
        const path = this.fileOf(name)
        try {
          if (statSync(path).size > MAX_EFFECT_YAML_BYTES) throw new Error('大きすぎます')
          const yaml = readFileSync(path, 'utf-8')
          const r = parseEffectYaml(yaml)
          custom.push({ name, label: r.spec?.label ?? name, builtin: false, yaml, error: r.errors.length > 0 ? r.errors.join(' / ') : null })
        } catch (e) {
          custom.push({ name, label: name, builtin: false, yaml: '', error: e instanceof Error ? e.message : String(e) })
        }
        if (custom.length >= MAX_CUSTOM_EFFECTS) break
      }
    }
    return [...builtin, ...custom]
  }

  /** 名前から、描ける効果の定義を得る(読み込めない・無い名前は null) */
  get(name: string): EffectSpec | null {
    if (!EFFECT_NAME_RE.test(name)) return null
    const b = builtinEffect(name)
    if (b) return b
    const path = this.fileOf(name)
    if (!existsSync(path)) return null
    try {
      if (statSync(path).size > MAX_EFFECT_YAML_BYTES) return null
      return parseEffectYaml(readFileSync(path, 'utf-8')).spec
    } catch {
      return null
    }
  }

  /** 保存。検証に通らなければ、書かない */
  save(name: string, yaml: string): { ok: boolean; message: string } {
    if (!EFFECT_NAME_RE.test(name)) return { ok: false, message: '名前は、英小文字・数字・ハイフンで、40 文字までにしてください(例: my-fog)' }
    if (BUILTIN_EFFECT_NAMES.includes(name)) return { ok: false, message: `「${name}」は組み込みの名前です。別の名前にしてください` }
    const r = parseEffectYaml(yaml)
    if (!r.spec) return { ok: false, message: r.errors.join(' / ') }
    mkdirSync(this.dir, { recursive: true })
    if (!existsSync(this.fileOf(name)) && this.list().filter((e) => !e.builtin).length >= MAX_CUSTOM_EFFECTS) return { ok: false, message: `自作の効果は ${MAX_CUSTOM_EFFECTS} 個までです` }
    // 書き込み途中で壊れないよう、一時ファイルに書いてから置き換える
    const tmp = join(this.dir, `.${name}.tmp`)
    writeFileSync(tmp, yaml, 'utf-8')
    renameSync(tmp, this.fileOf(name))
    return { ok: true, message: `「${name}」を保存しました` }
  }

  delete(name: string): { ok: boolean; message: string } {
    if (!EFFECT_NAME_RE.test(name) || BUILTIN_EFFECT_NAMES.includes(name)) return { ok: false, message: '組み込みの効果は、削除できません' }
    if (!existsSync(this.fileOf(name))) return { ok: false, message: '見つかりません' }
    rmSync(this.fileOf(name))
    return { ok: true, message: `「${name}」を削除しました` }
  }
}
