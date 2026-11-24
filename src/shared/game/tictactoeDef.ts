// ○×(三目並べ)を、共通の GameDef にしたもの。ロジックは tictactoe.ts のまま(ユーザーが ○、キャラが ×。先攻は、設定で決める)。

import { parseCommon, squash, type BoardView, type GameCommand, type GameDef, type GameMove, type Level, type Outcome, type Player } from './engine'
import { MARK_OF, canPlace, chooseMove, emptyBoard, judge, outcomeOf, parseGameCommand, place, type Board } from './tictactoe'

export interface TttState {
  board: Board
  turn: Player | null
}

const next = (board: Board, mover: Player): TttState => {
  const done = outcomeOf(board) !== null
  return { board, turn: done ? null : mover === 'user' ? 'char' : 'user' }
}

export const tictactoe: GameDef<TttState> = {
  id: 'tictactoe',
  modId: 'game',
  title: '○×ゲーム',
  size: { width: 320, height: 540 },
  help: 'チャットでも打てます: 「5」「3の2」「左上」「真ん中」。「もう一回」「やめる」も使えます。',
  start: (first) => ({ board: emptyBoard(), turn: first }),
  playUser(s, move) {
    if (s.turn !== 'user' || !canPlace(s.board, move.to)) return null
    return next(place(s.board, move.to, MARK_OF.user), 'user')
  },
  playChar(s, level: Level, rng) {
    if (s.turn !== 'char') return null
    const index = chooseMove(s.board, MARK_OF.char, level === 'easy' ? 'easy' : 'normal', rng)
    if (index === null) return null
    return { state: next(place(s.board, index, MARK_OF.char), 'char'), move: { to: index } }
  },
  view(s): BoardView {
    const j = judge(s.board)
    const outcome: Outcome | null = outcomeOf(s.board)
    const legal: GameMove[] = s.turn === 'user' ? s.board.flatMap((c, i) => (c === null ? [{ to: i }] : [])) : []
    return {
      cols: 3,
      rows: 3,
      cells: s.board.map((c) => ({ label: c === 'o' ? '○' : c === 'x' ? '×' : '', side: c === 'o' ? 'user' : c === 'x' ? 'char' : null })),
      style: 'grid',
      input: 'cell',
      coords: false,
      rankLabels: 'desc',
      flipped: false,
      turn: s.turn,
      outcome,
      highlight: j.line ? [...j.line] : [],
      last: null,
      legal,
      note: null,
      score: null
    }
  },
  parse(text): GameCommand | null {
    const c = parseGameCommand(text)
    if (!c) return parseCommon(squash(text))
    return c.kind === 'move' ? { kind: 'move', move: { to: c.index } } : { kind: c.kind }
  }
}
