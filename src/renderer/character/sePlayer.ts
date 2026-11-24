import { findSound, soundGain, type SeView } from '@shared/sound'
import { AudioCache } from './audioCache'

/** 覚えておく効果音の数 */
const CACHE_SIZE = 24
/** 同時に鳴らせる数(連打で、音が積み重なりすぎないように) */
const MAX_CONCURRENT = 8

/** 機能 Mod「効果音(SE)」の再生。ルールのアクションで、名前を指定して鳴らす。重ねて鳴らせる。Mod を OFF にすると、鳴っている音も止まる */
export class SePlayer {
  private ctx: AudioContext | null = null
  private view: SeView | null = null
  private readonly cache = new AudioCache(() => this.context(), CACHE_SIZE)
  private readonly active = new Set<AudioBufferSourceNode>()

  setView(view: SeView): void {
    this.view = view
    if (!view.enabled) this.stopAll()
  }

  async play(name: string): Promise<void> {
    const view = this.view
    if (!view?.enabled) return
    const sound = findSound(view.sounds, name)
    if (!sound || this.active.size >= MAX_CONCURRENT) return
    const buffer = await this.cache.load(sound.path)
    if (!buffer || !this.view?.enabled) return
    const ctx = this.context()
    if (ctx.state === 'suspended') void ctx.resume()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = soundGain(view.volume, sound.volume)
    source.connect(gain).connect(ctx.destination)
    source.onended = () => {
      this.active.delete(source)
      source.disconnect()
      gain.disconnect()
    }
    this.active.add(source)
    source.start()
  }

  stopAll(): void {
    for (const s of this.active) {
      try {
        s.stop()
      } catch {
        /* すでに止まっている */
      }
    }
    this.active.clear()
  }

  dispose(): void {
    this.stopAll()
    this.cache.clear()
    void this.ctx?.close()
    this.ctx = null
  }

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    return this.ctx
  }
}
