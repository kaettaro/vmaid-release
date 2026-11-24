import { useEffect, useState } from 'react'
import { MAX_RECTS, MOVE_MODES, MOVE_TARGETS, WARP_FX_MODES, WARP_FX_WHERE, WARP_SHAPES, type MoveMode, type MovePatch, type MoveTarget, type MoveView, type WarpFx } from '@shared/move'
import { Toggle } from './Toggle'

const TARGET_LABEL: Record<MoveTarget, string> = { random: 'ランダム', left: '左端', right: '右端', center: '中央', cursor: 'カーソルの近く' }
const MODE_LABEL: Record<MoveMode, string> = { walk: '歩く', warp: 'ワープ' }
const SHAPE_LABEL: Record<(typeof WARP_SHAPES)[number], string> = { dot: '丸', heart: 'ハート', star: '星', ring: '輪', square: '四角', diamond: 'ひし形', spark: 'きらめき' }
const FX_MODE_LABEL: Record<(typeof WARP_FX_MODES)[number], string> = { burst: '広がる', rise: '昇る', fall: '降る' }
const FX_WHERE_LABEL: Record<(typeof WARP_FX_WHERE)[number], string> = { from: '元いた場所', to: '新しい場所', both: '両方' }

/** ワープの演出(任意の色・形の粒を、元の場所・新しい場所に出す)の設定 */
function WarpFxBox({ fx, onChange }: { fx: WarpFx; onChange: (fx: WarpFx) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(fx)
  const set = (patch: Partial<WarpFx>, commit = true): void => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (commit) onChange(next)
  }
  const slider = (key: 'count' | 'size' | 'durationMs' | 'speed' | 'gravity', label: string, min: number, max: number, step: number): React.JSX.Element => (
    <label className="field">
      <span className="field-label">
        {label}: {draft[key]}
      </span>
      <input type="range" min={min} max={max} step={step} value={draft[key]} onChange={(e) => set({ [key]: Number(e.target.value) }, false)} onMouseUp={() => onChange(draft)} onKeyUp={() => onChange(draft)} />
    </label>
  )
  return (
    <div className="engine-box">
      <label className="check">
        <Toggle checked={draft.enabled} label="ワープの演出" onChange={(on) => set({ enabled: on })} />
        ワープのとき、粒を出す(画面効果 Mod が OFF でも出ます)
      </label>
      {draft.enabled && (
        <>
          <div className="field-inline">
            <label>
              場所{' '}
              <select value={draft.where} onChange={(e) => set({ where: e.target.value as WarpFx['where'] })}>
                {WARP_FX_WHERE.map((w) => (
                  <option key={w} value={w}>
                    {FX_WHERE_LABEL[w]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              形{' '}
              <select value={draft.shape} onChange={(e) => set({ shape: e.target.value as WarpFx['shape'] })}>
                {WARP_SHAPES.map((w) => (
                  <option key={w} value={w}>
                    {SHAPE_LABEL[w]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              動き{' '}
              <select value={draft.mode} onChange={(e) => set({ mode: e.target.value as WarpFx['mode'] })}>
                {WARP_FX_MODES.map((w) => (
                  <option key={w} value={w}>
                    {FX_MODE_LABEL[w]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-inline">
            <span>色(粒ごとに、ランダムに選ばれます)</span>
            {draft.colors.map((c, i) => (
              <span key={i} className="field-inline">
                <input type="color" value={c} onChange={(e) => set({ colors: draft.colors.map((x, j) => (j === i ? e.target.value : x)) }, false)} onBlur={() => onChange(draft)} />
                {draft.colors.length > 1 && (
                  <button title="この色を消す" onClick={() => set({ colors: draft.colors.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                )}
              </span>
            ))}
            {draft.colors.length < 6 && <button onClick={() => set({ colors: [...draft.colors, '#ffffff'] })}>色を足す</button>}
          </div>
          {slider('count', '粒の数', 5, 80, 1)}
          {slider('size', '粒の大きさ', 4, 60, 1)}
          {slider('durationMs', '出ている時間(ミリ秒)', 300, 5000, 50)}
          {slider('speed', '広がる・漂う速さ', 0.02, 1.5, 0.02)}
          {slider('gravity', '重力(正で落ちる・負で昇る)', -1, 1, 0.05)}
          <button onClick={() => window.vmaid.previewMoveFx()}>演出だけ見る</button>
        </>
      )}
    </div>
  )
}

/** 機能 Mod「より自由な移動」の設定(Mod タブの、この Mod の行の中)。自動で歩き回る・動ける範囲・歩く速さ・ワープ。試しに動かすボタンつき */
export function MoveTab(): React.JSX.Element {
  const [view, setView] = useState<MoveView | null>(null)
  const [target, setTarget] = useState<MoveTarget>('random')
  useEffect(() => {
    void window.vmaid.getMove().then(setView)
  }, [])
  if (!view) return <p className="muted">読み込み中…</p>
  const save = (patch: MovePatch): void => void window.vmaid.saveMove(patch).then(setView)
  const slider = (key: 'speed' | 'margin' | 'warpFadeMs' | 'roamMinSec' | 'roamMaxSec', label: string, min: number, max: number, step: number, unit: string): React.JSX.Element => (
    <label className="field">
      <span className="field-label">
        {label}: {view[key]}
        {unit}
      </span>
      <input type="range" min={min} max={max} step={step} value={view[key]} onChange={(e) => setView({ ...view, [key]: Number(e.target.value) })} onMouseUp={(e) => save({ [key]: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => save({ [key]: Number((e.target as HTMLInputElement).value) })} />
    </label>
  )
  return (
    <div className="engine-box">
      <p className="muted small">ルールのアクション「移動する」(行き先・歩く/ワープ)で動かせます。ここでは、自動で歩き回る設定と、動き方を決めます。ドラッグ・緊急リセットで、止まります。</p>
      <div className="field-inline">
        <strong>試しに動かす</strong>
        <select value={target} onChange={(e) => setTarget(e.target.value as MoveTarget)}>
          {MOVE_TARGETS.map((t) => (
            <option key={t} value={t}>
              {TARGET_LABEL[t]}
            </option>
          ))}
        </select>
        {MOVE_MODES.map((m) => (
          <button key={m} onClick={() => window.vmaid.moveTo(target, m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
        <button onClick={() => window.vmaid.stopMove()}>止める</button>
      </div>
      <label className="check">
        <Toggle checked={view.autoRoam} label="自動で歩き回る" onChange={(on) => save({ autoRoam: on })} />
        放置しているとき、自動で歩き回る(会話中・ゲーム中・非表示のときは、動きません)
      </label>
      {view.autoRoam && (
        <>
          {slider('roamMinSec', '次に動くまでの、最短', 5, 600, 5, ' 秒')}
          {slider('roamMaxSec', '次に動くまでの、最長', 5, 1800, 5, ' 秒')}
          <label className="field">
            <span className="field-label">ワープする割合: {Math.round(view.warpChance * 100)}%(残りは、歩く)</span>
            <input type="range" min={0} max={1} step={0.05} value={view.warpChance} onChange={(e) => setView({ ...view, warpChance: Number(e.target.value) })} onMouseUp={(e) => save({ warpChance: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => save({ warpChance: Number((e.target as HTMLInputElement).value) })} />
          </label>
        </>
      )}
      <div className="field-inline">
        <label>
          動ける範囲の決め方{' '}
          <select value={view.areaMode} onChange={(e) => save({ areaMode: e.target.value as MoveView['areaMode'] })}>
            <option value="display">画面(下の設定)</option>
            <option value="rects">画面上で決めた範囲</option>
          </select>
        </label>
        <button onClick={() => void window.vmaid.openMoveArea().then(setView)}>範囲を設定…</button>
        <span className="muted small">
          決めた範囲: {view.rects.length}/{MAX_RECTS} か所
        </span>
        {view.rects.length > 0 && <button onClick={() => save({ rects: [], areaMode: 'display' })}>範囲をクリア</button>}
      </div>
      {view.areaMode === 'rects' && view.rects.length > 0 && <p className="muted small">キャラの窓が、決めた四角の中に収まるように動きます(四角が窓より小さいときは、その中央に寄ります)。画面の構成を変えて、どの四角も画面と重ならないときは、画面全体に戻ります。</p>}
      <div className="field-inline">
        <label>
          動ける範囲{' '}
          <select value={view.area} onChange={(e) => save({ area: e.target.value as MoveView['area'] })}>
            <option value="all">すべての画面</option>
            <option value="current">いまいる画面だけ</option>
          </select>
        </label>
        <label className="check">
          <Toggle checked={view.freeVertical} label="上下にも動く" onChange={(on) => save({ freeVertical: on })} />
          上下にも動く(オフなら、左右だけ)
        </label>
      </div>
      {slider('speed', '歩く速さ', 40, 1200, 10, ' px/秒')}
      {slider('margin', '画面の端の余白', 0, 300, 5, ' px')}
      {slider('warpFadeMs', 'ワープの、消える・現れるの時間', 100, 2000, 50, ' ミリ秒')}
      <div className="field-inline">
        <label>
          歩くときのモーションのタグ{' '}
          <input type="text" defaultValue={view.walkTag} maxLength={30} onBlur={(e) => save({ walkTag: e.target.value })} />
        </label>
        <label>
          ワープのあとのモーションのタグ{' '}
          <input type="text" defaultValue={view.warpTag} maxLength={30} placeholder="空なら、何も再生しない" onBlur={(e) => save({ warpTag: e.target.value })} />
        </label>
      </div>
      <WarpFxBox key={JSON.stringify(view.warpFx)} fx={view.warpFx} onChange={(warpFx) => save({ warpFx })} />
      <p className="muted small">
        歩行のモーションは、そのタグが付いたモーションの中から、ランダムに 1 つ(無ければ、内蔵の簡易な歩行)。ワープのあとは、「待機」タグなどの中から 1 つを、1 回再生します(モーションタブで、自分のモーションにタグを付けられます)。ワープは、ウィンドウを透明にして消え、別の場所で現れます。
      </p>
    </div>
  )
}
