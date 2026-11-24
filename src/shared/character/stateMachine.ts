// キャラの状態機械(SPEC 4.1)。副作用は返す effects に任せ、ここは純粋関数にする

export type CharState =
  | { kind: 'idle' }
  | { kind: 'speaking' }
  | { kind: 'oneShot'; clip: string }

export type CharEvent =
  | { type: 'oneShot'; clip: string } // クリック反応・ルール発火の単発モーション要求
  | { type: 'oneShotEnded' }
  | { type: 'speakStart' }
  | { type: 'speakEnd' }

export type CharEffect =
  | { type: 'playIdle' }
  | { type: 'playSpeaking' }
  | { type: 'playOneShot'; clip: string }
  | { type: 'stopOneShot' }

export interface Transition {
  state: CharState
  effects: CharEffect[]
}

export const initialState: CharState = { kind: 'idle' }

/**
 * - speakStart で speaking(喋り中モーションのループ)へ。speakEnd で idle に戻る
 * - idle で oneShot 要求 → 再生
 * - oneShot 再生中・speaking 中の oneShot 要求は破棄(連打や発話中の割り込みを避ける)
 * - oneShot は終了すると idle に戻る
 * - speakStart は oneShot を中断して speaking へ
 */
export function transition(state: CharState, event: CharEvent): Transition {
  const stay: Transition = { state, effects: [] }
  switch (event.type) {
    case 'oneShot':
      return state.kind === 'idle'
        ? { state: { kind: 'oneShot', clip: event.clip }, effects: [{ type: 'playOneShot', clip: event.clip }] }
        : stay
    case 'oneShotEnded':
      return state.kind === 'oneShot' ? { state: { kind: 'idle' }, effects: [{ type: 'playIdle' }] } : stay
    case 'speakStart':
      if (state.kind === 'speaking') return stay
      return {
        state: { kind: 'speaking' },
        effects: state.kind === 'oneShot' ? [{ type: 'stopOneShot' }, { type: 'playSpeaking' }] : [{ type: 'playSpeaking' }]
      }
    case 'speakEnd':
      return state.kind === 'speaking' ? { state: { kind: 'idle' }, effects: [{ type: 'playIdle' }] } : stay
  }
}

/** 乱数注入可能な単純抽選。空なら undefined */
export function pickRandom<T>(items: readonly T[], rng: () => number): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}
