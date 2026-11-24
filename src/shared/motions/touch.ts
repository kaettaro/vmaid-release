import type { Euler, MotionDef, PoseFrame } from './builder'

// ふれあい用の、自作の情緒モーション。コードで生成するので、素材のライセンス問題がなく、再配布できる(配布用パックの一部)。
// 手書きの簡易モーション(関節の回転だけ)なので、凝った動きではない。凝ったものは、私用パックの外部モーションで補う想定。

const ARM_DOWN = 1.2
const TAU = Math.PI * 2
const smooth = (t: number): number => t * t * (3 - 2 * t)
/** 開始・終了で0、途中で1になる包絡線(姿勢を待機姿勢と滑らかにつなぐ) */
const envelope = (t: number, dur: number, fade = 0.4): number => smooth(Math.max(0, Math.min(1, t / fade, (dur - t) / fade)))
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

/** 待機の基本姿勢(腕を下ろす・肘を軽く曲げる) */
const base = (): Record<string, Euler> => ({
  leftUpperArm: [0, 0, -ARM_DOWN],
  rightUpperArm: [0, 0, ARM_DOWN],
  leftLowerArm: [0, 0, -0.08],
  rightLowerArm: [0, 0, 0.08]
})

/** 照れる: うつむいて首をかしげ、両手を胸の前に寄せて、もじもじ体をゆらす */
const shy: MotionDef = {
  name: 'shy',
  durationSec: 3.2,
  stepSec: 0.05,
  pose: (t, dur): PoseFrame => {
    const e = envelope(t, dur, 0.6)
    const sway = Math.sin(TAU * 0.9 * t)
    return {
      rot: {
        ...base(),
        leftUpperArm: [0, lerp(0, -0.5, e), -ARM_DOWN + 0.15 * e],
        rightUpperArm: [0, lerp(0, 0.5, e), ARM_DOWN - 0.15 * e],
        leftLowerArm: [0, lerp(0, -1.5, e), -0.08],
        rightLowerArm: [0, lerp(0, 1.5, e), 0.08],
        spine: [0.06 * e, 0.05 * e * sway, 0.03 * e * sway],
        chest: [0.04 * e, 0, 0],
        head: [0.28 * e, 0.12 * e * sway, 0.14 * e],
        hips: [0, 0.04 * e * sway, 0.02 * e * sway]
      }
    }
  }
}

/** びっくり: のけぞって、腕が少し開き、すぐ落ち着く */
const surprised: MotionDef = {
  name: 'surprised',
  durationSec: 1.8,
  stepSec: 0.03,
  pose: (t, dur): PoseFrame => {
    // 0〜0.25秒で一気にのけぞり、その後ゆっくり戻る
    const jump = t < 0.25 ? smooth(t / 0.25) : Math.max(0, 1 - (t - 0.25) / (dur - 0.25))
    const settle = smooth(Math.min(1, jump))
    return {
      hipsY: 1.0 + 0.018 * Math.sin(Math.PI * Math.min(1, t / 0.35)) * (t < 0.35 ? 1 : 0),
      rot: {
        ...base(),
        leftUpperArm: [0, 0, -ARM_DOWN + 0.3 * settle],
        rightUpperArm: [0, 0, ARM_DOWN - 0.3 * settle],
        leftLowerArm: [0, -0.35 * settle, -0.08],
        rightLowerArm: [0, 0.35 * settle, 0.08],
        spine: [-0.14 * settle, 0, 0],
        chest: [-0.06 * settle, 0, 0],
        head: [-0.16 * settle, 0.04 * Math.sin(TAU * 3 * t) * settle, 0]
      }
    }
  }
}

/** うれしい: 軽く2回弾んで、腕をふって、首をかしげる */
const happyHop: MotionDef = {
  name: 'happyHop',
  durationSec: 2.2,
  stepSec: 0.04,
  pose: (t, dur): PoseFrame => {
    const e = envelope(t, dur, 0.3)
    const beat = TAU * 1.6 * t
    const hop = Math.abs(Math.sin(beat))
    return {
      hipsY: 1.0 + e * 0.035 * hop,
      rot: {
        ...base(),
        leftUpperArm: [0, 0, -ARM_DOWN + e * (0.25 + 0.15 * hop)],
        rightUpperArm: [0, 0, ARM_DOWN - e * (0.25 + 0.15 * hop)],
        leftLowerArm: [0, -0.3 * e, -0.08],
        rightLowerArm: [0, 0.3 * e, 0.08],
        leftUpperLeg: [-0.08 * e * (1 - hop), 0, 0],
        rightUpperLeg: [-0.08 * e * (1 - hop), 0, 0],
        spine: [0, 0.04 * e * Math.sin(beat / 2), 0],
        head: [-0.05 * e * hop, 0.05 * e * Math.sin(beat / 2), 0.1 * e * Math.sin(beat / 2)]
      }
    }
  }
}

/** しょんぼり: 肩を落として、うつむき、ゆっくり息をつく */
const sad: MotionDef = {
  name: 'sad',
  durationSec: 3.6,
  stepSec: 0.06,
  pose: (t, dur): PoseFrame => {
    const e = envelope(t, dur, 0.8)
    const breath = Math.sin(TAU * 0.5 * t)
    return {
      rot: {
        ...base(),
        leftUpperArm: [0, 0, -ARM_DOWN - 0.12 * e],
        rightUpperArm: [0, 0, ARM_DOWN + 0.12 * e],
        spine: [0.1 * e + 0.015 * breath * e, 0, 0],
        chest: [0.07 * e, 0, 0],
        neck: [0.1 * e, 0, 0],
        head: [0.22 * e + 0.02 * breath * e, 0.04 * e * Math.sin(TAU * 0.25 * t), 0.05 * e]
      }
    }
  }
}

/** くすぐったい: 身をよじって、肩をすくめ、小さく首をふる */
const ticklish: MotionDef = {
  name: 'ticklish',
  durationSec: 2.2,
  stepSec: 0.04,
  pose: (t, dur): PoseFrame => {
    const e = envelope(t, dur, 0.25)
    const w = Math.sin(TAU * 3.2 * t)
    return {
      rot: {
        ...base(),
        leftUpperArm: [0, -0.25 * e, -ARM_DOWN + 0.2 * e],
        rightUpperArm: [0, 0.25 * e, ARM_DOWN - 0.2 * e],
        leftLowerArm: [0, -0.7 * e, -0.08],
        rightLowerArm: [0, 0.7 * e, 0.08],
        hips: [0, 0.1 * e * w, 0.05 * e * w],
        spine: [0.05 * e, -0.12 * e * w, -0.05 * e * w],
        chest: [0.03 * e, -0.06 * e * w, 0],
        head: [0.1 * e, -0.14 * e * w, 0.1 * e * Math.sin(TAU * 3.2 * t + 1)]
      }
    }
  }
}

/** 首をかしげる: 「ん?」という感じ */
const tilt: MotionDef = {
  name: 'tilt',
  durationSec: 2.0,
  stepSec: 0.05,
  pose: (t, dur): PoseFrame => {
    const e = envelope(t, dur, 0.45)
    return {
      rot: {
        ...base(),
        spine: [0, 0, 0.03 * e],
        neck: [0, 0, 0.1 * e],
        head: [-0.04 * e, 0.06 * e, 0.24 * e]
      }
    }
  }
}

/** 頭を差し出す: 少しうつむいて、なでられるのを待つ(ループ向き。durationSec で長さを決めて使う) */
const offerHead: MotionDef = {
  name: 'offerHead',
  durationSec: 3.0,
  stepSec: 0.06,
  pose: (t, dur): PoseFrame => {
    const e = envelope(t, dur, 0.5)
    const k = TAU * (t / dur)
    return {
      rot: {
        ...base(),
        spine: [0.05 * e, 0, 0],
        neck: [0.08 * e, 0, 0],
        head: [0.2 * e + 0.015 * Math.sin(k) * e, 0.03 * Math.sin(k) * e, 0.07 * e]
      }
    }
  }
}

/** お辞儀 */
const bow: MotionDef = {
  name: 'bow',
  durationSec: 2.6,
  stepSec: 0.05,
  pose: (t, dur): PoseFrame => {
    // 前半でゆっくり倒し、少し止まって、戻る
    const down = smooth(Math.min(1, t / 0.9)) * smooth(Math.min(1, (dur - t) / 0.9))
    const hold = Math.min(1, down * 1.15)
    return {
      rot: {
        ...base(),
        leftUpperArm: [0, -0.15 * hold, -ARM_DOWN + 0.1 * hold],
        rightUpperArm: [0, 0.15 * hold, ARM_DOWN - 0.1 * hold],
        spine: [0.35 * hold, 0, 0],
        chest: [0.2 * hold, 0, 0],
        head: [0.12 * hold, 0, 0]
      }
    }
  }
}

/** ふれあい用の自作モーション(内蔵。配布用パックのルールが使う) */
export const TOUCH_MOTION_DEFS: MotionDef[] = [shy, surprised, happyHop, sad, ticklish, tilt, offerHead, bow]
