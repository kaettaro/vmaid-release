import { z } from 'zod'
import { clampScale } from './geometry'
import { DEFAULT_TTS_ENDPOINT, normalizeTtsEndpoint } from './tts/voicevox'
import { fixActiveId, migrateLegacySettings, parseCharacterList } from './characters'
import { DEFAULT_OLLAMA_URL } from './llm/endpoint'
import { DEFAULT_IDLE_MOTION } from './motions/builtin'
import { SeSchema } from './sound'
import { BeautifySchema } from './beautify'
import { DEFAULT_RESET_SHORTCUT } from './basic'
import { ChaseSchema } from './chase'
import { VmdImportSchema } from './vmdImport'
import { BubbleSchema } from './bubble'
import { MoveSchema } from './move'
import { TalkSchema } from './talk/gate'
import { GameSettingsSchema } from './game/types'

// 壊れた/古い settings.json でも起動できるよう、項目ごとに既定値へ戻す(.catch)。
// 未知の項目は無視する。新しい設定は項目を足すだけでよい。
/** Mod のスロットの値の長さの上限(ダンスの楽曲の表は、JSON なので長い) */
export const MAX_SLOT_VALUE = 20000

const obj = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}), schema)

const DisplaySchema = z.object({
  scale: z.number().catch(1).transform(clampScale),
  clickThrough: z.boolean().catch(true),
  alwaysOnTop: z.boolean().catch(true),
  showOnStartup: z.boolean().catch(true),
  /** 緊急リセット(キャラを初期の表示に戻す)のショートカット */
  resetShortcut: z.string().catch(DEFAULT_RESET_SHORTCUT),
  /** モーション再生ウィンドウの中にも、キャラを出す(出すなら、そちらで再生する。既定は OFF = キャラ本体で再生) */
  previewInWindow: z.boolean().catch(false),
  /** 緊急リセットの前に、確認ダイアログを出す */
  confirmReset: z.boolean().catch(true)
})

const WindowSchema = z.object({
  x: z.number().int().nullable().catch(null),
  y: z.number().int().nullable().catch(null)
})

const MotionEntrySchema = z.object({
  name: z.string().min(1).max(200),
  path: z.string().min(1),
  /** VMD に足す、表情の VMD のパス(体の VMD と表情の VMD が別ファイルのとき)。VRM のモデルで使うときだけ、変換に使う */
  faces: z.array(z.string().min(1)).max(20).optional().catch(undefined)
})

const MotionSchema = z.object({
  /** 登録したモーション。1件が壊れていても、ほかの件(数百〜数千)を道連れにしないよう、1件ずつ検証して、壊れたものだけを捨てる */
  library: z
    .array(z.unknown())
    .catch([])
    .transform((list) => list.flatMap((e) => {
      const r = MotionEntrySchema.safeParse(e)
      return r.success ? [r.data] : []
    })),
  /** 1回の取り込みで検査する件数の上限。0 なら無制限(既定)。誤って巨大なフォルダを選んだときの保護に使う */
  maxImportFiles: z.number().int().min(0).max(1_000_000).catch(0),
  /** 待機ループに使う登録名(内蔵 'idle' が既定)。null なら待機モーションなし */
  idle: z.string().nullable().catch(DEFAULT_IDLE_MOTION),
  /** 足の接地補正(床に着いた足が滑らないよう、キャラ全体をずらす)。MMD 由来のダンス向け。既定はオフ */
  footLock: z.boolean().catch(false)
})

const BuiltinSchema = z.object({
  /** 使う内蔵モデルのID(resources/models.json)。null なら、PCのメモリから決めた既定 */
  modelId: z.string().nullable().catch(null),
  /** ユーザーが選んだ任意のGGUFファイル(上級者向け)。指定があればこちらを優先 */
  customPath: z.string().nullable().catch(null)
})

const LlmSchema = z.object({
  /** 'builtin' = アプリ内蔵(node-llama-cpp)、'openai' = Ollama などOpenAI互換の外部LLM。既定は内蔵(設定なしで会話できる) */
  backend: z.enum(['openai', 'builtin']).catch('builtin'),
  builtin: obj(BuiltinSchema),
  baseUrl: z.string().catch(DEFAULT_OLLAMA_URL),
  model: z.string().catch(''),
  /** safeStorage で暗号化したAPIキー(base64)。平文は保存しない。レンダラーには渡さない */
  apiKeyEnc: z.string().nullable().catch(null),
  /** 文脈に入れる直近のターン数 */
  maxTurns: z.number().int().min(1).max(50).catch(10)
})

const TtsSchema = z.object({
  /** 音声合成(キャラが声を出す)。既定はオフ */
  enabled: z.boolean().catch(false),
  /** 'system' = OS の音声(speechSynthesis)、'voicevox' = VOICEVOX 互換のローカルエンジン(ユーザーが別に起動) */
  backend: z.enum(['system', 'voicevox']).catch('system'),
  /** VOICEVOX 互換エンジンの接続先。不正な値は既定へ戻す */
  endpoint: z.string().catch(DEFAULT_TTS_ENDPOINT).transform((v) => normalizeTtsEndpoint(v) ?? DEFAULT_TTS_ENDPOINT),
  /** 音量(0〜1) */
  volume: z.number().catch(1).transform((n) => Math.min(1, Math.max(0, n))),
  /** ルールの say(決まったセリフ)も声に出すか */
  speakSay: z.boolean().catch(true),
  /** VOICEVOX 互換エンジンを、必要なときに、自動で起動するか(既定オフ。接続先が自分のPCのときだけ) */
  autoStart: z.boolean().catch(false),
  /** 自動で起動するエンジンの実行ファイル(利用者が、ファイル選択で選んだもの。設定画面からは、選択でしか変えられない) */
  enginePath: z.string().max(1000).nullable().catch(null)
})

const PacksSchema = z.object({
  /** 無効にしたパックのid(既定は、見つかったパックは、すべて有効) */
  disabled: z.array(z.string().max(60)).max(200).catch([]),
  /** true なら、ON にしたもの(enabled)だけが有効(追加直後・新規インストールは OFF)。false(旧方式)は、disabled 以外がすべて有効 */
  optIn: z.boolean().catch(false),
  enabled: z.array(z.string().max(60)).max(200).catch([])
})

/** ルールの値の上書き 1 つ(数値・文字列・真偽・文字列のリスト) */
const RuleValueSchema = z.union([z.number().finite(), z.string().max(2000), z.boolean(), z.array(z.string().max(500)).max(30)])
/** ルールのローカル id → 場所 → 値 */
const RuleValuesByRule = z.record(z.string().max(80), z.record(z.string().max(80), RuleValueSchema).catch({})).catch({})
const PerModRuleValues = z.record(z.string().max(60), RuleValuesByRule).catch({})

const ModsSchema = z.object({
  /** ON にしている公式の機能 Mod の id(src/shared/mods/features.ts)。新規インストールは、すべて OFF */
  features: z
    .array(z.string().max(60))
    .max(100)
    .catch([])
    .transform((l) => [...new Set(l.map((id) => (id === 'music' ? 'se' : id === 'vmd-import' ? 'mmd' : id)))]), // 旧「音楽」Mod は効果音(SE)に作り替えた。「VMD インポーター」は「MMD 対応」に統合した
  /** OFF にした Mod のルールの id(`<Mod の id>/<ルール id>`)。Mod 自体の ON/OFF とは別に、ルール 1 つずつ止められる */
  disabledRules: z.array(z.string().max(120)).max(2000).catch([]),
  /** 初回の移行(使っていた機能に対応する Mod を ON にする)が済んだか */
  migrated: z.boolean().catch(false),
  /** 開発者向け: スクリプト Mod(Tier 2)の導入を許す。既定 OFF */
  developerMode: z.boolean().catch(false),
  /** スクリプト Mod が、設定(urls)で足した通信先のうち、利用者が承認したオリジン(modId → オリジンの一覧)。設定から消すと、使えなくなる */
  approvedOrigins: z
    .record(z.string().max(60), z.array(z.string().max(200)).max(20).catch([]))
    .catch({}),
  /** スクリプト Mod の設定項目の値(modId → 項目名 → 文字列)。secret は、暗号化(`enc:` つき)して保存する */
  modSettings: z
    .record(z.string().max(60), z.record(z.string().max(60), z.string().max(4000)).catch({}))
    .catch({}),
  /** Mod のスロットの値(modId → スロットid → 値。モーション名や文)。利用者が、Mod ごとに選ぶ */
  slots: z
    .record(z.string().max(60), z.record(z.string().max(60), z.string().max(MAX_SLOT_VALUE)).catch({}))
    .catch({}),
  /** ルールの値の上書き(Mod の「詳しい設定」。modId → ルールのローカル id → 場所 → 値)。全キャラ共通 */
  ruleValues: PerModRuleValues.catch({}),
  /** キャラごとの、ルールの値の上書き(modId → キャラid → ルールのローカル id → 場所 → 値)。使っているキャラの分が、共通に優先する */
  ruleValuesByCharacter: z.record(z.string().max(60), z.record(z.string().max(60), RuleValuesByRule.catch({})).catch({})).catch({}),
  /** 一覧窓(host.ui.list)を持つスクリプト Mod の、窓の状態(modId → 表示・キャラへの追従・位置と大きさ)。Mod が OFF でも、値は残す */
  uiWindows: z
    .record(
      z.string().max(60),
      z.object({
        visible: z.boolean().catch(false),
        follow: z.boolean().catch(false),
        bounds: z
          .object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(200).max(4000), height: z.number().int().min(200).max(4000) })
          .nullable()
          .catch(null)
      })
    )
    .catch({}),
  /** キャラごとのスロットの値(modId → キャラid → スロットid → 値)。全キャラ共通の値より優先する */
  slotsByCharacter: z
    .record(z.string().max(60), z.record(z.string().max(60), z.record(z.string().max(60), z.string().max(MAX_SLOT_VALUE)).catch({})).catch({}))
    .catch({})
})

const HistorySchema = z.object({
  /** 会話履歴をローカルに保存するか(既定: 保存する)。オフにしても、アプリを開いている間の文脈には使う */
  enabled: z.boolean().catch(true)
})

const SettingsObjectSchema = z.object({
  display: obj(DisplaySchema),
  motion: obj(MotionSchema),
  llm: obj(LlmSchema),
  history: obj(HistorySchema),
  tts: obj(TtsSchema),
  packs: obj(PacksSchema),
  mods: obj(ModsSchema),
  /** 機能 Mod「効果音(SE)」の設定(名前 → 音ファイル) */
  se: obj(SeSchema),
  /** 機能 Mod「美化(リアル)」「美化(トゥーン)」の設定 */
  beautify: obj(BeautifySchema),
  /** 機能 Mod「追いかけ」の設定 */
  chase: obj(ChaseSchema),
  /** 機能 Mod「VMD インポーター」の設定 */
  vmdImport: obj(VmdImportSchema),
  /** 機能 Mod「吹き出し拡張」の設定 */
  bubble: obj(BubbleSchema),
  /** 機能 Mod「より自由な移動」の設定 */
  move: obj(MoveSchema),
  talk: obj(TalkSchema),
  /** 機能 Mod「ゲーム」の設定 */
  game: obj(GameSettingsSchema),
  /** キャラクターの一覧(モデルのパスと人格)と、いま使っているキャラ */
  characters: z.array(z.unknown()).catch([]).transform(parseCharacterList),
  activeCharacterId: z.string().catch(''),
  window: obj(WindowSchema)
})

// 古い設定(character / model.lastPath)は、読み込み時にキャラ1人の一覧へ移行する。activeCharacterId は、一覧に無ければ先頭へ
export const SettingsSchema = z.preprocess(
  migrateLegacySettings,
  SettingsObjectSchema.transform((s) => ({ ...s, activeCharacterId: fixActiveId(s.characters, s.activeCharacterId) }))
)

export type Settings = z.infer<typeof SettingsSchema>

export function parseSettings(raw: unknown): Settings {
  return SettingsSchema.parse(typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {})
}

export const defaultSettings = (): Settings => parseSettings({})
