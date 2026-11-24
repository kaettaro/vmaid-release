// ゲーム Mod の、画面と main の間で受け渡す型と設定。Electron に依存しない。
// ゲームは 4 つ(○×・コネクト 4・リバーシ・チェス)。それぞれ別の公式の機能 Mod で、盤面の窓・ルール・設定は共通(engine.ts)。

import { z } from 'zod'
import type { BoardView, GameId, Level, Outcome, Player } from './engine'

/** ○×ゲームの機能 Mod の id(最初に作ったゲーム。ほかのゲームの id は、registry.ts の GAMES) */
export const GAME_ID = 'game'

const LEVELS = ['easy', 'normal', 'hard'] as const

/** ゲームの設定(全ゲーム共通)。つよさは、ゲームごとに、使える段が違う(○×は、つよい = ふつう) */
export const GameSettingsSchema = z.object({
  /** キャラの強さ。やさしい = 勝てる手は見逃さないが、ほかはほぼランダム / ふつう・つよい = 先を読む */
  level: z.enum(LEVELS).catch('normal'),
  /** 先攻。random は、毎回ランダム */
  first: z.enum(['user', 'char', 'random']).catch('user')
})
export type GameSettings = z.infer<typeof GameSettingsSchema>
/** 設定の更新(変えた項目だけ)。不正な値は、検証で弾く(既定に戻さない) */
export const GamePatchSchema = z.object({ level: z.enum(LEVELS).optional(), first: z.enum(['user', 'char', 'random']).optional() })
export type GamePatch = z.infer<typeof GamePatchSchema>

export interface GameView extends GameSettings {
  /** どれかのゲームの Mod が ON か */
  enabled: boolean
}

/** 盤面の状態(main が持つ。盤面の窓へ、変わるたびに送る) */
export interface GameState {
  active: boolean
  /** いま遊んでいるゲーム(遊んでいなければ null) */
  game: GameId | null
  /** 窓の見出し・手の入力の例 */
  title: string
  help: string
  /** 盤面の表示(遊んでいなければ null) */
  board: BoardView | null
  level: Level
  /** キャラが考えている間(盤面を触れない) */
  thinking: boolean
}

/** キャラ窓へ送るイベント。ルールのトリガー(gameMove / gameResult)と、ゲーム中かどうか・どのゲームか(チャット入力の振り分け) */
export type GameEvent =
  | { type: 'move'; who: Player; game: GameId }
  | { type: 'result'; result: Outcome; game: GameId }
  | { type: 'state'; active: boolean; game: GameId | null }

export interface GameStartOptions {
  game?: GameId
  first?: 'user' | 'char' | 'random'
  level?: Level
}
