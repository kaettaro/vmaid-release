// VOICEVOX 互換のローカルエンジン(HTTP)への要求の組み立てと検証。通信そのものは main が行う(このファイルは純粋)。
// 流れ(公式READMEで確認): POST /audio_query?text=…&speaker=ID → クエリ(JSON) → POST /synthesis?speaker=ID にそのJSONを送る → WAV。
// 声の調整は、クエリの speedScale / pitchScale / volumeScale を書き換えてから /synthesis に送る。

export const DEFAULT_TTS_ENDPOINT = 'http://127.0.0.1:50021'

/** 声の調整の範囲(エンジンが受け付ける常識的な範囲に収める) */
export const VOICE_LIMITS = {
  speed: { min: 0.5, max: 2, default: 1 },
  pitch: { min: -0.15, max: 0.15, default: 0 }
} as const

export interface VoiceSettings {
  /** VOICEVOX の話者(スタイル)ID。未設定なら null */
  speaker: number | null
  /** OS の音声の名前(speechSynthesis の voice.name)。未設定なら null(OSの既定の日本語) */
  systemVoice: string | null
  speed: number
  pitch: number
}

export const defaultVoice = (): VoiceSettings => ({ speaker: null, systemVoice: null, speed: 1, pitch: 0 })

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** 接続先を正規化する(末尾のスラッシュ・パス・クエリを除く)。http / https 以外・形式不正は null */
export function normalizeTtsEndpoint(raw: string): string | null {
  const t = raw.trim()
  if (t === '' || t.length > 200) return null
  let u: URL
  try {
    u = new URL(t)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  return u.origin
}

/** ループバック(自分のPC)の名前か。localhost 以外への接続は、設定画面で警告する */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
}

export const isLoopbackEndpoint = (endpoint: string): boolean => {
  try {
    return isLoopbackHost(new URL(endpoint).hostname)
  } catch {
    return false
  }
}

export function audioQueryUrl(endpoint: string, text: string, speaker: number): string {
  return `${endpoint}/audio_query?${new URLSearchParams({ text, speaker: String(speaker) }).toString()}`
}

export function synthesisUrl(endpoint: string, speaker: number): string {
  return `${endpoint}/synthesis?${new URLSearchParams({ speaker: String(speaker) }).toString()}`
}

/** /audio_query の応答(JSON)に、声の調整を反映する。想定外の形(オブジェクトでない)なら null */
export function applyVoiceParams(query: unknown, voice: Pick<VoiceSettings, 'speed' | 'pitch'>, volume = 1): Record<string, unknown> | null {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) return null
  return {
    ...(query as Record<string, unknown>),
    speedScale: clamp(voice.speed, VOICE_LIMITS.speed.min, VOICE_LIMITS.speed.max),
    pitchScale: clamp(voice.pitch, VOICE_LIMITS.pitch.min, VOICE_LIMITS.pitch.max),
    volumeScale: clamp(volume, 0, 2)
  }
}

export interface SpeakerStyle {
  id: number
  /** 「キャラ名(スタイル名)」 */
  label: string
}

/** /speakers の応答から、選べる声の一覧を作る。形が違う要素は読み飛ばす */
export function parseSpeakers(json: unknown): SpeakerStyle[] {
  if (!Array.isArray(json)) return []
  const out: SpeakerStyle[] = []
  for (const sp of json) {
    if (typeof sp !== 'object' || sp === null) continue
    const name = (sp as { name?: unknown }).name
    const styles = (sp as { styles?: unknown }).styles
    if (typeof name !== 'string' || !Array.isArray(styles)) continue
    for (const st of styles) {
      const id = (st as { id?: unknown })?.id
      const styleName = (st as { name?: unknown })?.name
      if (typeof id === 'number' && Number.isInteger(id) && typeof styleName === 'string') out.push({ id, label: `${name}(${styleName})` })
    }
  }
  return out
}

/** WAV(RIFF)として最低限の形か。再生に渡す前の検査 */
export function looksLikeWav(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false
  const tag = (o: number): string => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  return tag(0) === 'RIFF' && tag(8) === 'WAVE'
}
