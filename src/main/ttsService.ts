import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import type { TtsConfig } from '../shared/ttsApi'
import type { SettingsStore } from './settingsStore'
import type { CharacterBook } from './characterBook'
import {
  applyVoiceParams,
  audioQueryUrl,
  isLoopbackHost,
  looksLikeWav,
  parseSpeakers,
  synthesisUrl,
  type SpeakerStyle
} from '../shared/tts/voicevox'
import { prepareForSpeech } from '../shared/tts/prepare'

/** 応答の上限(1文の音声は小さい。巨大な応答は拒否する) */
const MAX_BYTES = 20 * 1024 * 1024
const QUERY_TIMEOUT_MS = 10_000
const SYNTH_TIMEOUT_MS = 60_000

export class TtsError extends Error {}

const isLoopbackAddress = (a: string): boolean => a === '::1' || a.startsWith('127.') || a === '::ffff:127.0.0.1'

/**
 * 名前解決の結果が、ループバックを宣言した接続先(localhost 等)でループバックでなければ、接続の前に拒否する。
 * (DNS リバインディング対策。確認と接続の間に結果が変わらないよう、接続時の lookup で行う)
 */
function guardedLookup(hostname: string): typeof dnsLookup | undefined {
  if (!isLoopbackHost(hostname)) return undefined
  return ((host: string, opts: unknown, cb: (e: Error | null, a?: string | LookupAddress[], f?: number) => void) => {
    const callback = (typeof opts === 'function' ? opts : cb) as typeof cb
    const options = typeof opts === 'object' && opts !== null ? (opts as { all?: boolean }) : {}
    dnsLookup(host, { all: true }, (err, addrs) => {
      if (err) return callback(err)
      if (addrs.length === 0 || !addrs.every((x) => isLoopbackAddress(x.address))) return callback(new TtsError('接続先がループバックではありません'))
      if (options.all) callback(null, addrs)
      else callback(null, addrs[0].address, addrs[0].family)
    })
  }) as unknown as typeof dnsLookup
}

interface HttpResult {
  status: number
  body: Buffer
}

function httpCall(method: 'GET' | 'POST', url: string, opts: { body?: Buffer; contentType?: string; timeoutMs: number; signal?: AbortSignal }): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const doRequest = u.protocol === 'https:' ? httpsRequest : httpRequest
    const req = doRequest(
      u,
      {
        method,
        timeout: opts.timeoutMs,
        signal: opts.signal,
        headers: { ...(opts.body ? { 'Content-Type': opts.contentType ?? 'application/json', 'Content-Length': opts.body.length } : {}) },
        lookup: guardedLookup(u.hostname)
      },
      (res: IncomingMessage) => {
        // リダイレクトは追わない(別の宛先へ送らない)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume()
          return reject(new TtsError('接続先がリダイレクトしました(対応していません)'))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_BYTES) {
            req.destroy(new TtsError('応答が大きすぎます'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new TtsError('応答がありません(時間切れ)')))
    req.on('error', (e) => reject(e instanceof TtsError ? e : new TtsError(describe(e, u.origin))))
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

/** エンジンに接続できるか(GET /version)。自動起動の確認用。短い時間で、断る */
export async function probeEngine(endpoint: string): Promise<boolean> {
  try {
    const r = await httpCall('GET', `${endpoint}/version`, { timeoutMs: 1500 })
    return r.status === 200
  } catch {
    return false
  }
}

function describe(e: unknown, origin: string): string {
  const code = (e as { code?: string })?.code
  if (code === 'ECONNREFUSED') return `${origin} に接続できません。音声合成エンジン(VOICEVOX など)を起動してください`
  if (code === 'ABORT_ERR') return '中断しました'
  return `${origin} への接続に失敗しました(${e instanceof Error ? e.message : String(e)})`
}

/** 音声合成の実行役。VOICEVOX 互換エンジンへの通信は、ここ(main)だけが行う(レンダラーは直接通信しない) */
export class TtsService {
  constructor(
    private readonly store: SettingsStore,
    private readonly book: CharacterBook,
    /** 読み上げの前に呼ぶ(エンジンの自動起動) */
    private readonly beforeUse: () => Promise<void> = async () => {}
  ) {}

  /** 公式の機能 Mod「音声合成」(tts)が ON か。OFF のときは、声を出さず、エンジンへの通信もしない */
  private modOn(): boolean {
    return this.store.get().mods.features.includes('tts')
  }

  config(): TtsConfig {
    const { tts } = this.store.get()
    const v = this.book.active().voice
    return {
      enabled: this.modOn(),
      backend: tts.backend,
      volume: tts.volume,
      speakSay: tts.speakSay,
      voice: { speaker: v.speaker, systemVoice: v.systemVoice, speed: v.speed, pitch: v.pitch }
    }
  }

  /** 1文を WAV にする(VOICEVOX 互換)。読み上げるものが無ければ null */
  async synthesize(rawText: string, signal?: AbortSignal): Promise<Uint8Array | null> {
    const { tts } = this.store.get()
    if (!this.modOn() || tts.backend !== 'voicevox') throw new TtsError('音声合成(VOICEVOX)が有効ではありません')
    const text = prepareForSpeech(rawText)
    if (text === '') return null
    await this.beforeUse() // 自動起動が ON なら、エンジンが起動していなければ、起動して待つ
    const voice = this.book.active().voice
    const speaker = voice.speaker
    if (speaker === null) throw new TtsError('声(話者)が選ばれていません。設定 →「Mod」→「音声合成」の行で選んでください')
    const q = await httpCall('POST', audioQueryUrl(tts.endpoint, text, speaker), { timeoutMs: QUERY_TIMEOUT_MS, signal, body: Buffer.alloc(0) })
    if (q.status !== 200) throw new TtsError(`音声合成エンジンがエラーを返しました(audio_query: HTTP ${q.status})`)
    let query: unknown
    try {
      query = JSON.parse(q.body.toString('utf-8'))
    } catch {
      throw new TtsError('音声合成エンジンの応答を読めませんでした(audio_query)')
    }
    const adjusted = applyVoiceParams(query, voice, tts.volume)
    if (!adjusted) throw new TtsError('音声合成エンジンの応答の形が想定と違います(audio_query)')
    const r = await httpCall('POST', synthesisUrl(tts.endpoint, speaker), { body: Buffer.from(JSON.stringify(adjusted), 'utf-8'), timeoutMs: SYNTH_TIMEOUT_MS, signal })
    if (r.status !== 200) throw new TtsError(`音声合成エンジンがエラーを返しました(synthesis: HTTP ${r.status})`)
    const wav = new Uint8Array(r.body.buffer, r.body.byteOffset, r.body.length)
    if (!looksLikeWav(wav)) throw new TtsError('音声合成エンジンの応答が、音声(WAV)ではありません')
    return wav
  }

  /** 声の一覧(設定画面用) */
  async speakers(): Promise<{ ok: boolean; message: string; speakers: SpeakerStyle[] }> {
    const { tts } = this.store.get()
    if (!this.modOn()) return { ok: false, message: 'Mod「音声合成」が OFF です', speakers: [] }
    await this.beforeUse()
    try {
      const r = await httpCall('GET', `${tts.endpoint}/speakers`, { timeoutMs: QUERY_TIMEOUT_MS })
      if (r.status !== 200) return { ok: false, message: `エンジンがエラーを返しました(HTTP ${r.status})`, speakers: [] }
      const speakers = parseSpeakers(JSON.parse(r.body.toString('utf-8')))
      return speakers.length > 0
        ? { ok: true, message: `接続できました。声が ${speakers.length} 件あります`, speakers }
        : { ok: false, message: '接続できましたが、声の一覧を読めませんでした(VOICEVOX 互換のエンジンではない可能性があります)', speakers: [] }
    } catch (e) {
      return { ok: false, message: e instanceof TtsError ? e.message : describe(e, tts.endpoint), speakers: [] }
    }
  }
}
