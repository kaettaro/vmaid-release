import { PrefetchQueue } from '@shared/tts/prefetchQueue'
import { prepareForSpeech } from '@shared/tts/prepare'
import { rmsOf } from '@shared/character/audioMouth'
import type { TtsConfig } from '@shared/ttsApi'

/** 読み上げの再生役。文を受け取り、方式(OSの音声 / VOICEVOX 互換)に応じて合成・再生する。口の動きには、音量(または喋っているか)を渡す */
export class TtsPlayer {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private samples: Float32Array<ArrayBuffer> | null = null
  private current: AudioBufferSourceNode | null = null
  private config: TtsConfig | null = null
  private systemSpeaking = false
  private readonly idleWaiters: Array<() => void> = []
  private readonly queue: PrefetchQueue<AudioBuffer | string>

  /** 読み上げに失敗したときの通知(接続できない等)。画面に出すかは呼び出し側が決める */
  onError: (message: string) => void = () => {}

  constructor() {
    this.queue = new PrefetchQueue<AudioBuffer | string>({
      synth: (text, signal) => this.synth(text, signal),
      play: (audio, signal) => this.play(audio, signal),
      onError: (e) => this.onError(e instanceof Error ? e.message : String(e)),
      onBusyChange: (busy) => {
        if (!busy) this.flushIdle()
      }
    })
  }

  setConfig(config: TtsConfig): void {
    this.config = config
    if (config.enabled !== true) this.cancel() // OFF になったら、読み上げ中・待ちのものも止める
  }

  get enabled(): boolean {
    return this.config?.enabled === true
  }

  /** ルールの say(決まったセリフ)も声に出す設定か */
  get speakSay(): boolean {
    return this.config?.speakSay === true
  }

  get busy(): boolean {
    return this.queue.isBusy
  }

  /** 口の動きに使う、いまの音量(RMS)。VOICEVOX の再生中だけ値があり、それ以外は null */
  get level(): number | null {
    if (!this.current || !this.analyser || !this.samples) return null
    this.analyser.getFloatTimeDomainData(this.samples)
    return rmsOf(this.samples)
  }

  /** OS の音声で喋っている間は true(音量が取れないので、口は時間ベースで動かす) */
  get systemSpeakingNow(): boolean {
    return this.systemSpeaking
  }

  /** 1文を読み上げに積む(整形して、読めるものがあれば) */
  speak(text: string): void {
    if (!this.enabled) return
    const t = prepareForSpeech(text)
    if (t !== '') this.queue.enqueue(t)
  }

  /** 読み上げを止める(中断・新しい入力) */
  cancel(): void {
    this.queue.cancel()
    this.stopCurrent()
    if (this.systemSpeaking) {
      window.speechSynthesis?.cancel()
      this.systemSpeaking = false
    }
    this.flushIdle()
  }

  /** すべて読み終わったら呼ぶ(すでに終わっていれば、すぐ呼ぶ) */
  whenIdle(cb: () => void): void {
    if (!this.queue.isBusy) cb()
    else this.idleWaiters.push(cb)
  }

  dispose(): void {
    this.cancel()
    void this.ctx?.close()
    this.ctx = null
  }

  private flushIdle(): void {
    for (const cb of this.idleWaiters.splice(0)) cb()
  }

  // --- 合成 ---
  private async synth(text: string, signal: AbortSignal): Promise<AudioBuffer | string> {
    const c = this.config
    if (!c || c.backend === 'system') return text // OS の音声は、再生時にその場で合成される
    const r = await window.vmaid.ttsSynthesize(text)
    if (signal.aborted) throw new Error('aborted')
    if (!r.ok) throw new Error(r.message)
    if (r.wav === null) throw new Error('読み上げる内容がありません')
    const ctx = this.audioContext()
    // decodeAudioData は渡した配列を使い切る(切り離す)ので、コピーを渡す
    return await ctx.decodeAudioData(r.wav.slice().buffer)
  }

  // --- 再生 ---
  private async play(audio: AudioBuffer | string, signal: AbortSignal): Promise<void> {
    if (typeof audio === 'string') return this.playSystem(audio, signal)
    const ctx = this.audioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    if (signal.aborted) return
    await new Promise<void>((resolve) => {
      const src = ctx.createBufferSource()
      src.buffer = audio
      src.connect(this.analyser!)
      this.current = src
      const done = (): void => {
        signal.removeEventListener('abort', onAbort)
        if (this.current === src) this.current = null
        resolve()
      }
      const onAbort = (): void => {
        try {
          src.stop()
        } catch {
          // すでに止まっている
        }
        done()
      }
      src.onended = done
      signal.addEventListener('abort', onAbort)
      src.start()
    })
  }

  private playSystem(text: string, signal: AbortSignal): Promise<void> {
    const synth = window.speechSynthesis
    if (!synth) return Promise.reject(new Error('この環境では、OSの音声(speechSynthesis)が使えません'))
    const c = this.config!
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'ja-JP'
      const name = c.voice.systemVoice
      const voice = name ? synth.getVoices().find((v) => v.name === name) : synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('ja'))
      if (voice) u.voice = voice
      u.rate = Math.min(2, Math.max(0.5, c.voice.speed))
      u.pitch = Math.min(2, Math.max(0, 1 + c.voice.pitch * 3.3))
      u.volume = Math.min(1, Math.max(0, c.volume))
      const done = (): void => {
        signal.removeEventListener('abort', onAbort)
        this.systemSpeaking = false
        resolve()
      }
      const onAbort = (): void => {
        synth.cancel()
        done()
      }
      u.onend = done
      u.onerror = done
      signal.addEventListener('abort', onAbort)
      this.systemSpeaking = true
      synth.speak(u)
    })
  }

  private stopCurrent(): void {
    try {
      this.current?.stop()
    } catch {
      // すでに止まっている
    }
    this.current = null
  }

  private audioContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.samples = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))
      const gain = this.ctx.createGain()
      gain.gain.value = 1 // 音量は、合成エンジン側(volumeScale)で反映している
      this.analyser.connect(gain)
      gain.connect(this.ctx.destination)
    }
    return this.ctx
  }
}
