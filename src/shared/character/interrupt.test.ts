import { describe, expect, it } from 'vitest'
import { initialState, transition, type CharState } from './stateMachine'

// 「試し再生」は、いまのモーション・喋り中を、いったん終わらせてから、新しいモーションを始める(characterController.playOneShot の interrupt)。
// その手順(oneShotEnded / speakEnd → oneShot)が、状態機械の上で、成り立つことを確かめる
describe('割り込み再生の手順', () => {
  const run = (s: CharState, ...events: Parameters<typeof transition>[1][]): CharState => events.reduce((cur, e) => transition(cur, e).state, s)

  it('再生中のモーションは、終わらせれば、すぐ次のモーションを始められる(通常は、再生中の要求は破棄される)', () => {
    const playing = run(initialState, { type: 'oneShot', clip: 'dance1' })
    expect(transition(playing, { type: 'oneShot', clip: 'wave' }).state).toEqual({ kind: 'oneShot', clip: 'dance1' }) // 割り込みなしでは、破棄
    expect(run(playing, { type: 'oneShotEnded' }, { type: 'oneShot', clip: 'wave' })).toEqual({ kind: 'oneShot', clip: 'wave' })
  })

  it('喋り中も、喋り終わりにしてから、次を始められる', () => {
    const speaking = run(initialState, { type: 'speakStart' })
    expect(transition(speaking, { type: 'oneShot', clip: 'wave' }).state).toEqual({ kind: 'speaking' })
    expect(run(speaking, { type: 'speakEnd' }, { type: 'oneShot', clip: 'wave' })).toEqual({ kind: 'oneShot', clip: 'wave' })
  })
})
