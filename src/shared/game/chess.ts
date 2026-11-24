// チェス(標準ルール。キャスリング・アンパッサン・プロモーション・チェック・チェックメイト・ステイルメイト)。Electron に依存しない純粋ロジック。
// マスの番号は、左上(a8)が 0、右へ、下へ(段 * 8 + ファイル)。駒は 1 文字: 白は大文字(PNBRQK)、黒は小文字(pnbrqk)、空きは '.'。
// 未対応: 3 回同じ形になったときの引き分け(50 手ルール・駒が足りないときの引き分けは、対応している)。

import { parseCommon, pickOne, squash, type BoardView, type GameCommand, type GameDef, type GameMove, type Level, type Outcome, type Player } from './engine'

export type Color = 'w' | 'b'
export type PromoPiece = 'q' | 'r' | 'b' | 'n'

export interface Castling {
  wk: boolean
  wq: boolean
  bk: boolean
  bq: boolean
}

export interface Position {
  /** 64 マス。'.' は空き */
  board: string[]
  turn: Color
  castling: Castling
  /** アンパッサンで取れる(通り過ぎた)マス。無ければ null */
  ep: number | null
  /** 最後にポーンを動かす・駒を取ってからの、半手の数(50 手ルール) */
  halfmove: number
  fullmove: number
}

export interface Move {
  from: number
  to: number
  promo?: PromoPiece
}

const FILES = 'abcdefgh'
export const squareName = (i: number): string => `${FILES[i & 7]}${8 - (i >> 3)}`
export function parseSquare(s: string): number | null {
  const m = /^([a-h])([1-8])$/.exec(s)
  return m ? (8 - Number(m[2])) * 8 + (m[1].charCodeAt(0) - 97) : null
}

export const colorOf = (p: string): Color | null => (p === '.' ? null : p === p.toUpperCase() ? 'w' : 'b')
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export function fromFen(fen: string): Position {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/)
  const board: string[] = []
  for (const ch of placement) {
    if (ch === '/') continue
    if (/\d/.test(ch)) for (let k = 0; k < Number(ch); k++) board.push('.')
    else board.push(ch)
  }
  if (board.length !== 64) throw new Error('FEN の盤面が 64 マスではありません')
  return {
    board,
    turn: turn === 'b' ? 'b' : 'w',
    castling: { wk: castling?.includes('K') ?? false, wq: castling?.includes('Q') ?? false, bk: castling?.includes('k') ?? false, bq: castling?.includes('q') ?? false },
    ep: ep && ep !== '-' ? parseSquare(ep) : null,
    halfmove: Number(half ?? 0) || 0,
    fullmove: Number(full ?? 1) || 1
  }
}

export const startPosition = (): Position => fromFen(START_FEN)

const KNIGHT: ReadonlyArray<readonly [number, number]> = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
const KING: ReadonlyArray<readonly [number, number]> = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
const BISHOP: ReadonlyArray<readonly [number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const ROOK: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]]

const inBoard = (r: number, c: number): boolean => r >= 0 && r < 8 && c >= 0 && c < 8

/** マス sq が、色 by の駒に攻撃されているか */
export function isAttacked(board: readonly string[], sq: number, by: Color): boolean {
  const r = sq >> 3
  const c = sq & 7
  const pawn = by === 'w' ? 'P' : 'p'
  // ポーン: 白のポーンは、1 つ下の段(r + 1)から、斜め上を攻撃する
  const pr = by === 'w' ? r + 1 : r - 1
  for (const dc of [-1, 1]) if (inBoard(pr, c + dc) && board[pr * 8 + c + dc] === pawn) return true
  const knight = by === 'w' ? 'N' : 'n'
  for (const [dr, dc] of KNIGHT) if (inBoard(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === knight) return true
  const king = by === 'w' ? 'K' : 'k'
  for (const [dr, dc] of KING) if (inBoard(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === king) return true
  const slider = (dirs: ReadonlyArray<readonly [number, number]>, a: string, b: string): boolean => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr
      let cc = c + dc
      while (inBoard(rr, cc)) {
        const p = board[rr * 8 + cc]
        if (p !== '.') {
          if (p === a || p === b) return true
          break
        }
        rr += dr
        cc += dc
      }
    }
    return false
  }
  const q = by === 'w' ? 'Q' : 'q'
  return slider(BISHOP, by === 'w' ? 'B' : 'b', q) || slider(ROOK, by === 'w' ? 'R' : 'r', q)
}

const kingSquare = (board: readonly string[], color: Color): number => board.indexOf(color === 'w' ? 'K' : 'k')

export function inCheck(pos: Position, color: Color = pos.turn): boolean {
  const k = kingSquare(pos.board, color)
  return k >= 0 && isAttacked(pos.board, k, other(color))
}

const PROMOS: readonly PromoPiece[] = ['q', 'r', 'b', 'n']

/** 駒の動き(自分の王が取られるかは、まだ見ない) */
function pseudoMoves(pos: Position): Move[] {
  const { board, turn } = pos
  const out: Move[] = []
  const white = turn === 'w'
  for (let from = 0; from < 64; from++) {
    const p = board[from]
    if (p === '.' || colorOf(p) !== turn) continue
    const r = from >> 3
    const c = from & 7
    const kind = p.toLowerCase()
    if (kind === 'p') {
      const dir = white ? -1 : 1
      const startRow = white ? 6 : 1
      const lastRow = white ? 0 : 7
      const push = (to: number): void => {
        if (to >> 3 === lastRow) for (const promo of PROMOS) out.push({ from, to, promo })
        else out.push({ from, to })
      }
      const one = (r + dir) * 8 + c
      if (inBoard(r + dir, c) && board[one] === '.') {
        push(one)
        const two = (r + 2 * dir) * 8 + c
        if (r === startRow && board[two] === '.') out.push({ from, to: two })
      }
      for (const dc of [-1, 1]) {
        if (!inBoard(r + dir, c + dc)) continue
        const to = (r + dir) * 8 + c + dc
        const target = board[to]
        if ((target !== '.' && colorOf(target) !== turn) || to === pos.ep) push(to)
      }
    } else if (kind === 'n' || kind === 'k') {
      for (const [dr, dc] of kind === 'n' ? KNIGHT : KING) {
        if (!inBoard(r + dr, c + dc)) continue
        const to = (r + dr) * 8 + c + dc
        if (colorOf(board[to]) !== turn) out.push({ from, to })
      }
      if (kind === 'k') castleMoves(pos, from, out)
    } else {
      const dirs = kind === 'b' ? BISHOP : kind === 'r' ? ROOK : [...BISHOP, ...ROOK]
      for (const [dr, dc] of dirs) {
        let rr = r + dr
        let cc = c + dc
        while (inBoard(rr, cc)) {
          const to = rr * 8 + cc
          const target = board[to]
          if (target === '.') out.push({ from, to })
          else {
            if (colorOf(target) !== turn) out.push({ from, to })
            break
          }
          rr += dr
          cc += dc
        }
      }
    }
  }
  return out
}

/** キャスリング(王が 2 マス動く手)。王も途中のマスも攻撃されていないこと、間が空いていること、権利があること */
function castleMoves(pos: Position, from: number, out: Move[]): void {
  const white = pos.turn === 'w'
  const home = white ? 60 : 4
  if (from !== home) return
  const { board, castling } = pos
  const enemy = other(pos.turn)
  const rook = white ? 'R' : 'r'
  if (isAttacked(board, home, enemy)) return
  if ((white ? castling.wk : castling.bk) && board[home + 3] === rook && board[home + 1] === '.' && board[home + 2] === '.' && !isAttacked(board, home + 1, enemy) && !isAttacked(board, home + 2, enemy)) {
    out.push({ from, to: home + 2 })
  }
  if ((white ? castling.wq : castling.bq) && board[home - 4] === rook && board[home - 1] === '.' && board[home - 2] === '.' && board[home - 3] === '.' && !isAttacked(board, home - 1, enemy) && !isAttacked(board, home - 2, enemy)) {
    out.push({ from, to: home - 2 })
  }
}

/** 手を指した後の局面(合法かは見ない) */
export function applyMove(pos: Position, m: Move): Position {
  const board = [...pos.board]
  const piece = board[m.from]
  const kind = piece.toLowerCase()
  const white = pos.turn === 'w'
  const captured = board[m.to]
  board[m.from] = '.'
  let ep: number | null = null
  if (kind === 'p') {
    if (m.to === pos.ep && captured === '.' && (m.from & 7) !== (m.to & 7)) board[(m.from >> 3) * 8 + (m.to & 7)] = '.' // アンパッサン: 通り過ぎたポーンを取る
    if (Math.abs((m.to >> 3) - (m.from >> 3)) === 2) ep = (m.from + m.to) / 2
    board[m.to] = m.promo ? (white ? m.promo.toUpperCase() : m.promo) : piece
  } else {
    board[m.to] = piece
    if (kind === 'k' && Math.abs((m.to & 7) - (m.from & 7)) === 2) {
      // キャスリング: ルークも動かす
      if (m.to > m.from) {
        board[m.to - 1] = board[m.to + 1]
        board[m.to + 1] = '.'
      } else {
        board[m.to + 1] = board[m.to - 2]
        board[m.to - 2] = '.'
      }
    }
  }
  const castling = { ...pos.castling }
  if (kind === 'k') {
    if (white) castling.wk = castling.wq = false
    else castling.bk = castling.bq = false
  }
  for (const sq of [m.from, m.to]) {
    if (sq === 63) castling.wk = false
    if (sq === 56) castling.wq = false
    if (sq === 7) castling.bk = false
    if (sq === 0) castling.bq = false
  }
  return {
    board,
    turn: other(pos.turn),
    castling,
    ep,
    halfmove: kind === 'p' || captured !== '.' ? 0 : pos.halfmove + 1,
    fullmove: pos.turn === 'b' ? pos.fullmove + 1 : pos.fullmove
  }
}

/** 合法手(自分の王が取られる手を除く) */
export function legalMoves(pos: Position): Move[] {
  return pseudoMoves(pos).filter((m) => {
    const next = applyMove(pos, m)
    const k = kingSquare(next.board, pos.turn)
    return k >= 0 && !isAttacked(next.board, k, other(pos.turn))
  })
}

export type Status = 'ongoing' | 'checkmate' | 'stalemate' | 'draw-material' | 'draw-fifty'

function insufficientMaterial(board: readonly string[]): boolean {
  const rest = board.filter((p) => p !== '.' && p.toLowerCase() !== 'k')
  if (rest.length === 0) return true
  return rest.length === 1 && 'bn'.includes(rest[0].toLowerCase())
}

export function statusOf(pos: Position): Status {
  if (legalMoves(pos).length === 0) return inCheck(pos) ? 'checkmate' : 'stalemate'
  if (insufficientMaterial(pos.board)) return 'draw-material'
  if (pos.halfmove >= 100) return 'draw-fifty'
  return 'ongoing'
}

/** 指し手の数(合法手生成の検証用)。depth 手先までの局面の数 */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1
  const moves = legalMoves(pos)
  if (depth === 1) return moves.length
  let n = 0
  for (const m of moves) n += perft(applyMove(pos, m), depth - 1)
  return n
}

// ------------------------------------------------------------ 評価と探索
const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20_000 }

// 駒の位置の価値(白から見た表。左上が a8。黒は、上下を反転して使う)
const PST: Record<string, readonly number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
}

/** 駒の価値 + 位置の価値(白から見た点数) */
export function evaluate(pos: Position): number {
  let score = 0
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i]
    if (p === '.') continue
    const k = p.toLowerCase()
    if (colorOf(p) === 'w') score += VALUE[k] + PST[k][i]
    else score -= VALUE[k] + PST[k][i ^ 56]
  }
  return score
}

const MATE = 100_000
/** 探索する局面の数の上限(メインプロセスを、固めないため) */
const NODE_CAP = 60_000

/** 手の良さの見込み(良さそうな手を先に調べる): 取る手は、価値の高い駒を、安い駒で取るほど先。プロモーションも先 */
function orderScore(pos: Position, m: Move): number {
  const target = pos.board[m.to]
  let s = 0
  if (target !== '.') s += 10 * VALUE[target.toLowerCase()] - VALUE[pos.board[m.from].toLowerCase()]
  if (m.promo) s += 800
  return s
}

interface Budget {
  nodes: number
}

function negamax(pos: Position, depth: number, alpha: number, beta: number, ply: number, budget: Budget): number {
  const moves = legalMoves(pos)
  if (moves.length === 0) return inCheck(pos) ? -MATE + ply : 0
  const sign = pos.turn === 'w' ? 1 : -1
  budget.nodes++
  if (depth === 0 || budget.nodes > NODE_CAP) return sign * evaluate(pos)
  moves.sort((a, b) => orderScore(pos, b) - orderScore(pos, a))
  let best = -Infinity
  for (const m of moves) {
    best = Math.max(best, -negamax(applyMove(pos, m), depth - 1, -beta, -alpha, ply + 1, budget))
    alpha = Math.max(alpha, best)
    if (alpha >= beta) break
  }
  return best
}

const DEPTH: Record<Level, number> = { easy: 1, normal: 2, hard: 3 }

/**
 * キャラの手を選ぶ。
 * - easy: 1 手先まで(駒の損得と位置を見る)。評価に、ランダムなゆらぎを足す(ときどき、悪い手も指す)
 * - normal: 2 手先まで / hard: 3 手先まで(探索する局面の数に上限があり、込み入った局面では、浅くなる)
 * 合法手が無ければ null。タイブレークは、同点の手からランダム
 */
export function chooseChessMove(pos: Position, level: Level, rng: () => number = Math.random): Move | null {
  const moves = legalMoves(pos)
  if (moves.length === 0) return null
  moves.sort((a, b) => orderScore(pos, b) - orderScore(pos, a))
  const budget: Budget = { nodes: 0 }
  const noise = level === 'easy' ? 80 : 0
  let bestScore = -Infinity
  let best: Move[] = []
  for (const m of moves) {
    const score = -negamax(applyMove(pos, m), DEPTH[level] - 1, -Infinity, Infinity, 1, budget) + (noise ? (rng() - 0.5) * 2 * noise : 0)
    if (score > bestScore + 1e-9) {
      bestScore = score
      best = [m]
    } else if (Math.abs(score - bestScore) <= 1e-9) best.push(m)
  }
  return pickOne(best, rng)
}

// ------------------------------------------------------------ チャットでの入力
/** 「e2e4」「e2 e4」「e2-e4」(記号・空白は無視)。プロモーションは、末尾に q / r / b / n(例: e7e8q)。「やめる」「もう一回」 */
export function parseChessInput(input: string): GameCommand | null {
  const t = squash(input)
  if (t === '') return null
  const common = parseCommon(t)
  if (common) return common
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?(?:に|へ|を|で)?(?:うごかす|動かす|さす|指す|する|します)?$/.exec(t)
  if (!m) return null
  const from = parseSquare(m[1])
  const to = parseSquare(m[2])
  if (from === null || to === null) return null
  return { kind: 'move', move: { from, to, ...(m[3] ? { promo: m[3] as PromoPiece } : {}) } }
}

// ------------------------------------------------------------ ゲームの定義
export interface ChessState {
  pos: Position
  /** ユーザーが持つ色(先に打つ人が白) */
  userColor: Color
  turn: Player | null
  last: Move | null
}

const GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }

const playerOf = (s: { userColor: Color }, color: Color): Player => (color === s.userColor ? 'user' : 'char')

function advance(userColor: Color, pos: Position, last: Move): ChessState {
  const over = statusOf(pos) !== 'ongoing'
  return { pos, userColor, turn: over ? null : playerOf({ userColor }, pos.turn), last }
}

function outcomeOfState(s: ChessState): Outcome | null {
  const st = statusOf(s.pos)
  if (st === 'ongoing') return null
  if (st === 'checkmate') return playerOf(s, s.pos.turn) === 'user' ? 'lose' : 'win' // 詰まされた側が負け
  return 'draw'
}

const NOTES: Record<Status, string | null> = {
  ongoing: null,
  checkmate: 'チェックメイト!',
  stalemate: 'ステイルメイト(引き分け)',
  'draw-material': '駒が足りないため、引き分け',
  'draw-fifty': '50 手ルールで、引き分け'
}

export const chess: GameDef<ChessState> = {
  id: 'chess',
  modId: 'game-chess',
  title: 'チェス',
  size: { width: 460, height: 700 },
  help: 'チャットでも指せます: 「e2e4」(動かす駒のマスと、行き先)。プロモーションは「e7e8q」。駒を押して、行き先を押しても指せます。「もう一回」「やめる」も使えます。',
  start: (first) => ({ pos: startPosition(), userColor: first === 'user' ? 'w' : 'b', turn: first, last: null }),
  playUser(s, move) {
    if (s.turn !== 'user' || move.from === undefined) return null
    const candidates = legalMoves(s.pos).filter((m) => m.from === move.from && m.to === move.to)
    if (candidates.length === 0) return null
    // プロモーション: 指定が無ければ、クイーン
    const chosen = candidates.find((m) => m.promo === move.promo) ?? (move.promo === undefined ? candidates.find((m) => m.promo === 'q') : undefined) ?? (candidates.every((m) => m.promo === undefined) ? candidates[0] : undefined)
    if (!chosen) return null
    return advance(s.userColor, applyMove(s.pos, chosen), chosen)
  },
  playChar(s, level, rng) {
    if (s.turn !== 'char') return null
    const m = chooseChessMove(s.pos, level, rng)
    if (!m) return null
    return { state: advance(s.userColor, applyMove(s.pos, m), m), move: { from: m.from, to: m.to, ...(m.promo ? { promo: m.promo } : {}) } }
  },
  view(s): BoardView {
    const st = statusOf(s.pos)
    const checked = inCheck(s.pos) ? kingSquare(s.pos.board, s.pos.turn) : -1
    const legal: GameMove[] = s.turn === 'user' ? legalMoves(s.pos).map((m) => ({ from: m.from, to: m.to, ...(m.promo ? { promo: m.promo } : {}) })) : []
    const note = st === 'ongoing' ? (checked >= 0 ? 'チェック!' : null) : NOTES[st]
    return {
      cols: 8,
      rows: 8,
      cells: s.pos.board.map((p) => ({ label: p === '.' ? '' : GLYPH[p.toLowerCase()], side: p === '.' ? null : playerOf(s, colorOf(p) as Color) })),
      style: 'checker',
      input: 'piece',
      coords: true,
      rankLabels: 'desc',
      flipped: s.userColor === 'b',
      turn: s.turn,
      outcome: outcomeOfState(s),
      highlight: checked >= 0 ? [checked] : [],
      last: s.last ? { from: s.last.from, to: s.last.to } : null,
      legal,
      note,
      score: `あなたは${s.userColor === 'w' ? '白(先手)' : '黒(後手)'}`
    }
  },
  parse: parseChessInput
}
