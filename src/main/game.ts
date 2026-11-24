import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { sameMove, type GameId, type GameMove, type Level, type Player } from '../shared/game/engine'
import { GAME_MOD_IDS, GAMES, type AnyGameDef } from '../shared/game/registry'
import { GamePatchSchema, GameSettingsSchema, type GameEvent, type GameStartOptions, type GameState, type GameView } from '../shared/game/types'
import type { SettingsStore } from './settingsStore'
import type { GameWindow } from './gameWindow'

/** キャラが手を考える時間(ミリ秒)。すぐ打つと、機械的に見える */
const THINK_MS = 700

/**
 * 機能 Mod「ゲーム」(○×・コネクト 4・リバーシ・チェス)の main 側。いま遊んでいるゲームの状態を持ち、
 * ユーザーの手(盤面のクリック・チャット)とキャラの手を進め、盤面の窓と、キャラ窓(ルールのトリガー)へ知らせる。通信はしない。
 * 同時に遊べるのは 1 つだけ(別のゲームを始めたら、いまのゲームは終わる)。ゲームごとに、使うための機能 Mod が別。
 */
export class GameController {
  private def: AnyGameDef | null = null
  private game: unknown = null
  private active = false
  private level: Level = 'normal'
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly store: SettingsStore,
    private readonly characterWin: () => BrowserWindow | undefined,
    private readonly window: GameWindow,
    private readonly rng: () => number = Math.random
  ) {}

  /** そのゲームの Mod が ON か(省略すると、どれかのゲームの Mod が ON か) */
  enabled(id?: GameId): boolean {
    const features = this.store.get().mods.features
    return id ? features.includes(GAMES[id].modId) : GAME_MOD_IDS.some((m) => features.includes(m))
  }

  view(): GameView {
    return { ...this.store.get().game, enabled: this.enabled() }
  }

  save(raw: unknown): GameView {
    const parsed = GamePatchSchema.safeParse(raw)
    if (parsed.success) {
      const patch = parsed.data
      this.store.update((s) => {
        s.game = GameSettingsSchema.parse({ ...s.game, ...patch })
      })
    }
    return this.view()
  }

  state(): GameState {
    const def = this.def
    return {
      active: this.active,
      game: this.active && def ? def.id : null,
      title: def?.title ?? '',
      help: def?.help ?? '',
      board: this.active && def ? def.view(this.game) : null,
      level: this.level,
      thinking: this.timer !== null
    }
  }

  /** いま遊んでいるゲームの id(遊んでいなければ null) */
  currentGame(): GameId | null {
    return this.active && this.def ? this.def.id : null
  }

  /** 新しい 1 局を始める(盤面の窓を出す)。そのゲームの Mod が OFF なら、何もしない。ゲームを指定しなければ、○× */
  start(opts: GameStartOptions = {}): void {
    const id = opts.game ?? 'tictactoe'
    if (!this.enabled(id)) return
    this.clearTimer()
    const def = GAMES[id]
    const settings = this.store.get().game
    this.level = opts.level ?? settings.level
    const first = opts.first ?? settings.first
    const who: Player = first === 'random' ? (this.rng() < 0.5 ? 'user' : 'char') : first
    this.def = def
    this.game = def.start(who)
    this.active = true
    this.window.show(def.size)
    this.send({ type: 'state', active: true, game: id })
    this.push()
    if (def.view(this.game).turn === 'char') this.scheduleCharMove()
  }

  /** ユーザーの手(盤面のクリック・チャット)。打てなければ、false */
  move(move: GameMove): boolean {
    const def = this.def
    if (!def || !this.active || this.timer !== null) return false
    const v = def.view(this.game)
    // 合法手に含まれるか。プロモーションの駒の指定が無ければ、クイーン(チャットの「e7e8」など)
    const ok = v.legal.some((m) => sameMove(m, move) || (move.promo === undefined && m.from === move.from && m.to === move.to && m.promo === 'q'))
    if (v.turn !== 'user' || !ok) return false
    const next = def.playUser(this.game, move)
    if (next === null) return false
    this.game = next
    this.send({ type: 'move', who: 'user', game: def.id })
    this.afterMove()
    return true
  }

  /** ゲームをやめる(盤面の窓を閉じる)。Mod の OFF・解除でも呼ぶ */
  stop(): void {
    this.clearTimer()
    const was = this.active
    this.active = false
    this.def = null
    this.game = null
    this.window.hide()
    if (was) this.send({ type: 'state', active: false, game: null })
    this.push()
  }

  /** その Mod のゲームを遊んでいるなら、やめる(Mod を OFF にしたとき) */
  stopFor(modId: string): void {
    if (this.active && this.def?.modId === modId) this.stop()
  }

  private afterMove(): void {
    const def = this.def
    if (!def) return
    const v = def.view(this.game)
    this.push()
    if (v.outcome) {
      this.send({ type: 'result', result: v.outcome, game: def.id })
      return
    }
    if (v.turn === 'char') this.scheduleCharMove()
  }

  private scheduleCharMove(): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      const def = this.def
      if (!def || !this.active || def.view(this.game).turn !== 'char') return
      const r = def.playChar(this.game, this.level, this.rng)
      if (!r) return
      this.game = r.state
      this.send({ type: 'move', who: 'char', game: def.id })
      this.afterMove()
    }, THINK_MS)
    this.push() // thinking を知らせる
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private push(): void {
    this.window.send(this.state())
  }

  private send(event: GameEvent): void {
    const win = this.characterWin()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.gameEvent, event)
  }
}
