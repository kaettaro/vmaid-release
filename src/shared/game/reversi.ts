// リバーシ(8 × 8。相手の石を挟んで、ひっくり返す。石の多いほうの勝ち)。Electron に依存しない純粋ロジック。
// マスの番号は、左上(a1)が 0、右へ、下へ(行 * 8 + 列)。先に打つ人が黒。打てる手が無いときは、パス(自動)。

import { parseCommon, pickOne, squash, type BoardView, type GameCommand, type GameDef, type GameMove, type Level, type Outcome, type Player } from './engine'

export const RV_SIZE = 8

export type RvCell = Player | null
export type RvBoard = readonly RvCell[]

export interface RvState {
  board: RvBoard
  /** 次に打つ人(終わっていれば null) */
  turn: Player | null
  /** 先に打つ人(黒) */
  first: Player
  /** 直前の手のマス */
  lastIndex: number | null
  /** 直前に、パスした人(次の手番の人が、打てる手が無くて、飛ばされた)。表示用 */
  passed: Player | null
}

const other = (p: Player): Player => (p === 'user' ? 'char' : 'user')
const at = (r: number, c: number): number => r * RV_SIZE + c

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1]
]

/** 初期配置: 中央の 4 つ。(3,3)(4,4)が後手(白)、(3,4)(4,3)が先手(黒) */
export function initialBoard(first: Player): RvBoard {
  const b = Array<RvCell>(RV_SIZE * RV_SIZE).fill(null)
  b[at(3, 3)] = other(first)
  b[at(4, 4)] = other(first)
  b[at(3, 4)] = first
  b[at(4, 3)] = first
  return b
}

/** who が index に打ったときに、ひっくり返るマス(打てなければ、空) */
export function flipsFor(board: RvBoard, index: number, who: Player): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= RV_SIZE * RV_SIZE || board[index] !== null) return []
  const r0 = Math.floor(index / RV_SIZE)
  const c0 = index % RV_SIZE
  const flips: number[] = []
  for (const [dr, dc] of DIRS) {
    const line: number[] = []
    let r = r0 + dr
    let c = c0 + dc
    while (r >= 0 && r < RV_SIZE && c >= 0 && c < RV_SIZE && board[at(r, c)] === other(who)) {
      line.push(at(r, c))
      r += dr
      c += dc
    }
    if (line.length > 0 && r >= 0 && r < RV_SIZE && c >= 0 && c < RV_SIZE && board[at(r, c)] === who) flips.push(...line)
  }
  return flips
}

/** who が打てるマス */
export function legalMoves(board: RvBoard, who: Player): number[] {
  const out: number[] = []
  for (let i = 0; i < RV_SIZE * RV_SIZE; i++) if (flipsFor(board, i, who).length > 0) out.push(i)
  return out
}

/** 打った後の盤面(打てなければ null) */
export function play(board: RvBoard, index: number, who: Player): RvBoard | null {
  const flips = flipsFor(board, index, who)
  if (flips.length === 0) return null
  const next = [...board]
  next[index] = who
  for (const f of flips) next[f] = who
  return next
}

export const countStones = (board: RvBoard): { user: number; char: number } => ({
  user: board.filter((c) => c === 'user').length,
  char: board.filter((c) => c === 'char').length
})

/** ユーザーから見た結果(石の数) */
export function rvOutcome(board: RvBoard): Outcome {
  const n = countStones(board)
  return n.user > n.char ? 'win' : n.user < n.char ? 'lose' : 'draw'
}

/**
 * 手を打ったあとの状態。次の人が打てなければパス(その人の手番を飛ばす)、両方打てなければ終了。
 */
function after(board: RvBoard, mover: Player, first: Player, lastIndex: number): RvState {
  const opp = other(mover)
  if (legalMoves(board, opp).length > 0) return { board, turn: opp, first, lastIndex, passed: null }
  if (legalMoves(board, mover).length > 0) return { board, turn: mover, first, lastIndex, passed: opp }
  return { board, turn: null, first, lastIndex, passed: null }
}

/** 位置の価値(角が大きく、角の隣は小さい) */
const WEIGHTS: readonly number[] = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, -1, -1, -1, -1, -2, 10,
  5, -2, -1, -1, -1, -1, -2, 5,
  5, -2, -1, -1, -1, -1, -2, 5,
  10, -2, -1, -1, -1, -1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100
]

/** 盤面の評価(me から見て大きいほど有利): 位置の価値 + 打てる手の数の差 */
function evaluate(board: RvBoard, me: Player): number {
  let pos = 0
  for (let i = 0; i < board.length; i++) {
    if (board[i] === me) pos += WEIGHTS[i]
    else if (board[i] !== null) pos -= WEIGHTS[i]
  }
  return pos + 3 * (legalMoves(board, me).length - legalMoves(board, other(me)).length)
}

const DEPTH: Record<Level, number> = { easy: 0, normal: 2, hard: 4 }

function search(board: RvBoard, depth: number, alpha: number, beta: number, mover: Player, me: Player): number {
  const mine = legalMoves(board, mover)
  if (mine.length === 0) {
    // パス。両方打てなければ、石の数の差(大きく)
    if (legalMoves(board, other(mover)).length === 0) {
      const n = countStones(board)
      return (me === 'user' ? n.user - n.char : n.char - n.user) * 1000
    }
    return search(board, depth, alpha, beta, other(mover), me)
  }
  if (depth === 0) return evaluate(board, me)
  if (mover === me) {
    let best = -Infinity
    for (const m of mine) {
      best = Math.max(best, search(play(board, m, mover)!, depth - 1, alpha, beta, other(mover), me))
      alpha = Math.max(alpha, best)
      if (alpha >= beta) break
    }
    return best
  }
  let best = Infinity
  for (const m of mine) {
    best = Math.min(best, search(play(board, m, mover)!, depth - 1, alpha, beta, other(mover), me))
    beta = Math.min(beta, best)
    if (alpha >= beta) break
  }
  return best
}

/**
 * キャラの手を選ぶ。
 * - easy: 打てる手からランダム(ただし、角が取れるなら取る)
 * - normal: 位置の価値と打てる手の数を見て、2 手先まで読む / hard: 4 手先まで読む
 * 打てる手が無ければ null
 */
export function chooseRvMove(board: RvBoard, who: Player, level: Level, rng: () => number = Math.random): number | null {
  const moves = legalMoves(board, who)
  if (moves.length === 0) return null
  const corners = moves.filter((m) => m === 0 || m === 7 || m === 56 || m === 63)
  if (level === 'easy') return pickOne(corners.length > 0 ? corners : moves, rng)
  const depth = DEPTH[level]
  let bestScore = -Infinity
  let best: number[] = []
  for (const m of moves) {
    const score = search(play(board, m, who)!, depth - 1, -Infinity, Infinity, other(who), who)
    if (score > bestScore) {
      bestScore = score
      best = [m]
    } else if (score === bestScore) best.push(m)
  }
  return pickOne(best, rng)
}

// --- チャットでの入力 ---

/** 「d3」「D-3」「d3に置く」(列は a〜h、行は 1〜8)、「3行4列」(行 3・列 4) */
export function parseRvInput(input: string): GameCommand | null {
  const t = squash(input)
  if (t === '') return null
  const common = parseCommon(t)
  if (common) return common
  const tail = '(?:に|へ|を|で)?(?:おく|置く|おきたい|置きたい|する|します|しよう|かな|です)?'
  const alg = new RegExp(`^([a-h])([1-8])${tail}$`).exec(t)
  if (alg) return { kind: 'move', move: { to: at(Number(alg[2]) - 1, alg[1].charCodeAt(0) - 97) } }
  const rc = new RegExp(`^([1-8])行([1-8])列${tail}$`).exec(t)
  if (rc) return { kind: 'move', move: { to: at(Number(rc[1]) - 1, Number(rc[2]) - 1) } }
  return null
}

const fresh = (first: Player): RvState => ({ board: initialBoard(first), turn: first, first, lastIndex: null, passed: null })

export const reversi: GameDef<RvState> = {
  id: 'reversi',
  modId: 'game-reversi',
  title: 'リバーシ',
  size: { width: 400, height: 640 },
  help: 'チャットでも打てます: 「d3」(列 a〜h と行 1〜8)「3行4列」。打てる所には点が出ます。「もう一回」「やめる」も使えます。',
  start: (first) => fresh(first),
  playUser(s, move) {
    if (s.turn !== 'user') return null
    const board = play(s.board, move.to, 'user')
    return board ? after(board, 'user', s.first, move.to) : null
  },
  playChar(s, level, rng) {
    if (s.turn !== 'char') return null
    const m = chooseRvMove(s.board, 'char', level, rng)
    if (m === null) return null
    return { state: after(play(s.board, m, 'char')!, 'char', s.first, m), move: { to: m } }
  },
  view(s): BoardView {
    const n = countStones(s.board)
    const legal: GameMove[] = s.turn === 'user' ? legalMoves(s.board, 'user').map((to) => ({ to })) : []
    const outcome = s.turn === null ? rvOutcome(s.board) : null
    return {
      cols: RV_SIZE,
      rows: RV_SIZE,
      cells: s.board.map((c) => ({ label: c ? '●' : '', side: c })),
      style: 'checker',
      input: 'cell',
      coords: true,
      rankLabels: 'asc',
      flipped: false,
      turn: s.turn,
      outcome,
      highlight: [],
      last: s.lastIndex !== null ? { to: s.lastIndex } : null,
      legal,
      note: s.passed ? (s.passed === 'user' ? 'あなたは打てる所が無いので、パスしました' : 'キャラは打てる所が無いので、パスしました') : null,
      score: `あなた ${n.user} - ${n.char} キャラ`
    }
  },
  parse: parseRvInput
}
