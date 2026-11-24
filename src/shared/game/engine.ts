// ゲーム(機能 Mod)の、共通の型。○×・コネクト 4・リバーシ・チェスを、同じ仕組み(GameController・盤面の窓・ルール)で動かすための土台。
// Electron に依存しない。各ゲームは、GameDef を作って、registry.ts に登録する。

export type Player = 'user' | 'char'
export type Level = 'easy' | 'normal' | 'hard'
export type Outcome = 'win' | 'lose' | 'draw'
export type GameId = 'tictactoe' | 'connect4' | 'reversi' | 'chess'

export const GAME_IDS: readonly GameId[] = ['tictactoe', 'connect4', 'reversi', 'chess']

/**
 * 1 つの手。盤面のマスの番号(左上が 0、右へ、下へ)で表す。
 * - ○×・リバーシ: to = 打つマス / コネクト 4: to = 落とす列(0〜6) / チェス: from → to(プロモーションは promo)
 */
export interface GameMove {
  to: number
  from?: number
  promo?: 'q' | 'r' | 'b' | 'n'
}

/** IPC で受け取った値を、手として読む(形が正しくなければ null)。マスの番号は 0〜63、promo は q / r / b / n だけ */
export function parseGameMove(raw: unknown): GameMove | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const square = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 64
  if (!square(o.to)) return null
  if (o.from !== undefined && !square(o.from)) return null
  if (o.promo !== undefined && o.promo !== 'q' && o.promo !== 'r' && o.promo !== 'b' && o.promo !== 'n') return null
  return { to: o.to, ...(o.from !== undefined ? { from: o.from as number } : {}), ...(o.promo !== undefined ? { promo: o.promo } : {}) }
}

export const sameMove = (a: GameMove, b: GameMove): boolean => a.to === b.to && a.from === b.from && a.promo === b.promo

export type GameCommand = { kind: 'move'; move: GameMove } | { kind: 'stop' } | { kind: 'restart' }

/** 盤面の 1 マスの表示。label が空なら、空きマス。side は、その駒・石の持ち主 */
export interface CellView {
  label: string
  side: Player | null
}

/** 盤面の窓に出す、盤面の表示用の状態(ゲームごとの状態から作る) */
export interface BoardView {
  cols: number
  rows: number
  cells: CellView[]
  /** 盤面の模様: grid = ○×(升目)/ drop = コネクト 4(縦に落とす)/ checker = リバーシ・チェス(市松) */
  style: 'grid' | 'drop' | 'checker'
  /** 手の入力のしかた: cell = マスを選ぶ / column = 列を選ぶ / piece = 駒を選んで、行き先を選ぶ */
  input: 'cell' | 'column' | 'piece'
  /** 盤の縁に、座標(a〜h・1〜8)を出す */
  coords: boolean
  /** 段の数字: desc = 上から 8〜1(チェス) / asc = 上から 1〜8(リバーシ。a1 が左上) */
  rankLabels: 'asc' | 'desc'
  /** 盤を、上下左右とも逆に表示する(チェスで、ユーザーが後手のとき。マスの番号は、そのまま) */
  flipped: boolean
  /** 次に打つ人(終わっていれば null) */
  turn: Player | null
  /** ユーザーから見た結果(終わっていなければ null) */
  outcome: Outcome | null
  /** 強調するマス(勝ちの並び・チェックされたキング) */
  highlight: number[]
  /** 直前の手 */
  last: GameMove | null
  /** ユーザーが打てる手(ユーザーの番でなければ、空) */
  legal: GameMove[]
  /** 盤面の下に出す一言(「パスしました」「チェック!」など) */
  note: string | null
  /** 盤面の下に出す、点数など(リバーシの石の数) */
  score: string | null
}

export interface GameDef<S> {
  id: GameId
  /** このゲームを使えるようにする、公式の機能 Mod の id */
  modId: string
  /** 盤面の窓の見出し */
  title: string
  /** 盤面の窓の大きさ */
  size: { width: number; height: number }
  /** チャットでの手の入力の例(盤面の窓の下に出す) */
  help: string
  /** 新しい 1 局。first = 先に打つ人 */
  start(first: Player): S
  /** ユーザーの手。打てなければ null。次の人がパスなら、ユーザーの番のまま(状態に反映する) */
  playUser(state: S, move: GameMove): S | null
  /** キャラの手を選んで打つ。打てなければ null */
  playChar(state: S, level: Level, rng: () => number): { state: S; move: GameMove } | null
  view(state: S): BoardView
  /** チャットの入力を読む(手・やめる・もう一回)。ゲームに関係なければ null */
  parse(text: string): GameCommand | null
}

/** 全角の数字などを半角にそろえ、空白・記号を除く */
export const squash = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')

/** 「やめる」「もう一回」(どのゲームでも共通)。当てはまらなければ null */
export function parseCommon(squashed: string): GameCommand | null {
  if (/^(やめる|やめよう|やめます|やめて|終わり|おわり|終了|中止|ストップ|stop|もういい)/.test(squashed)) return { kind: 'stop' }
  if (/^(もう一回|もういっかい|もう一度|もういちど|リセット|最初から|はじめから|再戦)/.test(squashed)) return { kind: 'restart' }
  return null
}

/** 配列から、乱数で 1 つ選ぶ(rng は 0 以上 1 未満) */
export function pickOne<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}
