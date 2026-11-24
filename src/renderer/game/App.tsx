import { useEffect, useMemo, useState } from 'react'
import { sameMove, type BoardView, type GameMove } from '@shared/game/engine'
import type { GameState } from '@shared/game/types'

const FILES = 'abcdefgh'
const PROMO_LABEL: Record<NonNullable<GameMove['promo']>, string> = { q: '♛ クイーン', r: '♜ ルーク', b: '♝ ビショップ', n: '♞ ナイト' }

/** 状態の説明(盤面の上に出す) */
function statusText(s: GameState, board: BoardView | null): string {
  if (!s.active || !board) return 'ゲームは終わりました'
  if (board.outcome === 'win') return 'あなたの勝ち!'
  if (board.outcome === 'lose') return 'キャラの勝ち!'
  if (board.outcome === 'draw') return '引き分け'
  return board.turn === 'user' ? 'あなたの番です' : 'キャラが考え中…'
}

/**
 * ゲームの盤面の窓(○×・コネクト 4・リバーシ・チェス共通)。盤面の状態は main が持つので、ここは表示と、クリックを main へ送るだけ。
 * 入力は、盤面の種類による: マスを押す(○×・リバーシ)/ 列を押す(コネクト 4)/ 駒を押して、行き先を押す(チェス)。手は、チャットでも打てる。
 */
export function App(): React.JSX.Element {
  const [state, setState] = useState<GameState | null>(null)
  /** チェス: 選んだ駒のマス */
  const [selected, setSelected] = useState<number | null>(null)
  /** チェス: プロモーションの駒を選んでいる最中の手 */
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null)

  useEffect(() => {
    void window.vmaid.getGameState().then(setState)
    return window.vmaid.onGameState((s) => {
      setState(s)
      setSelected(null) // 盤面が変わったら、選択は解く
      setPromo(null)
    })
  }, [])

  const board = state?.board ?? null
  const canPlay = !!state && state.active && !!board && board.turn === 'user' && !state.thinking && board.outcome === null
  const targets = useMemo(() => (board && selected !== null ? board.legal.filter((m) => m.from === selected) : []), [board, selected])

  if (!state) return <div className="game muted">読み込み中…</div>
  const finished = board?.outcome != null
  const move = (m: GameMove): void => window.vmaid.gameMove(m)

  const click = (i: number): void => {
    if (!board || !canPlay) return
    if (board.input === 'column') {
      const to = i % board.cols
      if (board.legal.some((m) => m.to === to)) move({ to })
    } else if (board.input === 'cell') {
      if (board.legal.some((m) => m.to === i)) move({ to: i })
    } else {
      const own = board.legal.some((m) => m.from === i)
      const toHere = targets.filter((m) => m.to === i)
      if (selected !== null && toHere.length > 0) {
        if (toHere.some((m) => m.promo)) setPromo({ from: selected, to: i })
        else move(toHere[0])
      } else if (own) setSelected(selected === i ? null : i)
      else setSelected(null)
    }
  }

  const order = board ? Array.from({ length: board.cols * board.rows }, (_, k) => (board.flipped ? board.cols * board.rows - 1 - k : k)) : []
  const rankLabel = (row: number): string => {
    const rows = board?.rows ?? 8
    const base = board?.rankLabels === 'asc' ? row + 1 : rows - row
    return String(board?.flipped ? rows + 1 - base : base)
  }
  const fileLabel = (col: number): string => FILES[board?.flipped ? (board?.cols ?? 8) - 1 - col : col]

  return (
    <div className="game">
      <header>
        <strong>{state.title || 'ゲーム'}</strong>
        <button className="close" aria-label="ゲームをやめる" onClick={() => window.vmaid.stopGame()}>
          ✕
        </button>
      </header>
      <div className={`status${finished ? ` ${board?.outcome}` : ''}`} role="status">
        {statusText(state, board)}
      </div>
      {board && (
        <>
          {board.input === 'column' && (
            <div className="drop-row" style={{ gridTemplateColumns: `repeat(${board.cols}, 1fr)` }}>
              {Array.from({ length: board.cols }, (_, c) => (
                <button key={c} className="drop" disabled={!canPlay || !board.legal.some((m) => m.to === c)} aria-label={`${c + 1}列に落とす`} onClick={() => move({ to: c })}>
                  ▼
                </button>
              ))}
            </div>
          )}
          <div className={`board-wrap${board.coords ? ' coords' : ''}`}>
            <div className={`board ${board.style}`} role="grid" aria-label="盤面" style={{ ['--cols' as string]: board.cols, ['--rows' as string]: board.rows, aspectRatio: `${board.cols} / ${board.rows}` }}>
              {order.map((i, k) => {
                const cell = board.cells[i]
                const row = Math.floor(k / board.cols)
                const col = k % board.cols
                const isTarget = canPlay && (board.input === 'piece' ? targets.some((m) => m.to === i) : board.style === 'checker' && board.legal.some((m) => m.to === i))
                const selectable = canPlay && board.input === 'piece' && board.legal.some((m) => m.from === i)
                const last = board.last && (board.last.to === i || board.last.from === i)
                const cls = ['cell', cell.side ?? '', board.style === 'checker' ? ((row + col) % 2 === 0 ? 'light' : 'dark') : '', board.highlight.includes(i) ? 'win' : '', last ? 'last' : '', selected === i ? 'sel' : '', isTarget ? 'tgt' : '', selectable ? 'pick' : '']
                  .filter(Boolean)
                  .join(' ')
                const clickable = canPlay && (board.input === 'column' ? board.legal.some((m) => m.to === i % board.cols) : board.input === 'cell' ? board.legal.some((m) => m.to === i) : selectable || isTarget)
                return (
                  <button key={i} role="gridcell" className={cls} disabled={!clickable} aria-label={cell.label ? `${i + 1}番 ${cell.label}` : `${i + 1}番`} onClick={() => click(i)}>
                    {cell.label ? cell.label : board.style === 'grid' ? <span className="num">{i + 1}</span> : null}
                  </button>
                )
              })}
            </div>
            {board.coords && (
              <>
                <div className="ranks" aria-hidden>
                  {Array.from({ length: board.rows }, (_, r) => (
                    <span key={r}>{rankLabel(r)}</span>
                  ))}
                </div>
                <div className="files" aria-hidden style={{ gridTemplateColumns: `repeat(${board.cols}, 1fr)` }}>
                  {Array.from({ length: board.cols }, (_, c) => (
                    <span key={c}>{fileLabel(c)}</span>
                  ))}
                </div>
              </>
            )}
          </div>
          {promo && (
            <div className="promo" role="group" aria-label="成る駒を選ぶ">
              {(['q', 'r', 'b', 'n'] as const).map((p) => {
                const m: GameMove = { from: promo.from, to: promo.to, promo: p }
                return (
                  <button key={p} disabled={!board.legal.some((x) => sameMove(x, m))} onClick={() => move(m)}>
                    {PROMO_LABEL[p]}
                  </button>
                )
              })}
              <button onClick={() => setPromo(null)}>やめる</button>
            </div>
          )}
          {board.note && <div className="note">{board.note}</div>}
          {board.score && <div className="score">{board.score}</div>}
        </>
      )}
      <p className="hint">{state.help} キャラの強さは、設定の「Mod」で、そのゲームの Mod の行を開いて変えられます。</p>
      <div className="actions">
        <button className="primary" onClick={() => window.vmaid.startGame(state.game ? { game: state.game } : undefined)}>
          {finished ? 'もう一回' : '最初から'}
        </button>
        <button onClick={() => window.vmaid.stopGame()}>やめる</button>
      </div>
    </div>
  )
}
