import { buildVrma, type Euler, type MotionDef, type PoseFrame } from './builder'
import { TOUCH_MOTION_DEFS } from './touch'

// 内蔵プリセットモーション。モデルを入れるだけで待機・クリック反応・喋り・ダンスが動くようにする。
// 手書きの簡易モーションなので、凝った動きはユーザーが VRMA を追加して差し替える(同名ならユーザー登録が優先)。

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

const idle: MotionDef = {
  name: 'idle',
  durationSec: 4,
  stepSec: 0.25,
  pose: (t, dur): PoseFrame => {
    const k = (TAU * t) / dur // 1周期で一巡 → ループが繋がる
    return {
      rot: {
        ...base(),
        leftUpperArm: [0, 0, -ARM_DOWN + 0.02 * Math.sin(k)],
        rightUpperArm: [0, 0, ARM_DOWN - 0.02 * Math.sin(k)],
        spine: [0.012 * Math.sin(k), 0, 0],
        chest: [0.02 * Math.sin(k), 0, 0],
        head: [0.02 * Math.sin(k + 1), 0.06 * Math.sin(k), 0.02 * Math.sin(k)]
      }
    }
  }
}

const wave: MotionDef = {
  name: 'wave',
  durationSec: 2.4,
  stepSec: 0.05,
  pose: (t, dur): PoseFrame => {
    const e = envelope(t, dur)
    const swing = Math.sin(TAU * 2.2 * t)
    return {
      rot: {
        ...base(),
        rightUpperArm: [0, 0, lerp(ARM_DOWN, -0.9, e)],
        rightLowerArm: [0, 0, lerp(0.08, -0.5 + 0.4 * swing, e)],
        head: [0, 0.1 * e, 0.08 * e]
      }
    }
  }
}

/** 喋り中のしぐさ(ループ)。小さく頷き、片手が軽く動く */
const talk: MotionDef = {
  name: 'talk',
  durationSec: 2.4,
  stepSec: 0.1,
  pose: (t, dur): PoseFrame => {
    const k = (TAU * t) / dur
    return {
      rot: {
        ...base(),
        rightUpperArm: [0, 0, ARM_DOWN - 0.25 - 0.12 * Math.sin(2 * k)],
        rightLowerArm: [0, 0, 0.08 - 0.35 - 0.15 * Math.sin(2 * k + 1)],
        leftUpperArm: [0, 0, -ARM_DOWN + 0.08 + 0.05 * Math.sin(k)],
        spine: [0.01 * Math.sin(2 * k), 0, 0],
        chest: [0.02 * Math.sin(2 * k), 0, 0],
        head: [0.05 * Math.sin(2 * k), 0.07 * Math.sin(k), 0.03 * Math.sin(k + 1)]
      }
    }
  }
}

const nod: MotionDef = {
  name: 'nod',
  durationSec: 1.2,
  stepSec: 0.05,
  pose: (t, dur): PoseFrame => {
    const k = t / dur
    return { rot: { ...base(), head: [0.3 * Math.sin(TAU * k * 2) * envelope(t, dur, 0.15), 0, 0], neck: [0.08 * Math.sin(TAU * k * 2), 0, 0] } }
  }
}

const dance1: MotionDef = {
  name: 'dance1',
  durationSec: 4,
  stepSec: 0.05,
  pose: (t, dur): PoseFrame => {
    const e = envelope(t, dur, 0.5)
    const beat = TAU * t // 1秒1拍
    const s = Math.sin(beat)
    return {
      hipsY: 1.0 + e * 0.025 * Math.abs(Math.cos(beat)),
      rot: {
        ...base(),
        hips: [0, 0, e * 0.07 * s],
        spine: [0, 0, e * -0.05 * s],
        leftUpperArm: [0, 0, lerp(-ARM_DOWN, lerp(-1.2, 0.9, (s + 1) / 2), e)],
        rightUpperArm: [0, 0, lerp(ARM_DOWN, lerp(1.2, -0.9, (1 - s) / 2), e)],
        head: [0, e * 0.1 * s, e * 0.08 * Math.cos(beat)]
      }
    }
  }
}

/** 両腕を揃えて上げ下げし、ひざを使って弾む */
const dance2: MotionDef = {
  name: 'dance2',
  durationSec: 4,
  stepSec: 0.05,
  pose: (t, dur): PoseFrame => {
    const e = envelope(t, dur, 0.5)
    const beat = TAU * 1.5 * t
    const s = (Math.sin(beat) + 1) / 2
    return {
      hipsY: 1.0 - e * 0.03 * Math.abs(Math.sin(beat)),
      rot: {
        ...base(),
        leftUpperArm: [0, 0, lerp(-ARM_DOWN, lerp(-1.0, 1.0, s), e)],
        rightUpperArm: [0, 0, lerp(ARM_DOWN, lerp(1.0, -1.0, s), e)],
        leftUpperLeg: [-e * 0.12 * Math.abs(Math.sin(beat)), 0, 0],
        rightUpperLeg: [-e * 0.12 * Math.abs(Math.sin(beat)), 0, 0],
        head: [e * 0.06 * Math.sin(beat * 2), 0, 0]
      }
    }
  }
}

/** 腕を横に広げて左右に揺れ、上半身をひねる */
const dance3: MotionDef = {
  name: 'dance3',
  durationSec: 4.8,
  stepSec: 0.05,
  pose: (t, dur): PoseFrame => {
    const e = envelope(t, dur, 0.6)
    const beat = TAU * 0.8 * t
    const s = Math.sin(beat)
    return {
      hipsY: 1.0 + e * 0.015 * Math.cos(beat * 2),
      rot: {
        ...base(),
        hips: [0, e * 0.15 * s, e * 0.05 * s],
        spine: [0, e * -0.1 * s, 0],
        leftUpperArm: [0, 0, lerp(-ARM_DOWN, -0.3 + 0.25 * s, e)],
        rightUpperArm: [0, 0, lerp(ARM_DOWN, 0.3 + 0.25 * s, e)],
        head: [0, e * 0.15 * s, e * 0.1 * s]
      }
    }
  }
}

/**
 * 歩行(ループ)。足を交互に出し、腕を逆に振り、体を少し弾ませる。1 周期 1 秒で、始めと終わりが同じ姿勢(ループが繋がる)。
 * 移動の Mod が、歩くときに使う(「歩行」タグ)。位置は動かさない(ウィンドウのほうが動く)
 */
const walk: MotionDef = {
  name: 'walk',
  durationSec: 1,
  stepSec: 0.05,
  pose: (t, dur): PoseFrame => {
    const k = (TAU * t) / dur
    const swing = Math.sin(k)
    return {
      // 足が交差する(両足が体の下に来る)ときが、いちばん高い
      hipsY: 0.985 + 0.015 * Math.cos(2 * k),
      rot: {
        ...base(),
        // 前へ出す足は、負の回転(足が下を向いているので)。ひざは、足が前へ出る途中で曲がる
        leftUpperLeg: [-0.5 * swing, 0, 0],
        rightUpperLeg: [0.5 * swing, 0, 0],
        leftLowerLeg: [0.1 + 0.7 * Math.max(0, Math.cos(k)), 0, 0],
        rightLowerLeg: [0.1 + 0.7 * Math.max(0, -Math.cos(k)), 0, 0],
        // 腕は、同じ側の足と逆に振る
        leftUpperArm: [0.4 * swing, 0, -ARM_DOWN],
        rightUpperArm: [-0.4 * swing, 0, ARM_DOWN],
        hips: [0, 0.08 * swing, 0],
        spine: [0.03, -0.06 * swing, 0],
        head: [0, 0.03 * swing, 0]
      }
    }
  }
}

export const BUILTIN_MOTION_DEFS: MotionDef[] = [idle, wave, talk, nod, dance1, dance2, dance3, walk, ...TOUCH_MOTION_DEFS]
export const BUILTIN_MOTION_NAMES: string[] = BUILTIN_MOTION_DEFS.map((m) => m.name)

/**
 * 内蔵モーションが最初から持つタグ(利用者は外せない。ほかのタグを足すのは自由)。
 * 以前の「モーショングループ」(reaction = wave, nod / dance = dance1〜3)の代わり。ルールの playMotion は、タグでも選べる
 */
export const BUILTIN_MOTION_TAGS: Record<string, string[]> = {
  idle: ['待機'],
  wave: ['あいさつ', 'リアクション'],
  talk: ['会話'],
  nod: ['リアクション'],
  dance1: ['ダンス'],
  dance2: ['ダンス'],
  dance3: ['ダンス'],
  walk: ['歩行'],
  shy: ['ふれあい'],
  surprised: ['ふれあい'],
  happyHop: ['ふれあい'],
  sad: ['ふれあい'],
  ticklish: ['ふれあい'],
  tilt: ['ふれあい'],
  offerHead: ['ふれあい'],
  bow: ['ふれあい', 'あいさつ']
}
/** 既定の待機モーション・喋り中モーションの登録名 */
export const DEFAULT_IDLE_MOTION = 'idle'
export const TALK_MOTION = 'talk'

/** 起動時に1回だけ呼ぶ想定(数十KB×7)。ファイルは同梱しない */
export function generateBuiltinMotions(): Array<{ name: string; data: Uint8Array }> {
  return BUILTIN_MOTION_DEFS.map((def) => ({ name: def.name, data: buildVrma(def) }))
}
