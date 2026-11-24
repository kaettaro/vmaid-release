// 音声の音量(RMS)から、口の開き(aa の値)を決める純粋ロジック(リップシンク)。
// 再生中の音声を WebAudio の AnalyserNode で測った値(0〜1程度)を、毎フレーム渡す。

export interface AudioMouthOptions {
  /** この音量(RMS)以下は無音とみなす(ノイズで口が震えないように) */
  floor: number
  /** 音量 → 口の開きの倍率(RMS は小さい値になりやすいので持ち上げる) */
  gain: number
  /** 口を開く最大値(0〜1) */
  maxOpen: number
  /** 開くときの速さ(大きいほど速い。1/秒)。閉じるときは release */
  attack: number
  release: number
}

export const defaultAudioMouthOptions: AudioMouthOptions = { floor: 0.012, gain: 7, maxOpen: 0.8, attack: 38, release: 16 }

/** RMS から目標の開きを求める(floor 以下は 0。上は maxOpen で頭打ち。なめらかに立ち上がる) */
export function targetOpen(rms: number, opt: AudioMouthOptions = defaultAudioMouthOptions): number {
  if (!Number.isFinite(rms) || rms <= opt.floor) return 0
  const v = (rms - opt.floor) * opt.gain
  // 小さい音でも少し開くよう、平方根でなだらかにする
  return Math.min(opt.maxOpen, Math.sqrt(Math.min(1, v)) * opt.maxOpen)
}

export class AudioMouth {
  private value = 0

  constructor(private readonly opt: AudioMouthOptions = defaultAudioMouthOptions) {}

  /** dt 秒進めて、口の開き(0〜maxOpen)を返す。開くほうが速く、閉じるほうがゆっくり */
  update(rms: number, dt: number): number {
    const target = targetOpen(rms, this.opt)
    const rate = target > this.value ? this.opt.attack : this.opt.release
    this.value += (target - this.value) * (1 - Math.exp(-rate * Math.max(0, dt)))
    return Math.min(this.opt.maxOpen, Math.max(0, this.value))
  }

  reset(): void {
    this.value = 0
  }
}

/** 時間領域のサンプル(-1〜1)から RMS を求める */
export function rmsOf(samples: ArrayLike<number>): number {
  const n = samples.length
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / n)
}
