// 読み上げの設定(main → レンダラー)。使用中のキャラの声を含む。
export interface TtsConfig {
  enabled: boolean
  backend: 'system' | 'voicevox'
  volume: number
  speakSay: boolean
  voice: { speaker: number | null; systemVoice: string | null; speed: number; pitch: number }
}
