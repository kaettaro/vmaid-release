// コネクト 4(7 列 × 6 段。縦に落として、4 つ並べたほうの勝ち)。Electron に依存しない純粋ロジック。
// マスの番号は、左上が 0、右へ、下へ(段 * 7 + 列)。手は「落とす列」(0〜6)。ユーザーとキャラの石は、それぞれ ● の色が違う。

import { parseCommon, pickOne, squash, type BoardView, type GameCommand, type GameDef, type GameMove, type Level, type Outcome, type Player } from './engine'

export const C4_COLS = 7
export const C4_ROWS = 6

export type C4Cell = Player | null
export type C4Board = readonly C4Cell[]

export interface C4State {
  board: C4Board
  turn: Player | null
  /** 直前に落とした石のマス */
  lastIndex: number | null
}

export const emptyC4Board = (): C4Board => Array<C4Cell>(C4_COLS * C4_ROWS).fill(null)

const other = (p: Player): Player => (p === 'user' ? 'char' : 'user')

/** 落とせる列か(その列の一番上が空いている) */
export const canDrop = (board: C4Board, col: number): boolean => Number.isInteger(col) && col >= 0 && col < C4_COLS && board[col] === null

/** 列に落とすと止まるマス(満杯なら -1) */
export function dropRow(board: C4Board, col: number): number {
  if (!canDrop(board, col)) return -1
  for (let r = C4_ROWS - 1; r >= 0; r--) if (board[r * C4_COLS + col] === null) return r
  return -1
}

/** 石を落とした後の盤面と、止まったマス(落とせなければ null) */
export function drop(board: C4Board, col: number, who: Player): { board: C4Board; index: number } | null {
  const r = dropRow(board, col)
  if (r < 0) return null
  const next = [...board]
  const index = r * C4_COLS + col
  next[index] = who
  return { board: next, index }
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
]

/** 4 つ以上並んだ石の並び(最初に見つかったもの)。無ければ null */
export function findFour(board: C4Board): { who: Player; line: number[] } | null {
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const who = board[r * C4_COLS + c]
      if (who === null) continue
      for (const [dr, dc] of DIRS) {
        const line: number[] = []
        for (let k = 0; k < 4; k++) {
          const rr = r + dr * k
          const cc = c + dc * k
          if (rr < 0 || rr >= C4_ROWS || cc < 0 || cc >= C4_COLS || board[rr * C4_COLS + cc] !== who) break
          line.push(rr * C4_COLS + cc)
        }
        if (line.length === 4) return { who, line }
      }
    }
  }
  return null
}

export const isFull = (board: C4Board): boolean => board.every((c) => c !== null)

/** ユーザーから見た結果(続いていれば null) */
export function c4Outcome(board: C4Board): Outcome | null {
  const f = findFour(board)
  if (f) return f.who === 'user' ? 'win' : 'lose'
  return isFull(board) ? 'draw' : null
}

const legalCols = (board: C4Board): number[] => Array.from({ length: C4_COLS }, (_, c) => c).filter((c) => canDrop(board, c))
/** 中央に近い列から(探索で、良い手を先に調べる) */
const CENTER_FIRST = [3, 2, 4, 1, 5, 0, 6]

/** 4 マスの窓の点数(自分の石が多いほど高く、相手の石が多いほど低い) */
function windowScore(mine: number, theirs: number): number {
  if (mine > 0 && theirs > 0) return 0
  if (mine === 3) return 50
  if (mine === 2) return 8
  if (mine === 1) return 1
  if (theirs === 3) return -60
  if (theirs === 2) return -8
  if (theirs === 1) return -1
  return 0
}

/** 盤面の評価(who から見て、大きいほど有利)。中央の列の石に、少し加点 */
export function evaluate(board: C4Board, who: Player): number {
  let score = 0
  for (let r = 0; r < C4_ROWS; r++) if (board[r * C4_COLS + 3] === who) score += 3
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      for (const [dr, dc] of DIRS) {
        const er = r + dr * 3
        const ec = c + dc * 3
        if (er < 0 || er >= C4_ROWS || ec < 0 || ec >= C4_COLS) continue
        let mine = 0
        let theirs = 0
        for (let k = 0; k < 4; k++) {
          const v = board[(r + dr * k) * C4_COLS + c + dc * k]
          if (v === who) mine++
          else if (v !== null) theirs++
        }
        score += windowScore(mine, theirs)
      }
    }
  }
  return score
}

const WIN = 100_000

/** アルファベータ法。me から見た、mover の番の盤面の価値(深さが浅い勝ちほど高く、深い負けほど低くする) */
function search(board: C4Board, depth: number, alpha: number, beta: number, mover: Player, me: Player): number {
  const f = findFour(board)
  if (f) return f.who === me ? WIN + depth : -WIN - depth
  if (isFull(board)) return 0
  if (depth === 0) return evaluate(board, me)
  const cols = CENTER_FIRST.filter((c) => canDrop(board, c))
  if (mover === me) {
    let best = -Infinity
    for (const c of cols) {
      best = Math.max(best, search(drop(board, c, mover)!.board, depth - 1, alpha, beta, other(mover), me))
      alpha = Math.max(alpha, best)
      if (alpha >= beta) break
    }
    return best
  }
  let best = Infinity
  for (const c of cols) {
    best = Math.min(best, search(drop(board, c, mover)!.board, depth - 1, alpha, beta, other(mover), me))
    beta = Math.min(beta, best)
    if (alpha >= beta) break
  }
  return best
}

const DEPTH: Record<Level, number> = { easy: 0, normal: 4, hard: 6 }

/**
 * キャラの手(落とす列)を選ぶ。
 * - easy: 勝てる手があれば打つ。ほかはランダム(相手の勝ちも見逃すことがある)
 * - normal: 4 手先まで読む / hard: 6 手先まで読む(同じ評価の手が複数あれば、ランダム)
 * 落とせる列が無ければ null
 */
export function chooseColumn(board: C4Board, who: Player, level: Level, rng: () => number = Math.random): number | null {
  const cols = legalCols(board)
  if (cols.length === 0) return null
  for (const c of cols) if (findFour(drop(board, c, who)!.board)?.who === who) return c // 勝てる手
  if (level === 'easy') return pickOne(cols, rng)
  const depth = DEPTH[level]
  let bestScore = -Infinity
  let best: number[] = []
  for (const c of CENTER_FIRST.filter((x) => canDrop(board, x))) {
    const score = search(drop(board, c, who)!.board, depth - 1, -Infinity, Infinity, other(who), who)
    if (score > bestScore) {
      bestScore = score
      best = [c]
    } else if (score === bestScore) best.push(c)
  }
  return pickOne(best, rng)
}

// --- チャットでの入力 ---

/** 「3」「3列」「3番」「3に落とす」「真ん中」「左端」「右端」 */
export function parseC4Input(input: string): GameCommand | null {
  const t = squash(input)
  if (t === '') return null
  const common = parseCommon(t)
  if (common) return common
  const tail = '(?:列目?|番|れつ|ばん)?(?:に|へ|を|で)?(?:おく|置く|おとす|落とす|いれる|入れる|する|します|しよう|かな|です)?'
  const n = new RegExp(`^(\\d)${tail}$`).exec(t)
  if (n) {
    const v = Number(n[1])
    return v >= 1 && v <= C4_COLS ? { kind: 'move', move: { to: v - 1 } } : null
  }
  const words: ReadonlyArray<readonly [string, number]> = [
    ['真ん中', 3],
    ['まんなか', 3],
    ['中央', 3],
    ['真中', 3],
    ['左端', 0],
    ['ひだりはし', 0],
    ['右端', 6],
    ['みぎはし', 6]
  ]
  for (const [word, col] of words) if (t.startsWith(word) && new RegExp(`^${tail}$`).test(t.slice(word.length))) return { kind: 'move', move: { to: col } }
  return null
}

const nextState = (board: C4Board, mover: Player, index: number): C4State => ({ board, turn: c4Outcome(board) !== null ? null : other(mover), lastIndex: index })

export const connect4: GameDef<C4State> = {
  id: 'connect4',
  modId: 'game-connect4',
  title: 'コネクト 4',
  size: { width: 380, height: 600 },
  help: 'チャットでも打てます: 「3」(左から 3 列目)「真ん中」「左端」「右端」。「もう一回」「やめる」も使えます。',
  start: (first) => ({ board: emptyC4Board(), turn: first, lastIndex: null }),
  playUser(s, move) {
    if (s.turn !== 'user') return null
    const d = drop(s.board, move.to, 'user')
    return d ? nextState(d.board, 'user', d.index) : null
  },
  playChar(s, level, rng) {
    if (s.turn !== 'char') return null
    const col = chooseColumn(s.board, 'char', level, rng)
    if (col === null) return null
    const d = drop(s.board, col, 'char')!
    return { state: nextState(d.board, 'char', d.index), move: { to: col } }
  },
  view(s): BoardView {
    const f = findFour(s.board)
    const legal: GameMove[] = s.turn === 'user' ? legalCols(s.board).map((c) => ({ to: c })) : []
    return {
      cols: C4_COLS,
      rows: C4_ROWS,
      cells: s.board.map((c) => ({ label: c ? '●' : '', side: c })),
      style: 'drop',
      input: 'column',
      coords: false,
      rankLabels: 'desc',
      flipped: false,
      turn: s.turn,
      outcome: c4Outcome(s.board),
      highlight: f ? f.line : [],
      last: s.lastIndex !== null ? { to: s.lastIndex } : null,
      legal,
      note: null,
      score: null
    }
  },
  parse: parseC4Input
}
