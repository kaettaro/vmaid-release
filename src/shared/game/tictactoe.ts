// ゲーム Mod(試作)の ○×(三目並べ)。Electron に依存しない純粋ロジック。
// 盤面は 9 マス(番号 1〜9 = 左上から右へ、上から下へ)。ユーザーが ○、キャラが × を打つ。

export type Mark = 'o' | 'x'
export type Cell = Mark | null
export type Board = readonly Cell[]
export type Player = 'user' | 'char'
export type Level = 'easy' | 'normal'
export type Outcome = 'win' | 'lose' | 'draw'

export const MARK_OF: Record<Player, Mark> = { user: 'o', char: 'x' }

/** 三目の並び(マスの番号 0〜8) */
export const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
]

export const emptyBoard = (): Board => Array<Cell>(9).fill(null)

/** 打てるマスか(0〜8 の整数で、空いている) */
export function canPlace(board: Board, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < 9 && board[index] === null
}

/** 打った後の盤面(打てなければ、元の盤面) */
export function place(board: Board, index: number, mark: Mark): Board {
  if (!canPlace(board, index)) return board
  const next = [...board]
  next[index] = mark
  return next
}

export interface Judgement {
  /** 勝った印(まだ・引き分けなら null) */
  winner: Mark | null
  /** 揃った並び(勝ったときだけ) */
  line: readonly [number, number, number] | null
  /** 引き分け(全部埋まって、勝者なし) */
  draw: boolean
}

export function judge(board: Board): Judgement {
  for (const line of LINES) {
    const [a, b, c] = line
    const m = board[a]
    if (m !== null && m === board[b] && m === board[c]) return { winner: m, line, draw: false }
  }
  return { winner: null, line: null, draw: board.every((c) => c !== null) }
}

/** 終わったか、終わっていればユーザーから見た結果 */
export function outcomeOf(board: Board): Outcome | null {
  const j = judge(board)
  if (j.winner) return j.winner === MARK_OF.user ? 'win' : 'lose'
  return j.draw ? 'draw' : null
}

const emptyCells = (board: Board): number[] => board.flatMap((c, i) => (c === null ? [i] : []))

/** mark が打てば三目になるマス(無ければ null。複数あれば、最初のもの) */
function winningMove(board: Board, mark: Mark): number | null {
  for (const i of emptyCells(board)) if (judge(place(board, i, mark)).winner === mark) return i
  return null
}

/**
 * キャラの手を選ぶ。
 * - easy: 勝てる手があれば打つ。それ以外はランダム
 * - normal: 勝てる手 → 相手の勝ちを防ぐ手 → 中央 → 角 → 辺(負けにくい。完璧ではない:順番が単純なので、2 手先の罠にはかかることがある)
 * rng は 0 以上 1 未満の乱数(テストで差し替える)。打てるマスが無ければ null
 */
export function chooseMove(board: Board, mark: Mark, level: Level, rng: () => number = Math.random): number | null {
  const empty = emptyCells(board)
  if (empty.length === 0) return null
  const pick = (cells: number[]): number => cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))]
  const win = winningMove(board, mark)
  if (win !== null) return win
  if (level === 'easy') return pick(empty)
  const other: Mark = mark === 'x' ? 'o' : 'x'
  const block = winningMove(board, other)
  if (block !== null) return block
  if (board[4] === null) return 4
  const corners = [0, 2, 6, 8].filter((i) => board[i] === null)
  if (corners.length > 0) return pick(corners)
  return pick(empty)
}

// --- チャットでの入力 ---

/** 位置の言葉 → マスの番号(0〜8)。長い言葉を先に調べる */
const POSITION_WORDS: ReadonlyArray<readonly [string, number]> = [
  ['左上', 0],
  ['右上', 2],
  ['左下', 6],
  ['右下', 8],
  ['真ん中', 4],
  ['まんなか', 4],
  ['中央', 4],
  ['真中', 4],
  ['ちゅうおう', 4],
  ['上', 1],
  ['下', 7],
  ['左', 3],
  ['右', 5],
  ['中', 4]
]

/** 全角の数字などを半角にそろえ、空白・記号を除く */
const squash = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')

/** マスを選ぶ言葉のあとに付く言い回し(「に置く」「にする」「かな」など) */
const TAIL = '(?:番|ばん)?(?:に|へ|を|で)?(?:おく|置く|おきたい|置きたい|する|します|しよう|かな|です)?'

export type GameCommand = { kind: 'move'; index: number } | { kind: 'stop' } | { kind: 'restart' }

/**
 * ゲーム中のチャット入力を読む。
 * - 「5」「5番」「5に置く」: マスの番号(1〜9)
 * - 「2の3」「2行3列」: 行 と 列(それぞれ 1〜3)
 * - 「左上」「真ん中」「右下」など: 位置の言葉
 * - 「やめる」「終わり」「中止」「ストップ」: ゲームをやめる。「もう一回」「もう一度」「リセット」: 最初から
 * どれにも当たらなければ null(ふつうの会話として扱う)。範囲外の数字(「9の9」「0」)も null。
 */
export function parseGameCommand(input: string): GameCommand | null {
  const t = squash(input)
  if (t === '') return null
  if (/^(やめる|やめよう|やめます|やめて|終わり|おわり|終了|中止|ストップ|stop|もういい)/.test(t)) return { kind: 'stop' }
  if (/^(もう一回|もういっかい|もう一度|もういちど|リセット|最初から|はじめから|再戦)/.test(t)) return { kind: 'restart' }
  // 行と列: 「2の3」「2行3列」「2-3」→ 記号は除かれるので、「の」「行」「列」で見る
  const rc = new RegExp(`^(\\d)(?:の|行|ー|かける)(\\d)(?:列)?${TAIL}$`).exec(t)
  if (rc) {
    const r = Number(rc[1])
    const c = Number(rc[2])
    return r >= 1 && r <= 3 && c >= 1 && c <= 3 ? { kind: 'move', index: (r - 1) * 3 + (c - 1) } : null
  }
  const n = new RegExp(`^(\\d)${TAIL}$`).exec(t)
  if (n) {
    const v = Number(n[1])
    return v >= 1 && v <= 9 ? { kind: 'move', index: v - 1 } : null
  }
  for (const [word, index] of POSITION_WORDS) {
    if (t.startsWith(word) && new RegExp(`^${TAIL}$`).test(t.slice(word.length))) return { kind: 'move', index }
  }
  return null
}
