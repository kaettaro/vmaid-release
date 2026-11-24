import { AudioCache } from './audioCache'

/** モーションと一緒に流す BGM(ダンスの楽曲の表の 1 行から) */
export interface Bgm {
  path: string
  offsetSec: number
  volume: number
}

/** 覚えておく曲の数。長い曲は大きいので、少なめにする */
const CACHE_SIZE = 3

/**
 * ダンスの BGM の再生。モーションが始まった瞬間に曲を始め、終わったら止める(モーション基準で、ズレない)。
 * - 曲は、モーションを始める前に、読み込んでデコードしておく(prepare)。始める(start)ときは、待たずに鳴らす。
 * - 音声合成(ttsPlayer)・効果音とは別の AudioContext を使う。口パクが曲に反応しないように。
 */
export class BgmPlayer {
  private ctx: AudioContext | null = null
  private readonly cache = new AudioCache(() => this.context(), CACHE_SIZE)
  /** モーション名 → 次にそのモーションが始まるとき流す曲(準備済み) */
  private readonly ready = new Map<string, Bgm>()
  private current: { motion: string; source: AudioBufferSourceNode; gain: GainNode } | null = null

  get playing(): boolean {
    return this.current !== null
  }

  /** 曲を準備して、そのモーションが始まるときに流すと決める。読めなければ false(モーションだけを再生する) */
  async prepare(motion: string, bgm: Bgm): Promise<boolean> {
    const buffer = await this.cache.load(bgm.path)
    if (!buffer) return false
    this.ready.set(motion, bgm)
    return true
  }

  /** そのモーションに、準備した曲を付けない(曲なしの再生要求のとき) */
  forget(motion: string): void {
    this.ready.delete(motion)
  }

  /** 準備済みの曲を、いますぐ鳴らす(モーションが始まった瞬間に呼ぶ)。前の曲は止める */
  start(motion: string): void {
    this.stop()
    const bgm = this.ready.get(motion)
    if (!bgm) return
    this.ready.delete(motion)
    const buffer = this.cache.peek(bgm.path)
    // 開始位置が曲より長いときは、鳴らさない(start の例外を避ける)
    if (!buffer || bgm.offsetSec >= buffer.duration) return
    const ctx = this.context()
    if (ctx.state === 'suspended') void ctx.resume()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = bgm.volume
    source.connect(gain).connect(ctx.destination)
    // 曲がモーションより短ければ、そのまま終わる(ループしない)
    source.onended = () => {
      if (this.current?.source === source) this.current = null
    }
    source.start(0, bgm.offsetSec)
    this.current = { motion, source, gain }
  }

  /** 止める。motion を指定したときは、そのモーションの曲が鳴っているときだけ */
  stop(motion?: string): void {
    const cur = this.current
    if (!cur || (motion !== undefined && cur.motion !== motion)) return
    this.current = null
    cur.source.onended = null
    try {
      cur.source.stop()
    } catch {
      /* すでに止まっている */
    }
    cur.source.disconnect()
    cur.gain.disconnect()
  }

  dispose(): void {
    this.stop()
    this.ready.clear()
    this.cache.clear()
    void this.ctx?.close()
    this.ctx = null
  }

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    return this.ctx
  }
}
