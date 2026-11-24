import { describe, expect, it } from 'vitest'
import { dismissed, escAction, hasVisibleBubble, isBusy, isEscapeKey, type BubbleVisibility } from './dismiss'

const idle: BubbleVisibility = { inputOpen: false, lastUser: null, reply: '', status: 'idle', error: null, prep: null, emotion: null }

describe('Esc で吹き出しを閉じる', () => {
  it('吹き出しが何も無ければ、Esc は何もしない(他へ譲る)', () => {
    expect(hasVisibleBubble(idle)).toBe(false)
    expect(escAction(idle)).toEqual({ handled: false, abort: false })
  })

  it('入力欄・送った文・返答・エラーの、どれか 1 つでも見えていれば、Esc で閉じる(返答中でなければ、中断しない)', () => {
    for (const s of [{ inputOpen: true }, { lastUser: 'やあ' }, { reply: 'こんにちは' }, { status: 'error' as const, error: 'x' }]) {
      expect(escAction({ ...idle, ...s })).toEqual({ handled: true, abort: false })
    }
  })

  it('返答待ち・返答中の Esc は、中断して、閉じる', () => {
    expect(isBusy({ status: 'waiting' })).toBe(true)
    expect(isBusy({ status: 'streaming' })).toBe(true)
    expect(isBusy({ status: 'idle' })).toBe(false)
    expect(escAction({ ...idle, status: 'streaming', reply: 'こん' })).toEqual({ handled: true, abort: true })
  })

  it('閉じたあと: 入力欄・送った文・返答・エラー・準備中・感情が、すべて消える。返答中の status は、完了の通知まで、そのまま', () => {
    const open = { ...idle, inputOpen: true, lastUser: 'やあ', reply: 'こん', error: 'e', prep: {}, emotion: 'joy', status: 'idle' as const }
    expect(dismissed(open)).toEqual(idle)
    expect(dismissed({ ...open, status: 'streaming' }).status).toBe('streaming')
    expect(hasVisibleBubble(dismissed({ ...open, status: 'error' }))).toBe(false)
  })

  it('Esc のキー判定: key / code / keyCode のどれでも。IME の変換中は、Esc として扱わない', () => {
    expect(isEscapeKey({ key: 'Escape' })).toBe(true)
    expect(isEscapeKey({ key: 'Process', code: 'Escape', keyCode: 229 })).toBe(true) // IME が ON で、key が Escape にならない
    expect(isEscapeKey({ keyCode: 27 })).toBe(true)
    expect(isEscapeKey({ key: 'Escape', isComposing: true })).toBe(false)
    expect(isEscapeKey({ key: 'Enter', code: 'Enter', keyCode: 13 })).toBe(false)
  })
})
