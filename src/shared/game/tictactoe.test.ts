import { describe, expect, it } from 'vitest'
import { canPlace, chooseMove, emptyBoard, judge, outcomeOf, parseGameCommand, place, type Board, type Cell } from './tictactoe'

const b = (s: string): Board => [...s.replace(/\s/g, '')].map((c): Cell => (c === 'o' ? 'o' : c === 'x' ? 'x' : null))

describe('盤面と勝敗', () => {
  it('空の盤面。打てるマスと、打てないマス', () => {
    const e = emptyBoard()
    expect(e).toHaveLength(9)
    expect(canPlace(e, 0)).toBe(true)
    expect(canPlace(e, 9)).toBe(false)
    expect(canPlace(e, -1)).toBe(false)
    expect(canPlace(e, 1.5)).toBe(false)
    const next = place(e, 4, 'o')
    expect(next[4]).toBe('o')
    expect(canPlace(next, 4)).toBe(false)
    expect(place(next, 4, 'x')).toBe(next) // 打てなければ、元の盤面
    expect(e[4]).toBeNull() // 元の盤面は変えない
  })

  it('縦・横・斜めの三目で勝ち。引き分け。まだ続く', () => {
    expect(judge(b('ooo xx. ...')).winner).toBe('o')
    expect(judge(b('x.. x.. x.o')).winner).toBe('x')
    expect(judge(b('o.. .o. ..o')).line).toEqual([0, 4, 8])
    expect(judge(b('oxo oxx xox')).draw).toBe(true)
    expect(judge(b('o.. ... ...'))).toEqual({ winner: null, line: null, draw: false })
  })

  it('ユーザー(○)から見た結果', () => {
    expect(outcomeOf(b('ooo xx. ...'))).toBe('win')
    expect(outcomeOf(b('xxx oo. o..'))).toBe('lose')
    expect(outcomeOf(b('oxo oxx xox'))).toBe('draw')
    expect(outcomeOf(b('o.. ... ...'))).toBeNull()
  })
})

describe('キャラの手', () => {
  const fixed = (v: number) => () => v
  it('勝てる手があれば、必ず打つ(easy でも normal でも)', () => {
    const board = b('xx. oo. ...')
    expect(chooseMove(board, 'x', 'normal')).toBe(2)
    expect(chooseMove(board, 'x', 'easy', fixed(0.9))).toBe(2)
  })

  it('normal: 相手の勝ちを防ぐ。中央を取る。角を取る', () => {
    expect(chooseMove(b('oo. ... x..'), 'x', 'normal')).toBe(2)
    expect(chooseMove(b('o.. ... ...'), 'x', 'normal')).toBe(4)
    expect(chooseMove(b('... .o. ...'), 'x', 'normal', fixed(0))).toBe(0)
  })

  it('打てるマスが無ければ null。打てるマスは、必ず空いている', () => {
    expect(chooseMove(b('oxo oxx xox'), 'x', 'normal')).toBeNull()
    for (let i = 0; i < 20; i++) {
      const board = b('ox. ... ..o')
      const m = chooseMove(board, 'x', 'easy', () => (i % 10) / 10)
      expect(m).not.toBeNull()
      expect(canPlace(board, m!)).toBe(true)
    }
  })

  it('normal のキャラは、ランダムなユーザーに、負けない(1000 局)', () => {
    let seed = 12345
    const rng = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    let losses = 0
    for (let g = 0; g < 1000; g++) {
      let board = emptyBoard()
      let turn: 'user' | 'char' = g % 2 === 0 ? 'user' : 'char'
      while (outcomeOf(board) === null) {
        const m = turn === 'user' ? chooseMove(board, 'o', 'easy', rng) : chooseMove(board, 'x', 'normal', rng)
        board = place(board, m!, turn === 'user' ? 'o' : 'x')
        turn = turn === 'user' ? 'char' : 'user'
      }
      if (outcomeOf(board) === 'win') losses++
    }
    // ランダムな相手には、ほぼ負けない(2 手先の罠を作らない単純な手なので、ゼロにはならない)
    expect(losses).toBeLessThan(60)
  })
})

describe('チャットの入力', () => {
  it('番号・行と列・位置の言葉で、マスを選べる(全角・空白・記号は無視)', () => {
    expect(parseGameCommand('5')).toEqual({ kind: 'move', index: 4 })
    expect(parseGameCommand(' 5番 ')).toEqual({ kind: 'move', index: 4 })
    expect(parseGameCommand('9に置く')).toEqual({ kind: 'move', index: 8 })
    expect(parseGameCommand('3の2')).toEqual({ kind: 'move', index: 7 })
    expect(parseGameCommand('3の2!')).toEqual({ kind: 'move', index: 7 })
    expect(parseGameCommand('1行3列')).toEqual({ kind: 'move', index: 2 })
    expect(parseGameCommand('2の2')).toEqual({ kind: 'move', index: 4 })
    expect(parseGameCommand('左上')).toEqual({ kind: 'move', index: 0 })
    expect(parseGameCommand('右下にする')).toEqual({ kind: 'move', index: 8 })
    expect(parseGameCommand('真ん中')).toEqual({ kind: 'move', index: 4 })
    expect(parseGameCommand('中央')).toEqual({ kind: 'move', index: 4 })
    expect(parseGameCommand('上')).toEqual({ kind: 'move', index: 1 })
    expect(parseGameCommand('左')).toEqual({ kind: 'move', index: 3 })
  })

  it('範囲外の数字・ふつうの会話は null(会話として扱う)', () => {
    for (const t of ['0', '10', '9の9', '4の1', '今日はいい天気だね', '', '   ', '左手が痛い', 'おなかすいた']) {
      expect(parseGameCommand(t)).toBeNull()
    }
  })

  it('やめる・もう一回', () => {
    for (const t of ['やめる', 'やめよう', '終わり', '中止', 'ストップ', 'もういい']) expect(parseGameCommand(t)).toEqual({ kind: 'stop' })
    for (const t of ['もう一回', 'もう一度!', 'リセット', '最初から']) expect(parseGameCommand(t)).toEqual({ kind: 'restart' })
  })
})
