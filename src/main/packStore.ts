import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { FEATURE_MODS, featureModName } from '../shared/mods/features'
import { danceBgmPaths, parseDances } from '../shared/dance'
import { MAX_SLOT_VALUE } from '../shared/settings'
import { mergePackRules, parsePackYaml, qualifyMotion, MAX_MANIFEST_BYTES, MANIFEST_FILES, distributionOf, type ModCategory, type ManifestFile, type ParsedPack, type PropSpec } from '../shared/packs/manifest'
import { normalizeSlotValue, resolveSlots, withDefaults, type SlotValues } from '../shared/packs/slots'
import { listRuleFields, type RuleValue } from '../shared/rules/effective'
import { checkParam } from '../shared/rules/schema'
import { checkGlb } from '../shared/props/glb'
import type { CustomTouchPart } from '../shared/touch/parts'
import { expandTemplate } from '../shared/rules/template'
import { createRegistry, type RuleContribution } from '../shared/rules/registry'
import { describePermissions, toNodeDefs, type ScriptSpec } from '../shared/scripts/spec'
import { viewModSetting } from './modSettings'
import { looksLikeFbx, looksLikePmx, MAX_PROP_FBX_BYTES, MAX_PROP_PMX_BYTES, PROP_KIND_MOD, propKindOf, type PropKind, type PropPayload } from '../shared/props/formats'
import { modelUrlFor } from './modelProtocol'
import { closeSync, openSync, readSync } from 'node:fs'
import type { PackInfo, PacksView, RuleFieldInfo } from '../shared/packsApi'
import type { RuleSet } from '../shared/rules/types'
import { vetVrmaFiles } from './motionScan'
import type { SettingsStore } from './settingsStore'

/** ファイルの先頭の数バイトだけ読む(大きなファイルを、毎回、全部読まない) */
function readHead(path: string, n: number): Uint8Array {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(n)
    const got = readSync(fd, buf, 0, n, 0)
    return new Uint8Array(buf.buffer, buf.byteOffset, got)
  } finally {
    closeSync(fd)
  }
}

/** 小道具のファイルの検査。問題があれば、理由(日本語)。glb は中身まで、fbx・pmx は、大きさと先頭の印だけ */
function checkPropFile(kind: PropKind, path: string): string | null {
  const size = statSync(path).size
  if (kind === 'glb') {
    const r = checkGlb(new Uint8Array(readFileSync(path)))
    return r.ok ? null : r.reason
  }
  const max = kind === 'fbx' ? MAX_PROP_FBX_BYTES : MAX_PROP_PMX_BYTES
  if (size > max) return `大きすぎます(上限 ${max / 1024 / 1024}MB)`
  const head = readHead(path, 32)
  if (kind === 'fbx') return looksLikeFbx(head) ? null : 'FBX ファイルではありません'
  return looksLikePmx(head) ? null : 'PMX ファイルではありません'
}

/** スクリプトのファイルの大きさの上限 */
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024

interface LoadedPack {
  info: PackInfo
  parsed: ParsedPack | null
  /** 読んだマニフェストのファイル名(書き出し用) */
  manifest: ManifestFile
  /** 検証済みのモーションの実ファイル(登録名 → パス) */
  files: Array<{ name: string; path: string; tags: string[] }>
  /** 検証済みの小道具(`<Mod の id>/<id>` → 実ファイルと設定) */
  propFiles: Array<{ id: string; path: string; spec: PropSpec; kind: PropKind }>
  /** スクリプト(検証済み): 実ファイルのパス(entry)。無い・不正なら null */
  scriptEntry: string | null
}

/** Mod を置く 3 つのフォルダ(区分は、置き場所で決まる) */
export interface ModRoots {
  /** official: アプリに同梱(resources/mods/official/<id>/。自作・再配布可と確認できたものだけを、リポジトリに入れる) */
  official: string
  /** community: 取り込んだ Mod(userData/mods/community/<id>/) */
  community: string
  /** individual: 自作の Mod(userData/mods/individual/<id>/。リポジトリの外。再配布不可の素材・検証用。Git に入らない) */
  individual: string
}

/**
 * Mod の走査・読み込み。区分(official / community / individual)は、置き場所(フォルダ)で決まる。
 * 機能のコードを使う公式の Mod は、manifest の `feature:` で、本体の機能(FEATURE_MODS)と結びつく。その Mod の ON/OFF は、その機能の ON/OFF と同じ(保存場所は、機能の側 1 か所)。
 * manifest が無い機能(ルールを持たないもの)は、公式の Mod として、一覧に自動で足す。
 */
/** 保存してよい、ルールの値か(数値・文字列・真偽・文字列のリスト) */
const isRuleValue = (v: unknown): v is RuleValue => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))

export class PackStore {
  constructor(
    private readonly settings: SettingsStore,
    private readonly roots: ModRoots,
    /** パックの .bvh を VRMA へ変換した結果の置き場所 */
    private readonly bvhCacheDir?: string
  ) {}

  /** 自作 Mod を置くフォルダ */
  get individualDir(): string {
    return this.roots.individual
  }

  /** 取り込んだ Mod を置くフォルダ */
  get communityDir(): string {
    return this.roots.community
  }

  private scanDir(root: string, category: ModCategory): LoadedPack[] {
    let names: string[]
    try {
      names = readdirSync(root).filter((n) => !n.startsWith('.')).sort()
    } catch {
      return []
    }
    const out: LoadedPack[] = []
    for (const name of names) {
      const dir = join(root, name)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      out.push(this.loadOne(dir, name, category))
    }
    return out
  }

  private loadOne(dir: string, dirName: string, category: ModCategory): LoadedPack {
    const distribution = distributionOf(category)
    const invalid = (errors: string[]): LoadedPack => ({
      info: { id: dirName, name: dirName, version: '', description: '', distribution, category, valid: false, errors, enabled: false, requires: [], promptLayer: null, uiWindow: null, slots: [], ruleFields: [], props: [], script: null, motions: [], rules: [], dir },
      parsed: null,
      manifest: 'mod.yaml',
      files: [],
      propFiles: [],
      scriptEntry: null
    })
    // mod.yaml を優先し、無ければ旧 pack.yaml を読む(互換)
    const manifest: ManifestFile = MANIFEST_FILES.find((f) => existsSync(join(dir, f))) ?? 'mod.yaml'
    const manifestPath = join(dir, manifest)
    let text: string
    try {
      if (statSync(manifestPath).size > MAX_MANIFEST_BYTES) return invalid([`${manifest} が大きすぎます`])
      text = readFileSync(manifestPath, 'utf-8')
    } catch {
      return invalid(['mod.yaml(旧: pack.yaml)を読めません'])
    }
    const parsed = parsePackYaml(text, { category })
    if (!parsed.pack) return invalid(parsed.errors)
    const pack = parsed.pack
    const errors: string[] = []
    // 機能のコードと結びつけるのは、公式の Mod だけ(取り込んだ・自作の Mod が、本体の機能の ON/OFF を握らないように)
    if (pack.feature !== undefined && category !== 'official') errors.push('feature: 本体の機能と結びつけられるのは、公式の Mod だけです')
    if (dirName !== pack.id) errors.push(`フォルダ名「${dirName}」と、pack.yaml の id「${pack.id}」が違います`)
    if (errors.length > 0) return { ...invalid(errors), manifest, info: { ...invalid(errors).info, id: pack.id, name: pack.name } }

    // モーションのファイルを検査(パックのフォルダの外を指さない・シンボリックリンクで外へ出ない・VRMAとして読める・サイズ)
    let realDir: string
    try {
      realDir = realpathSync(dir)
    } catch {
      return invalid(['フォルダを読めません'])
    }
    const files: LoadedPack['files'] = []
    const motionErrors: string[] = []
    for (const m of pack.motions) {
      const p = resolve(dir, m.file)
      let real: string
      try {
        real = realpathSync(p)
      } catch {
        motionErrors.push(`モーション「${m.name}」: ファイルが見つかりません(${m.file})`)
        continue
      }
      if (!real.startsWith(realDir + sep)) {
        motionErrors.push(`モーション「${m.name}」: パックのフォルダの外を指しています`)
        continue
      }
      const vet = vetVrmaFiles([real], { bvhCacheDir: this.bvhCacheDir })
      if (vet.ok.length === 0) {
        motionErrors.push(`モーション「${m.name}」: ${vet.rejected[0]?.reason ?? '読み込めません'}`)
        continue
      }
      // .bvh は変換後の .vrma のパス。タグは、パックの id + manifest のタグ
      files.push({ name: qualifyMotion(pack.id, m.name), path: vet.ok[0], tags: [...new Set([pack.id, ...(m.tags ?? [])])] })
    }
    // 小道具(glb): Mod のフォルダの中にあり、1ファイルで完結した GLB だけを受け付ける
    const propFiles: LoadedPack['propFiles'] = []
    for (const p of pack.props) {
      try {
        const real = realpathSync(resolve(dir, p.file))
        if (!real.startsWith(realDir + sep)) {
          motionErrors.push(`小道具「${p.id}」: Mod のフォルダの外を指しています`)
          continue
        }
        const kind = propKindOf(p.file) as PropKind
        const reason = checkPropFile(kind, real)
        if (reason) {
          motionErrors.push(`小道具「${p.id}」: ${reason}`)
          continue
        }
        propFiles.push({ id: `${pack.id}/${p.id}`, path: real, spec: p, kind })
      } catch {
        motionErrors.push(`小道具「${p.id}」: ファイルが見つかりません(${p.file})`)
      }
    }
    // スクリプト: entry は、Mod のフォルダの中の、ふつうの .js ファイルだけ(外を指すもの・大きすぎるものは使わない)
    let scriptEntry: string | null = null
    if (pack.script) {
      try {
        const real = realpathSync(resolve(dir, pack.script.entry))
        if (!real.startsWith(realDir + sep)) motionErrors.push('スクリプト: Mod のフォルダの外を指しています')
        else if (statSync(real).size > MAX_SCRIPT_BYTES) motionErrors.push(`スクリプト: 大きすぎます(上限 ${MAX_SCRIPT_BYTES / 1024 / 1024}MB)`)
        else scriptEntry = real
      } catch {
        motionErrors.push(`スクリプト: ファイルが見つかりません(${pack.script.entry})`)
      }
    }
    return {
      info: {
        id: pack.id,
        name: pack.name,
        version: pack.version,
        description: pack.description,
        distribution,
        category,
        ...(pack.feature !== undefined ? { feature: pack.feature } : {}),
        valid: true,
        // 一部のモーションが読めなくても、パックは使う(その分は、登録されない。理由は errors に出す)
        errors: motionErrors,
        enabled: false, // ON/OFF は、読むたびに求める(isOn。機能と結びつく Mod は、機能の側が持ち主)
        requires: [],
        slots: [],
        ruleFields: [],
        uiWindow: null,
        props: propFiles.map((f) => f.id),
        script: pack.script ? { permissions: describePermissions(pack.script), launcher: null, blocked: null, settings: [] } : null,
        promptLayer: pack.prompt?.layer ?? null,
        motions: pack.motions.map((m) => ({
          name: qualifyMotion(pack.id, m.name),
          ...(m.source ? { source: m.source } : {}),
          ...(m.license ? { license: m.license } : {}),
          ...(m.redistributable !== undefined ? { redistributable: m.redistributable } : {}),
          ...(m.attribution ? { attribution: m.attribution } : {})
        })),
        rules: pack.ruleSet.rules.map((r) => ({ id: r.id, description: r.description ?? '', enabled: true })),
        dir
      },
      parsed: pack,
      manifest,
      files,
      propFiles,
      scriptEntry
    }
  }

  /** 走査の結果。毎回、全パックのモーションを読み直して検査すると重いので、変更があるまで使い回す(invalidate で捨てる) */
  private cache: LoadedPack[] | null = null

  /** パックのファイル・有効/無効が変わったとき、次の読み出しで読み直す */
  invalidate(): void {
    this.cache = null
  }

  private all(): LoadedPack[] {
    this.cache ??= this.scanAll()
    return this.cache
  }

  private scanAll(): LoadedPack[] {
    const seen = new Set<string>()
    const out: LoadedPack[] = []
    // 同じ id は、official を先に(取り込んだ・自作の Mod が、公式の Mod を差し替えない)
    for (const p of [...this.scanDir(this.roots.official, 'official'), ...this.scanDir(this.roots.community, 'community'), ...this.scanDir(this.roots.individual, 'individual')]) {
      if (p.info.valid && seen.has(p.info.id)) {
        out.push({ ...p, info: { ...p.info, valid: false, enabled: false, errors: [`id「${p.info.id}」が、ほかのパックと重複しています(読み込みません)`] }, parsed: null, files: [], propFiles: [], scriptEntry: null })
        continue
      }
      if (p.info.valid) seen.add(p.info.id)
      out.push(p)
    }
    return out
  }

  /**
   * Mod が ON か(読むたびに求める)。本体の機能と結びつく Mod は、その機能の ON/OFF(保存は、機能の側 1 か所)。それ以外は、Mod の ON/OFF。
   * 旧方式(optIn が false)では、無効にしたもの以外がすべて有効。新方式では、ON にしたものだけ
   */
  private isOn(p: LoadedPack): boolean {
    const f = p.parsed?.feature
    if (f !== undefined) return this.settings.get().mods.features.includes(f)
    return this.isEnabled(p.info.id)
  }

  /** 設定の「Mod」タブを開いたとき: フォルダに手で置いた変更も拾えるよう、読み直してから返す。manifest の無い機能も、公式の Mod として足す */
  view(opts: { synthesize?: boolean } = {}): PacksView {
    this.invalidate()
    // 必要な機能 Mod の ON/OFF は、機能 Mod を切り替えるたびに変わるので、キャッシュに入れず、ここで求める
    const on = new Set(this.settings.get().mods.features)
    const values = this.settings.get().mods.slots
    const byChar = this.settings.get().mods.slotsByCharacter
    const dev = this.settings.get().mods.developerMode
    const loaded = this.all()
    const taken = new Set(loaded.flatMap((p) => (p.info.valid ? [p.info.id, ...(p.parsed?.feature ? [p.parsed.feature] : [])] : [p.info.id])))
    const synthesized: PackInfo[] = FEATURE_MODS.filter((f) => opts.synthesize !== false && !taken.has(f.id)).map((f) => ({
      id: f.id,
      name: f.name,
      version: '',
      description: f.description,
      distribution: 'distributable',
      category: 'official',
      feature: f.id,
      valid: true,
      errors: [],
      enabled: on.has(f.id),
      requires: [],
      promptLayer: null,
      script: null,
      props: [],
      slots: [],
      ruleFields: [],
      uiWindow: null,
      motions: [],
      rules: [],
      dir: ''
    }))
    const registry = createRegistry(undefined, this.contributions())
    const ruleVals = this.settings.get().mods.ruleValues
    const ruleValsByChar = this.settings.get().mods.ruleValuesByCharacter
    const packs = loaded.map((p) => ({
      ...p.info,
      ruleFields: (p.parsed?.ruleSet.rules ?? []).flatMap((r): RuleFieldInfo[] => {
        const local = r.id.slice(p.info.id.length + 1)
        return listRuleFields(r, (k, t) => registry.find(k, t)).map((f) => ({
          ruleId: local,
          ruleDescription: r.description ?? '',
          path: f.path,
          nodeType: f.type,
          nodeLabel: registry.find(f.kind, f.type)?.label ?? f.type,
          label: f.param.label,
          kind: f.param.kind as RuleFieldInfo['kind'],
          ...(f.param.min !== undefined ? { min: f.param.min } : {}),
          ...(f.param.max !== undefined ? { max: f.param.max } : {}),
          ...(f.param.options ? { options: f.param.options } : {}),
          ...(f.param.hint ? { hint: f.param.hint } : {}),
          base: f.value as RuleValue,
          ...(ruleVals[p.info.id]?.[local]?.[f.path] !== undefined ? { value: ruleVals[p.info.id]![local]![f.path] } : {}),
          charValues: Object.fromEntries(Object.entries(ruleValsByChar[p.info.id] ?? {}).flatMap(([cid, byRule]) => (byRule[local]?.[f.path] !== undefined ? [[cid, byRule[local]![f.path]!]] : [])))
        }))
      }),
      enabled: p.info.valid && this.isOn(p),
      uiWindow: p.parsed?.script?.permissions.ui.list ? { visible: this.settings.get().mods.uiWindows[p.info.id]?.visible ?? false, follow: this.settings.get().mods.uiWindows[p.info.id]?.follow ?? false } : null,
      // スクリプトを含む Mod は、「開発者向け」が ON のときだけ動く。OFF の間は、理由を出して、無効として見せる
      ...(p.info.script && p.parsed?.script
        ? { script: { ...p.info.script, launcher: p.parsed.script.launcher ? { label: p.parsed.script.launcher.label } : null, blocked: dev ? null : 'スクリプトを含む Mod は、設定 →「Mod」の「開発者向け」を ON にしたときだけ使えます', settings: viewModSetting(this.settings, p.parsed.script, p.info.id) }, enabled: p.info.valid && this.isOn(p) && dev }
        : {}),
      // 必要な機能 Mod: Mod が書いたもの + 小道具の形式(FBX・PMX)に必要なもの
      requires: [...new Set([...(p.parsed?.requires ?? []), ...p.propFiles.filter((f) => f.kind !== 'glb').map((f) => PROP_KIND_MOD[f.kind])])].map((id) => ({ id, name: featureModName(id), enabled: on.has(id) })),
      slots: (p.parsed?.slots ?? []).map((s) => ({
        ...s,
        value: values[p.info.id]?.[s.id] ?? '',
        charValues: Object.fromEntries(Object.entries(byChar[p.info.id] ?? {}).flatMap(([cid, v]) => (v[s.id] ? [[cid, v[s.id]]] : [])))
      }))
    }))
    const offRules = new Set(this.settings.get().mods.disabledRules)
    for (const p of packs) p.rules = p.rules.map((r) => ({ ...r, enabled: !offRules.has(r.id) }))
    return { packs: [...packs, ...synthesized], individualDir: this.roots.individual, communityDir: this.roots.community }
  }

  private enabled(): LoadedPack[] {
    const dev = this.settings.get().mods.developerMode
    // スクリプトを含む Mod は、「開発者向け」が ON のときだけ有効(データだけの Mod は、いつでも)
    return this.all().filter((p) => p.info.valid && this.isOn(p) && (!p.parsed?.script || dev))
  }

  /**
   * Mod の id → 結びつく本体の機能の id(機能と結びつかない Mod は null)。
   * manifest の feature、または、manifest が無い機能(一覧に自動で足したもの。id が機能の id)
   */
  featureOf(modId: string): string | null {
    const p = this.all().find((x) => x.info.id === modId && x.info.valid)
    if (p) return p.parsed?.feature ?? null
    return FEATURE_MODS.some((f) => f.id === modId) ? modId : null
  }

  /** 有効なスクリプト Mod(「開発者向け」が ON で、ON にしたもの)。スクリプトの実体と、宣言と、権限 */
  scriptMods(): Array<{ id: string; name: string; dir: string; entry: string; spec: ScriptSpec }> {
    return this.enabled().flatMap((p) => (p.parsed?.script && p.scriptEntry ? [{ id: p.info.id, name: p.info.name, dir: p.info.dir, entry: p.scriptEntry, spec: p.parsed.script }] : []))
  }

  /** スクリプト Mod の宣言(有効かどうかに関わらず。設定項目の保存の検証に使う)。スクリプトを含まない Mod は null */
  scriptSpec(modId: string): ScriptSpec | null {
    return this.all().find((p) => p.info.id === modId && p.info.valid)?.parsed?.script ?? null
  }

  /** 有効なスクリプト Mod が宣言した、ルールのノード(ルールの画面・エンジンに渡す) */
  contributions(): RuleContribution[] {
    return this.scriptMods().map((m) => ({
      modId: m.id,
      modName: m.name,
      triggers: toNodeDefs(m.id, m.name, m.spec.contributes.triggers),
      actions: toNodeDefs(m.id, m.name, m.spec.contributes.actions)
    }))
  }

  /**
   * 有効な Mod が宣言した、触れ合いの部位(同じ id は、先に読んだものを使う)。
   * 機能 Mod「高度な触れ合い」が OFF のときは、空(部位の判定は、そもそも行わない)
   */
  touchParts(): CustomTouchPart[] {
    if (!this.settings.get().mods.features.includes('touch-advanced')) return []
    const seen = new Set<string>()
    const out: CustomTouchPart[] = []
    for (const p of this.enabled()) {
      for (const t of p.parsed?.touchParts ?? []) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        out.push(t)
      }
    }
    return out
  }

  /** 有効なパックのモーション(登録名とファイルのパス)。中身は読まない */
  motionEntries(): Array<{ name: string; path: string; tags: string[] }> {
    return this.enabled().flatMap((p) => p.files)
  }

  /** 有効なパックのモーション(登録名とファイルの中身)。読めないものは飛ばす */
  motionFiles(): Array<{ name: string; data: Uint8Array }> {
    const out: Array<{ name: string; data: Uint8Array }> = []
    for (const p of this.enabled()) {
      for (const f of p.files) {
        try {
          out.push({ name: f.name, data: new Uint8Array(readFileSync(f.path)) })
        } catch {
          console.warn(`[pack] 読み込めないため飛ばします: ${f.path}`)
        }
      }
    }
    return out
  }

  /** 有効な Mod の小道具の、中身と設定。id は `<Mod の id>/<id>`。OFF の Mod・無い id は null */
  propData(id: string): { payload: PropPayload; spec: PropSpec } | null {
    const features = this.settings.get().mods.features
    for (const p of this.enabled()) {
      const f = p.propFiles.find((x) => x.id === id)
      if (!f) continue
      // FBX・PMX の小道具は、その形式のインポーター Mod が ON のときだけ(読み込み用のコードを使うため)
      if (f.kind !== 'glb' && !features.includes(PROP_KIND_MOD[f.kind])) return null
      try {
        if (f.kind === 'pmx') return { payload: { kind: 'pmx', url: modelUrlFor(f.path) }, spec: f.spec }
        return { payload: { kind: f.kind, data: new Uint8Array(readFileSync(f.path)) }, spec: f.spec }
      } catch {
        return null
      }
    }
    return null
  }

  /**
   * 有効な Mod の会話の指示文の断片。性格 → 状態の順(同じ層の中は、Mod の id 順)。whenState つきは、その状態が続いているときだけ。
   * 本文の `{{slot:id}}` は、使っているキャラ(characterId)のスロットの値に展開する
   */
  promptLayers(activeStates: ReadonlySet<string> = new Set(), characterId = ''): string[] {
    const on = this.enabled().flatMap((p) =>
      p.parsed?.prompt && (!p.parsed.prompt.whenState || activeStates.has(p.parsed.prompt.whenState)) ? [{ ...p.parsed.prompt, modId: p.info.id }] : []
    )
    const text = (p: (typeof on)[number]): string => expandTemplate(p.text, { message: '', rest: '', slots: this.effectiveSlots(p.modId, characterId) }).trim()
    return [...on.filter((p) => p.layer === 'persona'), ...on.filter((p) => p.layer === 'state')].map(text).filter((t) => t !== '')
  }

  /** その Mod のスロットの値(キャラの値 → 全キャラ共通の値 → Mod の初期値) */
  effectiveSlots(modId: string, characterId: string): SlotValues {
    const defs = this.all().find((p) => p.info.id === modId)?.parsed?.slots ?? []
    const m = this.settings.get().mods
    return resolveSlots(defs, m.slots[modId], m.slotsByCharacter[modId]?.[characterId])
  }

  /** ダンスの楽曲の表(スロット kind: dances)に入っている BGM のパス。音ファイルの読み出しの許可リストに使う(利用者が選んだものだけ) */
  bgmPaths(): Set<string> {
    const m = this.settings.get().mods
    const out = new Set<string>()
    for (const p of this.all()) {
      for (const s of p.parsed?.slots ?? []) {
        if (s.kind !== 'dances') continue
        const values = [s.default, m.slots[p.info.id]?.[s.id], ...Object.values(m.slotsByCharacter[p.info.id] ?? {}).map((v) => v[s.id])]
        for (const v of values) for (const path of danceBgmPaths(parseDances(v))) out.add(path)
      }
    }
    return out
  }

  /** 全 Mod の、全キャラ共通のスロットの値(Mod の初期値つき)。ルールのエンジン用 */
  commonSlots(): Record<string, SlotValues> {
    const m = this.settings.get().mods
    return Object.fromEntries(this.all().flatMap((p) => (p.parsed && p.parsed.slots.length > 0 ? [[p.info.id, withDefaults(p.parsed.slots, m.slots[p.info.id])]] : [])))
  }

  /** 有効なパックのルール・グループ(名前空間つき)。ユーザーのルールとは、別の層として、レンダラーで合成する */
  ruleSet(): RuleSet {
    const merged = mergePackRules({ version: 1, rules: [] }, this.enabled().flatMap((p) => (p.parsed ? [p.parsed] : [])))
    const off = new Set(this.settings.get().mods.disabledRules)
    return off.size === 0 ? merged : { ...merged, rules: merged.rules.filter((r) => !off.has(r.id)) }
  }

  /** ON の Mod のルールすべて(個別に OFF にしたものも含む。enabled に、OFF が反映される)。ルールタブの一覧用 */
  ruleSetAll(): RuleSet {
    const merged = mergePackRules({ version: 1, rules: [] }, this.enabled().flatMap((p) => (p.parsed ? [p.parsed] : [])))
    const off = new Set(this.settings.get().mods.disabledRules)
    return { ...merged, rules: merged.rules.map((r) => (off.has(r.id) ? { ...r, enabled: false } : r)) }
  }

  /** Mod のルールを 1 つずつ ON/OFF する(その Mod が持たないルールの id は受け付けない) */
  setRuleEnabled(ruleId: string, enabled: boolean): boolean {
    if (!this.all().some((p) => p.parsed?.ruleSet.rules.some((r) => r.id === ruleId))) return false
    this.settings.update((s) => {
      const cur = new Set(s.mods.disabledRules)
      if (enabled) cur.delete(ruleId)
      else cur.add(ruleId)
      s.mods.disabledRules = [...cur]
    })
    return true
  }

  /** 「開発者向け」が ON か(スクリプトを含む Mod を、取り込み・使用してよいか) */
  developerMode(): boolean {
    return this.settings.get().mods.developerMode
  }

  /** ON か。旧方式(optIn が false)では、無効にしたもの以外がすべて有効。新方式では、ON にしたものだけ */
  private isEnabled(id: string): boolean {
    const p = this.settings.get().packs
    return p.optIn ? p.enabled.includes(id) : !p.disabled.includes(id)
  }

  /** スロットの値を決める(空なら、解除)。その Mod に無いスロット・存在しないキャラは、受け付けない。characterId = null は、全キャラ共通 */
  setSlot(modId: string, slotId: string, value: string, characterId: string | null = null): boolean {
    const pack = this.all().find((p) => p.info.id === modId)
    if (!pack?.parsed?.slots.some((s) => s.id === slotId)) return false
    if (characterId !== null && !this.settings.get().characters.some((c) => c.id === characterId)) return false
    const def = pack.parsed.slots.find((s) => s.id === slotId)!
    const v = normalizeSlotValue(def, value.slice(0, MAX_SLOT_VALUE))
    if (v === null) return false // 種類に合わない値(数値でない・時刻の形が違う など)は、受け付けない
    this.settings.update((s) => {
      if (characterId === null) {
        const cur = { ...(s.mods.slots[modId] ?? {}) }
        if (v === '') delete cur[slotId]
        else cur[slotId] = v
        if (Object.keys(cur).length === 0) delete s.mods.slots[modId]
        else s.mods.slots[modId] = cur
        return
      }
      const byChar = { ...(s.mods.slotsByCharacter[modId] ?? {}) }
      const cur = { ...(byChar[characterId] ?? {}) }
      if (v === '') delete cur[slotId]
      else cur[slotId] = v
      if (Object.keys(cur).length === 0) delete byChar[characterId]
      else byChar[characterId] = cur
      if (Object.keys(byChar).length === 0) delete s.mods.slotsByCharacter[modId]
      else s.mods.slotsByCharacter[modId] = byChar
    })
    return true
  }

  /**
   * ルールの値を上書きする(「詳しい設定」。層 A)。value が null なら、解除(Mod が書いた値に戻す)。
   * その Mod の、そのルールの、調整できる場所でなければ、受け付けない。値は、ルールと同じ検査(範囲・型)を通ったものだけ。characterId = null は、全キャラ共通
   */
  setRuleValue(modId: string, ruleId: string, path: string, value: unknown, characterId: string | null = null): boolean {
    const pack = this.all().find((p) => p.info.id === modId)
    const rule = pack?.parsed?.ruleSet.rules.find((r) => r.id === `${modId}/${ruleId}`)
    if (!pack || !rule) return false
    if (characterId !== null && !this.settings.get().characters.some((c) => c.id === characterId)) return false
    const registry = createRegistry(undefined, this.contributions())
    const field = listRuleFields(rule, (k, t) => registry.find(k, t)).find((f) => f.path === path)
    if (!field) return false
    let stored: RuleValue | null = null
    if (value !== null) {
      const r = checkParam(field.param, value)
      if (!r.ok || !isRuleValue(r.value)) return false
      stored = r.value
    }
    this.settings.update((s) => {
      const put = (all: Record<string, Record<string, RuleValue>>): Record<string, Record<string, RuleValue>> => {
        const byRule = { ...all }
        const cur = { ...(byRule[ruleId] ?? {}) }
        if (stored === null) delete cur[path]
        else cur[path] = stored
        if (Object.keys(cur).length === 0) delete byRule[ruleId]
        else byRule[ruleId] = cur
        return byRule
      }
      if (characterId === null) {
        const next = put(s.mods.ruleValues[modId] ?? {})
        if (Object.keys(next).length === 0) delete s.mods.ruleValues[modId]
        else s.mods.ruleValues[modId] = next
        return
      }
      const byChar = { ...(s.mods.ruleValuesByCharacter[modId] ?? {}) }
      const next = put(byChar[characterId] ?? {})
      if (Object.keys(next).length === 0) delete byChar[characterId]
      else byChar[characterId] = next
      if (Object.keys(byChar).length === 0) delete s.mods.ruleValuesByCharacter[modId]
      else s.mods.ruleValuesByCharacter[modId] = byChar
    })
    return true
  }

  setEnabled(id: string, enabled: boolean): void {
    this.invalidate()
    this.settings.update((s) => {
      const toggle = (list: string[], on: boolean): string[] => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id))
      s.packs.enabled = toggle(s.packs.enabled, enabled)
      s.packs.disabled = toggle(s.packs.disabled, !enabled)
    })
  }

  /**
   * 旧方式から、「ON にしたものだけ有効」の方式へ移す(1回だけ)。以前から使っている人は、いま有効なものを、そのまま ON にする。
   * 新規インストールは、すべて OFF(公式の Mod も、「Mod」タブで選んで ON にする)
   */
  migrateToOptIn(existingUser: boolean): void {
    if (this.settings.get().packs.optIn) return
    this.invalidate()
    // 以前から使っている人は、以前から有効だったもの(取り込んだ・自作の Mod)を、そのまま ON にする。
    // 公式の Mod(性格・ダンスなど)は、自分で選ぶまで OFF。初めて使う人は、公式の「基本」Mod(あいさつ・ふれあいなど)だけ ON
    const on = existingUser ? this.all().filter((p) => p.info.valid && this.isEnabled(p.info.id) && p.info.category !== 'official').map((p) => p.info.id) : this.all().filter((p) => p.info.valid && p.info.id === 'basic').map((p) => p.info.id)
    this.settings.update((s) => {
      s.packs.enabled = on
      s.packs.optIn = true
    })
    this.invalidate()
  }

  /** 自作 Mod のフォルダを、無ければ作って返す */
  ensureIndividualDir(): string {
    if (!existsSync(this.roots.individual)) mkdirSync(this.roots.individual, { recursive: true })
    return this.roots.individual
  }

  /** 取り込んだ Mod のフォルダを、無ければ作って返す */
  ensureCommunityDir(): string {
    if (!existsSync(this.roots.community)) mkdirSync(this.roots.community, { recursive: true })
    return this.roots.community
  }

  /** 自作 Mod(individual)の、書き出す(manifest + 検証済みのモーション)ファイルの一覧 */
  exportFiles(id: string): Record<string, Uint8Array> | null {
    const p = this.all().find((x) => x.info.id === id && x.info.valid && x.info.category === 'individual')
    if (!p || !p.parsed) return null
    const files: Record<string, Uint8Array> = { [p.manifest]: new Uint8Array(readFileSync(join(p.info.dir, p.manifest))) }
    for (const m of p.parsed.motions) {
      const path = p.files.find((f) => f.name === qualifyMotion(p.parsed!.id, m.name))?.path
      if (path) files[m.file] = new Uint8Array(readFileSync(path))
    }
    return files
  }
}
