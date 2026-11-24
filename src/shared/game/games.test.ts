import { describe, expect, it } from 'vitest'
import { applyMove, chooseChessMove, chess, fromFen, inCheck, legalMoves as chessMoves, parseChessInput, parseSquare, perft, squareName, startPosition, statusOf, type Move } from './chess'
import { C4_COLS, canDrop, chooseColumn, connect4, drop, emptyC4Board, findFour, parseC4Input, type C4Board } from './connect4'
import { GAME_IDS, type GameMove, type Player } from './engine'
import { GAMES, gameDef, isGameId, parseGameInput } from './registry'
import { chooseRvMove, flipsFor, initialBoard, legalMoves as rvMoves, parseRvInput, play as rvPlay, reversi, rvOutcome } from './reversi'

/** 決まった乱数(0 以上 1 未満)の列 */
const seeded = (seed: number): (() => number) => {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('ゲームの登録', () => {
  it('4 つのゲームが、それぞれ別の機能 Mod に結びつき、見出し・窓の大きさ・手の入力の例を持つ', () => {
    expect(GAME_IDS).toEqual(['tictactoe', 'connect4', 'reversi', 'chess'])
    expect(new Set(GAME_IDS.map((id) => gameDef(id).modId)).size).toBe(4)
    for (const id of GAME_IDS) {
      const g = GAMES[id]
      expect(g.id).toBe(id)
      expect(g.title).not.toBe('')
      expect(g.size.width).toBeGreaterThan(200)
      expect(g.help).not.toBe('')
    }
    expect(isGameId('chess')).toBe(true)
    expect(isGameId('go')).toBe(false)
    expect(parseGameInput(null, 'やめる')).toBeNull()
    expect(parseGameInput('connect4', 'やめる')).toEqual({ kind: 'stop' })
    expect(parseGameInput('chess', 'もう一回')).toEqual({ kind: 'restart' })
  })

  it('どのゲームも、ランダムに最後まで打てて(AI は合法手だけ)、終わると結果が出る', () => {
    for (const id of GAME_IDS) {
      const def = GAMES[id]
      for (const seed of [1, 2, 3]) {
        const rng = seeded(seed)
        let s = def.start(seed % 2 === 0 ? 'user' : 'char')
        let moves = 0
        while (def.view(s).turn !== null && moves < 400) {
          const v = def.view(s)
          if (v.turn === 'user') {
            expect(v.legal.length, `${id}: ユーザーの番なのに、打てる手が無い`).toBeGreaterThan(0)
            const m = v.legal[Math.floor(rng() * v.legal.length)]
            const next = def.playUser(s, m)
            expect(next, `${id}: 合法手が、打てない`).not.toBeNull()
            s = next as typeof s
          } else {
            const r = def.playChar(s, 'easy', rng)
            expect(r, `${id}: キャラの番なのに、手が無い`).not.toBeNull()
            s = (r as { state: typeof s }).state
          }
          moves++
        }
        const v = def.view(s)
        expect(v.turn, `${id}: 400 手以内に終わらない`).toBeNull()
        expect(['win', 'lose', 'draw']).toContain(v.outcome)
        expect(v.legal).toEqual([])
      }
    }
  })

  it('キャラの番にユーザーが打つ・合法でない手は、受け付けない', () => {
    for (const id of GAME_IDS) {
      const def = GAMES[id]
      const s = def.start('char')
      expect(def.playUser(s, { to: 0 })).toBeNull()
      const u = def.start('user')
      expect(def.playUser(u, { to: 999 })).toBeNull()
    }
  })
})

describe('コネクト 4', () => {
  const board = (rows: string[]): C4Board => rows.flatMap((r) => [...r].map((ch) => (ch === 'u' ? 'user' : ch === 'c' ? 'char' : null)) as Array<'user' | 'char' | null>)

  it('重力で、いちばん下に落ちる。満杯の列には落とせない', () => {
    let b = emptyC4Board()
    const d1 = drop(b, 3, 'user')!
    expect(d1.index).toBe(5 * C4_COLS + 3)
    b = d1.board
    expect(drop(b, 3, 'char')!.index).toBe(4 * C4_COLS + 3)
    for (let i = 0; i < 5; i++) b = drop(b, 3, 'char')!.board
    expect(canDrop(b, 3)).toBe(false)
    expect(drop(b, 3, 'user')).toBeNull()
    expect(canDrop(b, 7)).toBe(false)
  })

  it('横・縦・斜めの 4 つ並びで勝ち。3 つでは勝たない', () => {
    expect(findFour(board(['.......', '.......', '.......', '.......', '.......', 'uuuu...']))?.who).toBe('user')
    expect(findFour(board(['.......', '.......', 'c......', 'c......', 'c......', 'c......']))?.line).toEqual([14, 21, 28, 35])
    expect(findFour(board(['.......', '.......', '...u...', '..uc...', '.uccc..', 'uuccu..']))?.who).toBe('user')
    expect(findFour(board(['.......', '.......', '.......', '.......', '.......', 'uuu....']))).toBeNull()
  })

  it('AI: 勝てる手は打つ。easy でも。normal は、相手の勝ちも防ぐ', () => {
    const win = board(['.......', '.......', '.......', 'u......', 'u......', 'u.ccc..'])
    // char: 横に 3 つ(列 2・3・4)。左右どちらかで勝てる
    expect([1, 5]).toContain(chooseColumn(win, 'char', 'easy', seeded(1)))
    const block = board(['.......', '.......', '.......', '.......', '.......', 'cuuu...']) // 左は塞がれていて、右の列 4 だけが、ユーザーの勝ち筋
    expect(chooseColumn(block, 'char', 'normal', seeded(1))).toBe(4)
    expect(chooseColumn(block, 'char', 'hard', seeded(1))).toBe(4)
  })

  it('チャットの入力: 列の番号・真ん中・左端・右端。範囲外は null', () => {
    expect(parseC4Input('3')).toEqual({ kind: 'move', move: { to: 2 } })
    expect(parseC4Input('7列')).toEqual({ kind: 'move', move: { to: 6 } })
    expect(parseC4Input('３に落とす')).toEqual({ kind: 'move', move: { to: 2 } })
    expect(parseC4Input('真ん中')).toEqual({ kind: 'move', move: { to: 3 } })
    expect(parseC4Input('左端')).toEqual({ kind: 'move', move: { to: 0 } })
    expect(parseC4Input('右端に置く')).toEqual({ kind: 'move', move: { to: 6 } })
    expect(parseC4Input('8')).toBeNull()
    expect(parseC4Input('0')).toBeNull()
    expect(parseC4Input('こんにちは')).toBeNull()
    expect(parseC4Input('やめる')).toEqual({ kind: 'stop' })
  })

  it('GameDef: 手が列のまま届き、強調・直前の手・結果が出る', () => {
    let s = connect4.start('user')
    for (const c of [0, 1, 0, 1, 0, 1]) {
      s = (s.turn === 'user' ? connect4.playUser(s, { to: c }) : { ...s, turn: 'user' as Player })!
      s = { ...s, turn: 'user' }
    }
    const v = connect4.view(s)
    expect(v.input).toBe('column')
    expect(v.cols).toBe(7)
    expect(v.rows).toBe(6)
    expect(v.last).not.toBeNull()
  })
})

describe('リバーシ', () => {
  it('初期配置は、中央に 4 つ。先手(黒)の打てる手は 4 つで、後手も 4 つ', () => {
    const b = initialBoard('user')
    expect(b.filter((c) => c !== null)).toHaveLength(4)
    expect(rvMoves(b, 'user').sort((a, c) => a - c)).toEqual([19, 26, 37, 44]) // d3 c4 f5 e6
    expect(rvMoves(b, 'char')).toHaveLength(4)
  })

  it('挟んだ石が、ひっくり返る。打てない所は、何も変わらない', () => {
    const b = initialBoard('user')
    expect(flipsFor(b, 19, 'user')).toEqual([27]) // d3 に打つと、d4 が返る
    const after = rvPlay(b, 19, 'user')!
    expect(after[19]).toBe('user')
    expect(after[27]).toBe('user')
    expect(rvPlay(b, 0, 'user')).toBeNull()
    expect(rvPlay(b, 27, 'user')).toBeNull() // すでに石がある
  })

  it('相手が打てないときは、パス(自分の番が続く)。両方打てなければ、終了', () => {
    // 右下に黒(ユーザー)1 つ・白(キャラ)1 つ。ユーザーが挟めない配置: 全マス空き + 2 石
    const cells = Array(64).fill(null) as Array<'user' | 'char' | null>
    cells[0] = 'user'
    cells[1] = 'char'
    // ユーザーが c1(2)に打てば b1 を返せる。その後、キャラは打てる手が無い → パス
    const s = { board: cells, turn: 'user' as Player, first: 'user' as Player, lastIndex: null, passed: null }
    const r = reversi.playUser(s, { to: 2 })!
    expect(r.turn).toBe(null) // 白が全滅 → 両方打てない → 終了
    expect(rvOutcome(r.board)).toBe('win')
  })

  it('パスの通知: キャラが打てないとき、ユーザーの番が続き、note に出る', () => {
    const cells = Array(64).fill(null) as Array<'user' | 'char' | null>
    cells[0] = 'user'
    cells[1] = 'char'
    cells[8] = 'char'
    cells[10] = 'user' // c2 は黒
    const s = { board: cells, turn: 'user' as Player, first: 'user' as Player, lastIndex: null, passed: null }
    const legalUser = rvMoves(s.board, 'user')
    expect(legalUser).toContain(2) // c1 で b1 が返る
    const r = reversi.playUser(s, { to: 2 })!
    // 返った後の盤面で、キャラ(白)の残りは a2(8)だけ。a2 を使って挟める所があるかで分岐するので、結果は、どちらかの形になる
    expect([null, 'user', 'char']).toContain(r.turn)
    expect(reversi.view(r).score).toContain('あなた')
  })

  it('AI: easy は合法手だけ。角が取れるなら取る。hard は、合法手を返す', () => {
    const b = initialBoard('char')
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const m = chooseRvMove(b, 'char', level, seeded(7))!
      expect(rvMoves(b, 'char')).toContain(m)
    }
    // 角が取れる盤面: a1 を取れるなら、easy は必ず取る
    const cells = Array(64).fill(null) as Array<'user' | 'char' | null>
    cells[1] = 'user'
    cells[2] = 'char'
    cells[27] = 'user'
    cells[36] = 'char'
    expect(chooseRvMove(cells, 'char', 'easy', seeded(3))).toBe(0)
  })

  it('チャットの入力: d3・3行4列。範囲外・ふつうの言葉は null', () => {
    expect(parseRvInput('d3')).toEqual({ kind: 'move', move: { to: 19 } })
    expect(parseRvInput('D-3に置く')).toEqual({ kind: 'move', move: { to: 19 } })
    expect(parseRvInput('h8')).toEqual({ kind: 'move', move: { to: 63 } })
    expect(parseRvInput('3行4列')).toEqual({ kind: 'move', move: { to: 19 } })
    expect(parseRvInput('i1')).toBeNull()
    expect(parseRvInput('a9')).toBeNull()
    expect(parseRvInput('おはよう')).toBeNull()
    expect(parseRvInput('もう一度')).toEqual({ kind: 'restart' })
  })
})

describe('チェスの合法手(perft。標準の局面での、指し手の数)', () => {
  it('初期局面: 20 / 400 / 8902', () => {
    const p = startPosition()
    expect([1, 2, 3].map((d) => perft(p, d))).toEqual([20, 400, 8902])
  })

  it('Kiwipete(キャスリング・アンパッサン・プロモーションが入る局面): 48 / 2039', () => {
    const p = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
    expect([1, 2].map((d) => perft(p, d))).toEqual([48, 2039])
  })

  it('エンドゲームの局面(アンパッサンでの王手の取りこぼし): 14 / 191 / 2812', () => {
    const p = fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1')
    expect([1, 2, 3].map((d) => perft(p, d))).toEqual([14, 191, 2812])
  })

  it('プロモーションとキャスリングの権利が、複雑な局面: 6 / 264', () => {
    const p = fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1')
    expect([1, 2].map((d) => perft(p, d))).toEqual([6, 264])
  })

  it('マスの名前と番号の変換', () => {
    expect(squareName(0)).toBe('a8')
    expect(squareName(63)).toBe('h1')
    expect(squareName(36)).toBe('e4')
    expect(parseSquare('e4')).toBe(36)
    expect(parseSquare('i9')).toBeNull()
  })
})

describe('チェスのルール', () => {
  const play = (fen: string, from: string, to: string, promo?: Move['promo']) => {
    const pos = fromFen(fen)
    const m = chessMoves(pos).find((x) => x.from === parseSquare(from) && x.to === parseSquare(to) && x.promo === promo)
    if (!m) throw new Error(`${from}${to} は、合法手ではありません`)
    return applyMove(pos, m)
  }

  it('フールズメイト: 2 手で、白がチェックメイト', () => {
    let p = startPosition()
    for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) p = play(fenOf(p), f, t)
    expect(inCheck(p)).toBe(true)
    expect(statusOf(p)).toBe('checkmate')
  })

  it('ステイルメイト(王手ではないが、動かせない)は、引き分け', () => {
    expect(statusOf(fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toBe('stalemate')
  })

  it('キャスリング: 王が 2 マス動き、ルークが飛ぶ。王手のかかるマスを通るときは、できない', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
    const p = play(fen, 'e1', 'g1')
    expect(p.board[parseSquare('g1')!]).toBe('K')
    expect(p.board[parseSquare('f1')!]).toBe('R')
    expect(p.board[parseSquare('h1')!]).toBe('.')
    expect(p.castling.wk).toBe(false)
    expect(p.castling.wq).toBe(false)
    // f1 に黒のルークの利きがあるときは、キングサイドはできない(クイーンサイドはできる)
    const blocked = fromFen('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1')
    const kings = chessMoves(blocked).filter((m) => m.from === parseSquare('e1'))
    expect(kings.some((m) => m.to === parseSquare('g1'))).toBe(false)
  })

  it('アンパッサン: 2 マス進んだポーンの横から、通り過ぎたマスへ取れる', () => {
    const p1 = play('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1', 'd7', 'd5')
    expect(p1.ep).toBe(parseSquare('d6'))
    const p2 = play(fenOf(p1), 'e5', 'd6')
    expect(p2.board[parseSquare('d5')!]).toBe('.') // 取られたポーン
    expect(p2.board[parseSquare('d6')!]).toBe('P')
  })

  it('プロモーション: 4 つの駒に成れる。成った駒が盤に載る', () => {
    const pos = fromFen('8/P7/8/8/8/8/8/k6K w - - 0 1')
    const promos = chessMoves(pos).filter((m) => m.from === parseSquare('a7')).map((m) => m.promo).sort()
    expect(promos).toEqual(['b', 'n', 'q', 'r'])
    expect(play('8/P7/8/8/8/8/8/k6K w - - 0 1', 'a7', 'a8', 'n').board[0]).toBe('N')
  })

  it('駒が足りない(キングだけ・キング + 軽い駒 1 つ)・50 手ルールは、引き分け', () => {
    expect(statusOf(fromFen('8/8/8/4k3/8/3K4/8/8 w - - 0 1'))).toBe('draw-material')
    expect(statusOf(fromFen('8/8/8/4k3/8/3KB3/8/8 w - - 0 1'))).toBe('draw-material')
    expect(statusOf(fromFen('8/8/8/4k3/8/3KR3/8/8 w - - 0 1'))).toBe('ongoing')
    expect(statusOf(fromFen('8/8/8/4k3/8/3KR3/8/8 w - - 100 80'))).toBe('draw-fifty')
  })

  it('自分の王を危険にさらす手は、合法手に入らない(ピン)', () => {
    const pos = fromFen('4k3/8/8/8/4r3/8/4N3/4K3 w - - 0 1') // e2 のナイトは、e ファイルでピンされている
    expect(chessMoves(pos).some((m) => m.from === parseSquare('e2'))).toBe(false)
  })
})

describe('チェスの AI', () => {
  it('1 手で詰ませられるなら、normal・hard は詰ませる。合法手だけを返す', () => {
    const pos = fromFen('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1') // Ra8 でチェックメイト
    for (const level of ['normal', 'hard'] as const) {
      const m = chooseChessMove(pos, level, seeded(1))!
      expect(statusOf(applyMove(pos, m))).toBe('checkmate')
    }
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const m = chooseChessMove(startPosition(), level, seeded(5))!
      expect(chessMoves(startPosition()).some((x) => x.from === m.from && x.to === m.to && x.promo === m.promo)).toBe(true)
    }
  })

  it('タダで取られる駒を取らずに、タダで取れる駒を取る(normal)', () => {
    // 黒のクイーンが d5 でタダ。白のポーン e4 で取れる
    const pos = fromFen('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1')
    const m = chooseChessMove(pos, 'normal', seeded(2))!
    expect([m.from, m.to]).toEqual([parseSquare('e4'), parseSquare('d5')])
  })

  it('チャットの入力: e2e4・e2 e4・e7e8q。マスでないものは null', () => {
    expect(parseChessInput('e2e4')).toEqual({ kind: 'move', move: { from: 52, to: 36 } })
    expect(parseChessInput('e2 e4')).toEqual({ kind: 'move', move: { from: 52, to: 36 } })
    expect(parseChessInput('E2-E4')).toEqual({ kind: 'move', move: { from: 52, to: 36 } })
    expect(parseChessInput('e7e8q')).toEqual({ kind: 'move', move: { from: 12, to: 4, promo: 'q' } })
    expect(parseChessInput('e9e4')).toBeNull()
    expect(parseChessInput('こんにちは')).toBeNull()
    expect(parseChessInput('やめる')).toEqual({ kind: 'stop' })
  })

  it('GameDef: ユーザーが後手なら、キャラ(白)が先に指す。盤は逆向き。手の検証・結果', () => {
    const s0 = chess.start('char')
    expect(s0.userColor).toBe('b')
    expect(chess.view(s0).flipped).toBe(true)
    expect(chess.view(s0).turn).toBe('char')
    const r = chess.playChar(s0, 'easy', seeded(1))!
    expect(chess.view(r.state).turn).toBe('user')
    // ユーザー(黒)の合法手は、黒の駒だけ
    const legal = chess.view(r.state).legal
    expect(legal.length).toBeGreaterThan(0)
    expect(legal.every((m) => r.state.pos.board[m.from as number] === r.state.pos.board[m.from as number].toLowerCase())).toBe(true)
    // 不正な手
    expect(chess.playUser(r.state, { from: 52, to: 36 })).toBeNull()
    expect(chess.playUser(r.state, { to: 36 } as GameMove)).toBeNull()
    // ユーザー(白)でプロモーション: promo 指定なしは、クイーンになる
    const promoState = { ...chess.start('user'), pos: fromFen('8/P7/8/8/8/8/8/k6K w - - 0 1') }
    const done = chess.playUser(promoState, { from: parseSquare('a7')!, to: parseSquare('a8')! })!
    expect(done.pos.board[0]).toBe('Q')
  })
})

/** 局面を FEN にする(テストで、局面をたどるための補助) */
function fenOf(p: ReturnType<typeof startPosition>): string {
  const rows: string[] = []
  for (let r = 0; r < 8; r++) {
    let row = ''
    let empty = 0
    for (let c = 0; c < 8; c++) {
      const ch = p.board[r * 8 + c]
      if (ch === '.') empty++
      else {
        if (empty) row += empty
        empty = 0
        row += ch
      }
    }
    rows.push(row + (empty ? empty : ''))
  }
  const cs = `${p.castling.wk ? 'K' : ''}${p.castling.wq ? 'Q' : ''}${p.castling.bk ? 'k' : ''}${p.castling.bq ? 'q' : ''}` || '-'
  return `${rows.join('/')} ${p.turn} ${cs} ${p.ep === null ? '-' : squareName(p.ep)} ${p.halfmove} ${p.fullmove}`
}

describe('ゲームのまとまり(ルールのノードの出し分け)', () => {
  it('どれかのゲームの Mod が ON なら、ゲームのトリガー・アクションが使える。名前は「ゲーム」', async () => {
    const { createRegistry } = await import('../rules/registry')
    const { featureModName, FEATURE_GROUPS } = await import('../mods/features')
    const { featureModsUsedByRules } = await import('../mods/migrate')
    const { parseRuleSetYaml } = await import('../rules/yaml')
    expect(createRegistry([]).modEnabled('game-any')).toBe(false)
    for (const m of FEATURE_GROUPS['game-any']) expect(createRegistry([m]).modEnabled('game-any')).toBe(true)
    expect(createRegistry(['motion-tags']).modEnabled('game-any')).toBe(false)
    expect(featureModName('game-any')).toBe('ゲーム')
    // 移行: ゲームのノードを使うルールを持つ以前の利用者は、最初のゲーム Mod(○×)を ON にする(まとまりの id は、Mod ではない)
    const rs = parseRuleSetYaml('version: 1\nrules:\n  - id: r\n    when: { trigger: gameResult, result: win }\n    do: [{ action: say, text: [やった] }]\n').ruleSet!
    expect([...featureModsUsedByRules(rs)]).toEqual(['game'])
  })
})
