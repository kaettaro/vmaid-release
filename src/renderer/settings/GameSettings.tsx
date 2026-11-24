import { useEffect, useState } from 'react'
import type { GameId } from '@shared/game/engine'
import { GAMES } from '@shared/game/registry'
import type { GameView } from '@shared/game/types'

const LEVEL_HINT: Record<GameId, string> = {
  tictactoe: 'やさしい: 勝てる手以外は、ランダム / ふつう・つよい: 防ぐ・中央・角の順に打つ(同じ強さ)',
  connect4: 'やさしい: 勝てる手以外は、ランダム / ふつう: 4 手先まで読む / つよい: 6 手先まで読む',
  reversi: 'やさしい: 角が取れれば取る、ほかはランダム / ふつう: 2 手先まで読む / つよい: 4 手先まで読む',
  chess: 'やさしい: 1 手先まで(ときどき、悪い手も指す) / ふつう: 2 手先まで / つよい: 3 手先まで(込み入った局面では、浅くなります)'
}
const FIRST_LABEL: Record<GameId, { user: string; char: string }> = {
  tictactoe: { user: 'あなた(○)', char: 'キャラ(×)' },
  connect4: { user: 'あなた', char: 'キャラ' },
  reversi: { user: 'あなた(黒)', char: 'キャラ(黒)' },
  chess: { user: 'あなた(白)', char: 'キャラ(白。あなたは黒)' }
}

/** 公式の機能 Mod「ゲーム」(○×・コネクト 4・リバーシ・チェス)の設定(キャラの強さ・先攻)と、遊び方。設定は、4 つのゲームで共通 */
export function GameSettings({ game = 'tictactoe' }: { game?: GameId }): React.JSX.Element {
  const [view, setView] = useState<GameView | null>(null)
  useEffect(() => {
    void window.vmaid.getGame().then(setView)
  }, [])
  if (!view) return <></>
  const def = GAMES[game]
  const first = FIRST_LABEL[game]
  return (
    <div className="engine-box">
      <label className="field">
        <span className="field-label">キャラの強さ(4 つのゲームで共通)</span>
        <select value={view.level} onChange={(e) => void window.vmaid.saveGame({ level: e.target.value as GameView['level'] }).then(setView)}>
          <option value="easy">やさしい</option>
          <option value="normal">ふつう</option>
          <option value="hard">つよい</option>
        </select>
        <span className="field-hint">{LEVEL_HINT[game]}</span>
      </label>
      <label className="field">
        <span className="field-label">先攻</span>
        <select value={view.first} onChange={(e) => void window.vmaid.saveGame({ first: e.target.value as GameView['first'] }).then(setView)}>
          <option value="user">{first.user}</option>
          <option value="char">{first.char}</option>
          <option value="random">ランダム</option>
        </select>
      </label>
      <p className="muted small">
        遊び方({def.title}): この Mod を ON にして、チャットで始める言葉を入力します(始める言葉は、この Mod の設定「ゲームを始める言葉」で変えられます)。{def.help}
        自分のルールからは、アクション「ゲームを始める」(ゲームを選べます)と、トリガー「ゲームで手が打たれたとき」「ゲームが終わったとき」が使えます。緊急リセット(基本設定)でも、ゲームは終わります。同時に遊べるのは 1 つだけです。
      </p>
    </div>
  )
}
