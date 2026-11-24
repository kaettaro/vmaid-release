import { useEffect, useState } from 'react'
import type { TalkPatch, TalkView } from '@shared/talk/gate'
import { Toggle } from './Toggle'

/** 機能 Mod「話しかけ」の設定(Mod タブの、この Mod の行の中)。静かにして・最小の間隔・1 日の上限・夜間の時間帯 */
export function TalkTab(): React.JSX.Element {
  const [view, setView] = useState<TalkView | null>(null)
  useEffect(() => {
    void window.vmaid.getTalk().then(setView)
    return window.vmaid.onTalkChanged(setView) // トレイのメニューの「静かにして」と、同期する
  }, [])
  if (!view) return <p className="muted">読み込み中…</p>
  const save = (patch: TalkPatch): void => void window.vmaid.saveTalk(patch).then(setView)
  return (
    <div className="engine-box">
      <p className="muted small">キャラのほうから話しかけるルール(「一定の間隔で」「放置したとき」「決まった時刻」など。この Mod のルールも、自分のルールも)に、「話しかけてよいとき」の条件を付けると、次の設定が効きます。</p>
      <label className="check">
        <Toggle checked={view.muted} label="静かにして" onChange={(on) => save({ muted: on })} />
        静かにして(ON の間は、自分からは話しかけない。トレイのメニューからも切り替えられます)
      </label>
      <div className="field-inline">
        <label>
          話しかけの最小の間隔{' '}
          <input type="number" min={0} max={1440} value={view.minGapMin} style={{ width: 72 }} onChange={(e) => setView({ ...view, minGapMin: Number(e.target.value) })} onBlur={(e) => save({ minGapMin: Number(e.target.value) })} /> 分
        </label>
        <label>
          1 日の上限{' '}
          <input type="number" min={0} max={1000} value={view.dailyLimit} style={{ width: 72 }} onChange={(e) => setView({ ...view, dailyLimit: Number(e.target.value) })} onBlur={(e) => save({ dailyLimit: Number(e.target.value) })} /> 回(0 = 無制限)
        </label>
      </div>
      <div className="field-inline">
        <label className="check">
          <Toggle checked={view.quietEnabled} label="夜間は話しかけない" onChange={(on) => save({ quietEnabled: on })} />
          夜間は話しかけない
        </label>
        {view.quietEnabled && (
          <>
            <label>
              <input type="time" value={view.quietFrom} onChange={(e) => e.target.value && save({ quietFrom: e.target.value })} />
            </label>
            〜
            <label>
              <input type="time" value={view.quietTo} onChange={(e) => e.target.value && save({ quietTo: e.target.value })} />
            </label>
          </>
        )}
      </div>
      <p className="muted small">会話中(入力欄を開いている・返答中)・ゲーム中・キャラを非表示にしているときも、話しかけません。既定: 10 分あけ・1 日 20 回まで・夜 23:00〜7:00。</p>
    </div>
  )
}
