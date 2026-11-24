import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { GameEvent, GameState } from '../shared/game/types'
import { GAME_MOD_IDS } from '../shared/game/registry'
import { GameController } from './game'
import type { GameWindow } from './gameWindow'
import type { SettingsStore } from './settingsStore'

function setup(opts: { features?: string[]; first?: 'user' | 'char' | 'random'; level?: 'easy' | 'normal' | 'hard' } = {}) {
  const settings = { mods: { features: opts.features ?? ['game'] }, game: { level: opts.level ?? 'normal', first: opts.first ?? 'user' } }
  const store = { get: () => settings, update: (fn: (s: typeof settings) => void) => fn(settings) } as unknown as SettingsStore
  const events: GameEvent[] = []
  const win = { isDestroyed: () => false, webContents: { send: (ch: string, e: GameEvent) => void (ch === IPC.gameEvent && events.push(e)) } } as unknown as BrowserWindow
  const states: GameState[] = []
  const shown = { show: 0, hide: 0, sizes: [] as Array<{ width: number; height: number } | undefined> }
  const gw = { show: (size?: { width: number; height: number }) => (shown.show++, shown.sizes.push(size)), hide: () => shown.hide++, send: (s: GameState) => states.push(s) } as unknown as GameWindow
  const game = new GameController(store, () => win, gw, () => 0)
  return { game, events, states, shown, settings }
}

const cells = (g: GameController): Array<string> => g.state().board!.cells.map((c) => c.label)

describe('GameController(○×)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('Mod が OFF なら、始まらない(窓も出ない)', () => {
    const { game, shown } = setup({ features: [] })
    game.start()
    expect(game.state().active).toBe(false)
    expect(shown.show).toBe(0)
  })

  it('始めると窓が出て、ユーザーの番。ユーザーが打つと、キャラが少し考えてから打つ', () => {
    const { game, events, shown } = setup()
    game.start()
    expect(shown.show).toBe(1)
    expect(game.state()).toMatchObject({ active: true, game: 'tictactoe' })
    expect(game.state().board).toMatchObject({ turn: 'user', outcome: null })
    expect(events).toContainEqual({ type: 'state', active: true, game: 'tictactoe' })
    expect(game.move({ to: 4 })).toBe(true)
    expect(cells(game)[4]).toBe('○')
    expect(game.state()).toMatchObject({ thinking: true })
    expect(game.state().board?.turn).toBe('char')
    expect(game.move({ to: 0 })).toBe(false) // キャラの番・考え中は、打てない
    vi.advanceTimersByTime(800)
    expect(cells(game).filter((c) => c === '×')).toHaveLength(1)
    expect(game.state().board?.turn).toBe('user')
    expect(events.filter((e) => e.type === 'move').map((e) => (e as { who: string }).who)).toEqual(['user', 'char'])
    expect(events.filter((e) => e.type === 'move').every((e) => (e as { game: string }).game === 'tictactoe')).toBe(true)
  })

  it('打てないマス・範囲外は、false。盤面は変わらない', () => {
    const { game } = setup()
    game.start()
    expect(game.move({ to: -1 })).toBe(false)
    expect(game.move({ to: 9 })).toBe(false)
    game.move({ to: 0 })
    vi.advanceTimersByTime(800)
    expect(game.move({ to: 0 })).toBe(false) // もう埋まっている
  })

  it('キャラ先攻なら、始めてすぐ、キャラが打つ', () => {
    const { game } = setup({ first: 'char' })
    game.start()
    expect(game.state().board?.turn).toBe('char')
    vi.advanceTimersByTime(800)
    expect(cells(game).filter((c) => c === '×')).toHaveLength(1)
    expect(game.state().board?.turn).toBe('user')
  })

  it('三目で終わると、結果のイベントが出て、それ以上は打てない(もう一回で、最初から)', () => {
    const { game, events } = setup({ level: 'easy' })
    game.start({ first: 'user' })
    // キャラの乱数は 0 固定: easy は、勝てる手が無ければ、空いている最初のマスに打つ
    // ユーザー 4 → キャラ 0 → ユーザー 2 → キャラ 1 → ユーザー 6 で、2-4-6 の斜め(○の勝ち)
    for (const i of [4, 2, 6]) {
      expect(game.move({ to: i })).toBe(true)
      vi.advanceTimersByTime(800)
      if (game.state().board?.outcome) break
    }
    expect(game.state().board?.outcome).toBe('win')
    expect(game.state().board?.highlight).toEqual([2, 4, 6])
    expect(events).toContainEqual({ type: 'result', result: 'win', game: 'tictactoe' })
    expect(game.move({ to: 8 })).toBe(false)
    game.start()
    expect(game.state().board).toMatchObject({ outcome: null, turn: 'user' })
    expect(cells(game).every((c) => c === '')).toBe(true)
  })

  it('やめると、窓が閉じて、ゲームが終わる。考え中のキャラは、打たない', () => {
    const { game, shown, events } = setup()
    game.start()
    game.move({ to: 4 })
    game.stop()
    vi.advanceTimersByTime(2000)
    expect(game.state()).toMatchObject({ active: false, game: null, board: null })
    expect(shown.hide).toBe(1)
    expect(events).toContainEqual({ type: 'state', active: false, game: null })
  })

  it('設定は、検証して保存する(つよさは、やさしい・ふつう・つよい。壊れた値は、無視)', () => {
    const { game, settings } = setup()
    game.save({ level: 'easy', first: 'random' })
    expect(settings.game).toEqual({ level: 'easy', first: 'random' })
    game.save({ level: 'hard' })
    expect(game.view().level).toBe('hard')
    game.save({ level: '最強' })
    expect(game.view().level).toBe('hard') // 不正な値の更新は、無視する
  })
})

describe('GameController(ゲームの切り替え・ゲームごとの Mod)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('ゲームごとに別の機能 Mod。OFF のゲームは始まらない(ほかのゲームの Mod が ON でも)', () => {
    const { game } = setup({ features: ['game-chess'] })
    game.start({ game: 'tictactoe' })
    expect(game.state().active).toBe(false)
    game.start({ game: 'connect4' })
    expect(game.state().active).toBe(false)
    game.start({ game: 'chess' })
    expect(game.state()).toMatchObject({ active: true, game: 'chess' })
    expect(game.enabled()).toBe(true)
    expect(setup({ features: ['motion-tags'] }).game.enabled()).toBe(false)
    expect(GAME_MOD_IDS).toEqual(['game', 'game-connect4', 'game-reversi', 'game-chess'])
  })

  it('同時に遊べるのは 1 つ。別のゲームを始めると、窓の大きさを変えて、盤面が入れ替わる', () => {
    const { game, shown, events } = setup({ features: ['game', 'game-connect4'] })
    game.start({ game: 'tictactoe' })
    game.start({ game: 'connect4' })
    expect(game.state().game).toBe('connect4')
    expect(game.state().board).toMatchObject({ cols: 7, rows: 6, input: 'column' })
    expect(shown.sizes.map((s) => s?.width)).toEqual([320, 380]) // ○× → コネクト 4
    expect(events.filter((e) => e.type === 'state').map((e) => (e as { game: string | null }).game)).toEqual(['tictactoe', 'connect4'])
  })

  it('コネクト 4: 列を落とせて、列が満杯・範囲外は、false。キャラも落とす', () => {
    const { game } = setup({ features: ['game-connect4'] })
    game.start({ game: 'connect4' })
    expect(game.move({ to: 3 })).toBe(true)
    expect(game.move({ to: 7 })).toBe(false)
    vi.advanceTimersByTime(800)
    expect(game.state().board?.cells.filter((c) => c.side === 'char')).toHaveLength(1)
  })

  it('リバーシ: 打てるマスにだけ打てる。チェス: 駒を動かせて、プロモーションの駒の指定が無い手は、クイーンとして扱う', () => {
    const rv = setup({ features: ['game-reversi'] })
    rv.game.start({ game: 'reversi' })
    expect(rv.game.move({ to: 0 })).toBe(false)
    expect(rv.game.move({ to: 19 })).toBe(true) // d3
    const ch = setup({ features: ['game-chess'] })
    ch.game.start({ game: 'chess' })
    expect(ch.game.move({ from: 52, to: 36 })).toBe(true) // e2e4
    expect(ch.game.move({ from: 12, to: 28 })).toBe(false) // キャラの番
    vi.advanceTimersByTime(800)
    expect(ch.game.state().board?.turn).toBe('user')
  })

  it('Mod を OFF にしたとき、そのゲームを遊んでいたら、やめる。別のゲームの Mod なら、続ける', () => {
    const { game, shown } = setup({ features: ['game', 'game-chess'] })
    game.start({ game: 'chess' })
    game.stopFor('game')
    expect(game.state().active).toBe(true)
    game.stopFor('game-chess')
    expect(game.state().active).toBe(false)
    expect(shown.hide).toBe(1)
  })
})
