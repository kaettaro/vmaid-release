// ゲームの一覧(公式の機能 Mod ごとに 1 つ)。GameController・チャットの入力の振り分けが、ここを引く。

import { chess } from './chess'
import { connect4 } from './connect4'
import { GAME_IDS, type GameCommand, type GameDef, type GameId } from './engine'
import { reversi } from './reversi'
import { tictactoe } from './tictactoeDef'

// 状態の型はゲームごとに違う。GameController は、状態を中身を見ずに受け渡すだけなので、unknown として扱う
export type AnyGameDef = GameDef<unknown>

export const GAMES: Readonly<Record<GameId, AnyGameDef>> = {
  tictactoe: tictactoe as unknown as AnyGameDef,
  connect4: connect4 as unknown as AnyGameDef,
  reversi: reversi as unknown as AnyGameDef,
  chess: chess as unknown as AnyGameDef
}

export const isGameId = (v: unknown): v is GameId => typeof v === 'string' && (GAME_IDS as readonly string[]).includes(v)

/** ゲームを使えるようにする機能 Mod の id(すべて) */
export const GAME_MOD_IDS: readonly string[] = GAME_IDS.map((id) => GAMES[id].modId)

/** ゲームの id → ゲームの定義 */
export const gameDef = (id: GameId): AnyGameDef => GAMES[id]

/** チャットの入力を、そのゲームの手・やめる・もう一回として読む(ゲームが決まっていなければ null) */
export function parseGameInput(id: GameId | null, text: string): GameCommand | null {
  return id === null ? null : GAMES[id].parse(text)
}
