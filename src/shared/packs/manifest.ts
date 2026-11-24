import { z } from 'zod'
import { parseDocument } from 'yaml'
import { normalizeTag } from '../motionMeta'
import { convertLegacyGroupsRaw } from '../rules/legacyGroups'
import { findDef } from '../rules/definitions'
import { checkSlotRefs } from '../rules/effective'
import { parseRuleSet } from '../rules/schema'
import { ScriptSchema, type ScriptSpec } from '../scripts/spec'
import type { Rule, RuleSet } from '../rules/types'
import { isFeatureModId } from '../mods/features'
import { TOUCH_BONES_CENTER, TOUCH_BONES_SIDED, TOUCH_PARTS, type CustomTouchPart, type CustomTouchRegion } from '../touch/parts'

/** 本体の部位の id(Mod が宣言する部位の id と、重ならないようにする) */
const BUILTIN_TOUCH_IDS: readonly string[] = ['any', ...TOUCH_PARTS.map((p) => p.value)]

// パック(ルール + モーショングループ + モーションの一覧を、1まとまりにしたもの)の定義と検証。Electron 非依存の純粋ロジック。
// 配布用(distributable): リポジトリの resources/packs/。自作・再配布可と確認できたものだけ。
// 私用(private): アプリのデータフォルダの packs/private/。再配布不可の素材・検証用。**どちらかは、置き場所で決まる**(manifest の値は、置き場所と一致していなければならない)。

export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/
export const MAX_PACK_MOTIONS = 300
export const MAX_MANIFEST_BYTES = 1_000_000
/** Mod の指示文の断片の長さの上限(文字) */
export const MAX_PROMPT_CHARS = 2000
/** lines スロット(セリフの一覧)の行数の上限 */
export const MAX_LINES_SLOT = 30

export type Distribution = 'distributable' | 'private'

/** Mod の区分。置き場所(フォルダ)で決まる: official = アプリに同梱 / community = 取り込んだもの / individual = 自作 */
export type ModCategory = 'official' | 'community' | 'individual'

/** 区分から、配布の扱い(official だけが、配布用の検査: スクリプト不可・モーションに再配布可とライセンスが必要)。manifest の distribution は、区分が分かるときは使わない */
export const distributionOf = (category: ModCategory): Distribution => (category === 'official' ? 'distributable' : 'private')

/** マニフェストのファイル名。`mod.yaml` が正で、旧 `pack.yaml` も Mod として読む(互換) */
export const MANIFEST_FILES = ['mod.yaml', 'pack.yaml'] as const
export type ManifestFile = (typeof MANIFEST_FILES)[number]

/** ファイルの集まり(パスをキーに持つもの)から、マニフェストのファイル名を選ぶ(mod.yaml を優先) */
export function pickManifest(files: Record<string, unknown>): ManifestFile | null {
  return MANIFEST_FILES.find((f) => f in files) ?? null
}

/** パックのフォルダからの相対パスとして安全か(絶対パス・`..`・`\`・ドライブ名・制御文字を許さない。区切りは `/` だけ) */
export function isSafeRelativePath(p: string): boolean {
  if (p === '' || p.length > 200) return false
  if (p.startsWith('/') || p.includes('\\') || p.includes(':')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) return false
  const parts = p.split('/')
  return parts.every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

const MotionSchema = z.object({
  /** パックの中でのモーション名(ルールからは、この名前で指す。登録されるときは `<パックid>/<名前>`) */
  name: z
    .string()
    .min(1)
    .max(40)
    // eslint-disable-next-line no-control-regex
    .refine((n) => !n.includes('/') && !/[\u0000-\u001f\u007f]/.test(n), '名前に / や制御文字は使えません'),
  /** パックのフォルダからの相対パス(.vrma。.bvh は読み込み時に VRMA へ変換する) */
  file: z.string().refine(isSafeRelativePath, 'パックのフォルダの中の相対パス(/ 区切り)で指定してください').refine((f) => /\.(vrma|bvh)$/i.test(f), '.vrma または .bvh ファイルを指定してください'),
  /** 出典(URL や配布者名) */
  source: z.string().max(500).optional(),
  /** ライセンス・利用規約の要約(原文は出典で確認) */
  license: z.string().max(1000).optional(),
  /** 再配布してよいか。配布用のパックでは、true と明記が必要 */
  redistributable: z.boolean().optional(),
  /** 表示が必要なクレジット */
  attribution: z.string().max(500).optional(),
  /** このモーションが最初から持つタグ(ルールから、タグで選べる。不正なタグは捨てる)。パックの id は、自動でタグになる */
  tags: z
    .array(z.string())
    .max(20)
    .optional()
    .transform((list) => (list ? [...new Set(list.flatMap((t) => (normalizeTag(t) ? [normalizeTag(t) as string] : [])))] : undefined))
})

const Vec3 = z.tuple([z.number().min(-100).max(100), z.number().min(-100).max(100), z.number().min(-100).max(100)])

/** 小道具(glb)。キャラの骨に付けて表示する。ルールの「小道具を出す」で、id を指す(Mod の中の id) */
export const PropSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, '小道具の id は、英小文字・数字・ハイフンで書いてください'),
  /** Mod のフォルダからの相対パス(.glb / .fbx / .pmx。.pmx のテクスチャは、同じフォルダの中) */
  file: z.string().refine(isSafeRelativePath, 'Mod のフォルダの中の相対パス(/ 区切り)で指定してください').refine((f) => /\.(glb|fbx|pmx)$/i.test(f), '.glb / .fbx / .pmx ファイルを指定してください(.fbx は「FBX インポーター」、.pmx は「PMX インポーター」Mod が ON のときだけ使えます)'),
  /** 付ける骨。VRM の人体ボーン名(head, rightHand など)。MMD のモデルでは、対応するボーン(頭・右手首など)に付く */
  bone: z.string().min(1).max(40).default('head'),
  /** 大きさの倍率(モデルの大きさに対する、小道具の大きさの調整) */
  scale: z.number().min(0.001).max(100).default(1),
  /** 骨からのずれ(メートル。VRM の骨の向きで) */
  position: Vec3.default([0, 0, 0]),
  /** 向き(度。x, y, z) */
  rotation: Vec3.default([0, 0, 0])
})

export type PropSpec = z.infer<typeof PropSchema>

/** Mod が宣言する、触れ合いの部位(機能 Mod「高度な触れ合い」が ON のときだけ有効)。中身は、Mod が決める */
export const TouchPartSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, '部位の id は、英小文字・数字・ハイフンで書いてください'),
    label: z.string().min(1).max(30),
    /** 左右(キャラの左右)を区別するか */
    sides: z.boolean().default(false),
    /** 骨の近く(bone + radius)か、身体の高さの帯(band: [上, 下])のどちらか */
    bone: z.string().max(20).optional(),
    radius: z.number().min(0.005).max(0.3).optional(),
    band: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
    halfWidth: z.number().min(0.02).max(0.5).optional()
  })
  .superRefine((p, ctx) => {
    const hasBone = p.bone !== undefined
    const hasBand = p.band !== undefined
    if (hasBone === hasBand) ctx.addIssue({ code: 'custom', message: 'bone(骨)か band(高さの帯)の、どちらか一方を書いてください' })
    if (hasBone) {
      const ok = p.sides ? (TOUCH_BONES_SIDED as readonly string[]).includes(p.bone!) : (TOUCH_BONES_CENTER as readonly string[]).includes(p.bone!)
      if (!ok) ctx.addIssue({ code: 'custom', message: `bone は、${p.sides ? TOUCH_BONES_SIDED.join(' / ') : TOUCH_BONES_CENTER.join(' / ')} のいずれかです(sides: ${p.sides})` })
      if (p.radius === undefined) ctx.addIssue({ code: 'custom', message: 'bone には、radius(身体の高さに対する割合。例: 0.05)が必要です' })
    }
    if (hasBand && p.band![0] >= p.band![1]) ctx.addIssue({ code: 'custom', message: 'band は、[上, 下](0〜1、上 < 下)で書いてください' })
  })

/** 宣言(ファイル上の形)から、判定に使う形にする */
export function toCustomTouchPart(p: z.infer<typeof TouchPartSchema>): CustomTouchPart {
  const region: CustomTouchRegion =
    p.bone !== undefined
      ? { kind: 'bone', bone: p.bone, radius: p.radius ?? 0.05 }
      : { kind: 'band', from: p.band![0], to: p.band![1], ...(p.halfWidth !== undefined ? { halfWidth: p.halfWidth } : {}) }
  return { id: p.id, label: p.label, sides: p.sides, region }
}

const HeaderSchema = z.object({
  id: z.string().regex(PACK_ID_RE, 'id は、英小文字・数字・ハイフンで、2〜41文字にしてください(例: touch-basic)'),
  name: z.string().min(1).max(60),
  version: z.string().min(1).max(30),
  description: z.string().max(1000).optional(),
  /** 旧: 配布用 / 私用。いまは、置き場所(official / community / individual)で決まるので、書かなくてよい(書いても、区分が分かるときは無視する) */
  distribution: z.enum(['distributable', 'private']).default('private'),
  /** この Mod が結びつく、本体の機能のコード(公式の Mod だけ。FEATURE_MODS の id)。ON にすると、その機能と、この Mod のルール・設定が、いっしょに有効になる */
  feature: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/).optional(),
  /** この Mod が使う公式の機能 Mod(例: motion-tags)。OFF のとき、その機能を使う部分は動かない。画面に「必要な Mod」として出す */
  requires: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/)).max(20).default([]),
  /** この Mod が持つ小道具(glb) */
  props: z.array(PropSchema).max(20).default([]),
  /** この Mod が宣言する、触れ合いの部位 */
  touchParts: z.array(TouchPartSchema).max(20).default([]),
  /** 利用者が差し替える「空き」(例: タップしたときのモーション)。ルールの `{{slot:id}}` で使う。素材を含めずに、反応の枠だけを配れる */
  slots: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'スロットの id は、英小文字・数字・ハイフンで書いてください'),
        label: z.string().min(1).max(60),
        /** motion = モーション名 / number = 数値(min・max・step・unit) / time = 時刻(HH:MM) / boolean = オン・オフ / lines = 1 行に 1 つのセリフ(複数なら、ランダムに選ばれる) / text = 文・言葉(合言葉は、カンマ区切りで複数) / preset = 表情・衣装パネルのセット名(表情・モーフなどの組み合わせ。モデルごと) / choice = options から選ぶ / effect = 画面効果の名前(組み込み + 自作) / dances = ダンスの楽曲の表(楽曲の名前 → モーション + BGM。値は JSON。ルールの playDance で使う) */
        kind: z.enum(['motion', 'text', 'preset', 'choice', 'effect', 'dances', 'number', 'time', 'boolean', 'lines']).default('motion'),
        /** kind: number の最小・最大・刻み・単位(「分」「秒」など。欄に出す) */
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().positive().optional(),
        unit: z.string().max(10).optional(),
        /** 設定画面で、まとめて見出しにする名前(折りたたみ) */
        group: z.string().max(30).optional(),
        /** kind: choice の選択肢(value が、ルールの {{slot:id}} に入る値) */
        options: z.array(z.object({ value: z.string().max(2000), label: z.string().min(1).max(60) })).max(20).optional(),
        /** 利用者が何も決めていないときの値(キャラごとに変えられる) */
        default: z.string().max(2000).optional(),
        /** 設定画面に出す説明 */
        hint: z.string().max(200).optional()
      })
    )
    .max(20)
    .default([]),
  /** スクリプト Mod(ADR 0002)。サンドボックスの中で動き、宣言した権限のホスト API だけ使える。「開発者向け」が ON のときだけ使える */
  script: ScriptSchema.optional(),
  /** 会話の指示文の断片。persona = 性格(複数 ON で重ね掛け)、state = 状態(性格のあとに足す)。whenState を書くと、その状態(startState)が続いている間だけ足す */
  prompt: z
    .object({
      layer: z.enum(['persona', 'state']).default('persona'),
      text: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
      whenState: z.string().trim().min(1).max(24).optional()
    })
    .optional(),
  motions: z.array(MotionSchema).max(MAX_PACK_MOTIONS).default([])
})

export type SlotKind = 'motion' | 'text' | 'preset' | 'choice' | 'effect' | 'dances' | 'number' | 'time' | 'boolean' | 'lines'

export type PackMotion = z.infer<typeof MotionSchema>

export interface ParsedPack {
  id: string
  name: string
  version: string
  description: string
  distribution: Distribution
  /** 結びつく本体の機能(公式の Mod だけ) */
  feature?: string
  /** 使う公式の機能 Mod の id */
  requires: string[]
  /** 小道具(ルールの「小道具を出す」で使う) */
  props: PropSpec[]
  /** 宣言した、触れ合いの部位 */
  touchParts: CustomTouchPart[]
  /** スクリプト(無ければ null) */
  script: ScriptSpec | null
  /** 利用者が差し替えるスロット */
  slots: Array<{ id: string; label: string; kind: SlotKind; options?: Array<{ value: string; label: string }>; default?: string; hint?: string; min?: number; max?: number; step?: number; unit?: string; group?: string }>
  /** 会話の指示文の断片(無ければ null) */
  prompt: { layer: 'persona' | 'state'; text: string; whenState?: string } | null
  motions: PackMotion[]
  /** ルール(モーション名・ルールid は、パックの名前空間つきに書き換え済み) */
  ruleSet: RuleSet
}

export interface PackParseResult {
  pack: ParsedPack | null
  errors: string[]
}

/** パックの中のモーション名を、登録される名前(`<パックid>/<名前>`)にする */
export const qualifyMotion = (packId: string, name: string): string => `${packId}/${name}`

/**
 * ルールの名前を、パックの名前空間つきにする(ユーザーのルールや他のパックと衝突しない・どのパックのものか分かる)。
 * - モーション名: パックのモーション(local)を指していれば `<id>/<名前>` に。内蔵・ユーザー登録のモーションを指すものは、そのまま
 * - タグ(playMotion の tag): そのまま(タグは、すべてのモーションで共通。パックのモーションに付けたタグも、ユーザーのタグと同じ名前なら、同じタグ)
 * - ルールid: `<id>/<id>`
 */
export function namespaceRuleSet(packId: string, localMotions: ReadonlySet<string>, rs: RuleSet): RuleSet {
  const q = (m: string): string => (localMotions.has(m) ? qualifyMotion(packId, m) : m)
  const rules: Rule[] = rs.rules.map((r) => ({
    ...r,
    id: `${packId}/${r.id}`,
    do: r.do.map((a) => {
      if (a.action !== 'playMotion') return a
      const next = { ...a }
      if (typeof a.motion === 'string') next.motion = q(a.motion)
      return next
    })
  }))
  return { version: 1, rules }
}

/**
 * Mod のルールが、自分のスクリプトが宣言したノード(`contributes`)を、ローカル名(`action: gen`)で書いていたら、
 * `<Mod の id>/<名前>` に直す(書く人が、自分の Mod の id を、毎回書かなくてよいように)
 */
export function qualifyLocalNodes(rules: unknown, modId: string, script: ScriptSpec | undefined): unknown {
  if (!script || !Array.isArray(rules)) return rules ?? []
  const triggers = new Set(script.contributes.triggers.map((n) => n.type))
  const actions = new Set(script.contributes.actions.map((n) => n.type))
  return rules.map((r: unknown) => {
    if (typeof r !== 'object' || r === null) return r
    const rule = { ...(r as Record<string, unknown>) }
    const when = rule.when
    if (typeof when === 'object' && when !== null && typeof (when as { trigger?: unknown }).trigger === 'string' && triggers.has((when as { trigger: string }).trigger)) {
      rule.when = { ...(when as object), trigger: `${modId}/${(when as { trigger: string }).trigger}` }
    }
    if (Array.isArray(rule.do)) {
      rule.do = rule.do.map((a: unknown) => {
        const act = a as { action?: unknown }
        return typeof act === 'object' && act !== null && typeof act.action === 'string' && actions.has(act.action) ? { ...act, action: `${modId}/${act.action}` } : a
      })
    }
    return rule
  })
}

/** mod.yaml(旧 pack.yaml)を読んで検証する。エラーは、まとめて日本語で返す */
export function parsePackYaml(text: string, opts: { category?: ModCategory } = {}): PackParseResult {
  if (text.length > MAX_MANIFEST_BYTES) return { pack: null, errors: ['pack.yaml が大きすぎます'] }
  const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true })
  if (doc.errors.length > 0) return { pack: null, errors: doc.errors.map((e) => `YAMLの書き方が正しくありません: ${e.message.split('\n')[0]}`) }
  const raw = doc.toJS() as unknown
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { pack: null, errors: ['pack.yaml の最上位は、`id:` などを持つ形で書いてください'] }
  const obj = raw as Record<string, unknown>

  const head = HeaderSchema.safeParse(obj)
  const errors: string[] = []
  if (!head.success) {
    for (const i of head.error.issues) errors.push(`${i.path.join('.') || '(最上位)'}: ${i.message}`)
    return { pack: null, errors }
  }
  const h = { ...head.data, distribution: opts.category ? distributionOf(opts.category) : head.data.distribution }
  if (h.feature !== undefined && !isFeatureModId(h.feature)) errors.push(`feature: 「${h.feature}」は、本体にない機能です`)
  const names = new Set<string>()
  const slotIds = new Set<string>()
  for (const s of h.slots) {
    if (s.kind === 'choice' && (s.options ?? []).length === 0) errors.push(`slots: 「${s.id}」は kind: choice なので、options を1つ以上書いてください`)
    if (s.kind === 'number' && s.default !== undefined && !Number.isFinite(Number(s.default))) errors.push(`slots: 「${s.id}」(number)の default は、数値で書いてください`)
    if (s.kind === 'time' && s.default !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.default)) errors.push(`slots: 「${s.id}」(time)の default は、HH:MM で書いてください`)
    if (s.kind === 'boolean' && s.default !== undefined && s.default !== 'true' && s.default !== 'false') errors.push(`slots: 「${s.id}」(boolean)の default は、true か false で書いてください`)
    if (s.kind === 'lines' && (s.default ?? '').split('\n').length > MAX_LINES_SLOT) errors.push(`slots: 「${s.id}」(lines)は、${MAX_LINES_SLOT} 行までです`)
    if (slotIds.has(s.id)) errors.push(`slots: id「${s.id}」が重複しています`)
    slotIds.add(s.id)
  }
  if (h.script && h.distribution === 'distributable') errors.push('script: 配布用(公式)の Mod には、スクリプトを含められません(スクリプトを含む Mod は、私用として扱います)')
  const propIds = new Set<string>()
  for (const p of h.props) {
    if (propIds.has(p.id)) errors.push(`props: id「${p.id}」が重複しています`)
    propIds.add(p.id)
  }
  const touchIds = new Set<string>(BUILTIN_TOUCH_IDS)
  for (const p of h.touchParts) {
    if (touchIds.has(p.id)) errors.push(`touchParts: id「${p.id}」は、本体の部位か、ほかの部位と重複しています`)
    touchIds.add(p.id)
  }
  for (const m of h.motions) {
    if (names.has(m.name)) errors.push(`motions: 名前「${m.name}」が重複しています`)
    names.add(m.name)
  }
  // 配布用のパックは、すべてのモーションに「再配布可」と、ライセンスの記載が必要(確認できないものを、配布物に入れないため)
  if (h.distribution === 'distributable') {
    for (const m of h.motions) {
      if (m.redistributable !== true) errors.push(`motions「${m.name}」: 配布用のパックには、redistributable: true と確認できたものだけを入れられます(確認できないものは、私用パックへ)`)
      if (!m.license) errors.push(`motions「${m.name}」: 配布用のパックには、license(ライセンス・規約の要約)が必要です`)
    }
  }
  // ルール(既存のルールYAMLと同じ書式。検証も同じ)。旧形式のモーショングループ(motionGroups・group)は、タグへ自動で変換する:
  // グループ名がタグ名になり、パックの中のメンバーのモーションに、そのタグが付く(パックの外のモーションは、パックからはタグを付けられない)
  const rawRules: Record<string, unknown> = { version: 1, rules: qualifyLocalNodes(obj.rules, h.id, h.script) }
  if (obj.motionGroups !== undefined) rawRules.motionGroups = obj.motionGroups
  const converted = convertLegacyGroupsRaw(rawRules)
  const ruleResult = parseRuleSet(converted.raw)
  if (!ruleResult.ruleSet) for (const i of ruleResult.issues) errors.push(`${i.path || 'rules'}: ${i.message}`)
  // ルールが参照するスロットが、宣言されていて、種類が合っているか
  if (ruleResult.ruleSet) errors.push(...checkSlotRefs(ruleResult.ruleSet, h.slots, findDef))
  if (errors.length > 0 || !ruleResult.ruleSet) return { pack: null, errors }
  const motions = h.motions.map((m) => {
    const fromGroups = Object.entries(converted.legacy.assignments).filter(([, members]) => members.includes(m.name)).map(([tag]) => tag)
    return fromGroups.length > 0 ? { ...m, tags: [...new Set([...(m.tags ?? []), ...fromGroups])] } : m
  })

  return {
    pack: {
      id: h.id,
      name: h.name,
      version: h.version,
      description: h.description ?? '',
      distribution: h.distribution,
      ...(h.feature !== undefined ? { feature: h.feature } : {}),
      requires: [...new Set(h.requires)],
      slots: h.slots,
      props: h.props,
      touchParts: h.touchParts.map(toCustomTouchPart),
      script: h.script ?? null,
      prompt: h.prompt ?? null,
      motions,
      ruleSet: namespaceRuleSet(h.id, names, ruleResult.ruleSet)
    },
    errors: []
  }
}

/**
 * ユーザーのルールに、有効なパックのルールを足す(ユーザーのルールが先に並ぶ)。
 * 名前空間つきなので衝突しない。パックのルールは、ユーザーが編集した rules.yaml には書き込まれない(別の層)
 */
export function mergePackRules(user: RuleSet, packs: ReadonlyArray<Pick<ParsedPack, 'ruleSet'>>): RuleSet {
  const rules = [...user.rules]
  for (const p of packs) rules.push(...p.ruleSet.rules)
  return { version: 1, rules }
}
