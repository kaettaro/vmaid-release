import { z } from 'zod'
import type { Settings } from './settings'
import type { VoiceSettings } from './tts/voicevox'

// 設定ウィンドウと main のやり取り。APIキーは書き込み専用で、本体はレンダラーに返さない。

export interface CharacterView {
  id: string
  name: string
  /** このキャラのモデル(VRM)のパス。未設定なら null */
  modelPath: string | null
  /** モデルのファイルが見つからない(移動・削除された) */
  modelMissing: boolean
  tone: string
  systemPrompt: string
  userCallName: string
  voice: VoiceSettings
}

/** キャラの一覧や、使っているキャラが変わったとき(全ウィンドウへ) */
export interface CharacterChange {
  activeId: string
  characters: Array<{ id: string; name: string }>
}

export const CharacterEditSchema = z
  .object({
    name: z.string().max(40),
    systemPrompt: z.string().max(4000),
    tone: z.string().max(200),
    userCallName: z.string().max(50),
    voice: z
      .object({
        speaker: z.number().int().min(0).max(1_000_000).nullable(),
        systemVoice: z.string().max(200).nullable(),
        speed: z.number().min(0.5).max(2),
        pitch: z.number().min(-0.15).max(0.15)
      })
      .partial()
  })
  .partial()

export type CharacterEdit = z.infer<typeof CharacterEditSchema>

export interface CharacterActionResult {
  ok: boolean
  message: string
  view: SettingsView
}

export interface TtsView {
  enabled: boolean
  backend: Settings['tts']['backend']
  endpoint: string
  volume: number
  speakSay: boolean
  /** エンジンの自動起動 */
  autoStart: boolean
  /** 自動起動する実行ファイル(未選択なら null) */
  enginePath: string | null
  /** 接続先がループバック(自分のPC)か。違えば、設定画面で警告する */
  endpointIsLoopback: boolean
}

export interface SettingsView {
  llm: {
    backend: Settings['llm']['backend']
    baseUrl: string
    model: string
    maxTurns: number
    /** キーが保存済みか(中身は返さない) */
    hasApiKey: boolean
  }
  /** キャラクターの一覧と、いま使っているキャラ */
  characters: CharacterView[]
  activeCharacterId: string
  history: { enabled: boolean }
  tts: TtsView
  /** OSの安全な保管庫(Keychain / DPAPI)が使えるか。使えないとAPIキーは保存できない */
  secureStorageAvailable: boolean
}

export const SettingsPatchSchema = z.object({
  llm: z
    .object({
      backend: z.enum(['openai', 'builtin']),
      baseUrl: z.string().max(500),
      model: z.string().max(200),
      maxTurns: z.number().int().min(1).max(50)
    })
    .partial()
    .optional(),
  history: z.object({ enabled: z.boolean() }).partial().optional(),
  tts: z
    .object({
      enabled: z.boolean(),
      backend: z.enum(['system', 'voicevox']),
      endpoint: z.string().max(200),
      volume: z.number().min(0).max(1),
      speakSay: z.boolean(),
      autoStart: z.boolean()
    })
    .partial()
    .optional(),
  /** 文字列で保存、null / 空文字で削除、省略で変更なし */
  apiKey: z.string().max(500).nullable().optional()
})

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export interface SettingsUpdateResult {
  view: SettingsView
  /** 反映できなかった項目の説明(例: URLが不正) */
  errors: string[]
}

export interface LlmTestResult {
  ok: boolean
  message: string
}
