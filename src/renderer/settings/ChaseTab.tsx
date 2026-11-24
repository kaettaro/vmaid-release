import { useCallback, useEffect, useState } from 'react'
import { CHASE_ID, type ChasePatch, type ChaseSettings, type ChaseView } from '@shared/chase'
import { Toggle } from './Toggle'

interface SliderDef {
  key: keyof ChaseSettings & ('strength' | 'speed' | 'headMaxDeg' | 'bodyMaxDeg' | 'reactDistance')
  label: string
  min: number
  max: number
  step: number
  unit?: string
  hint?: string
}

const SLIDERS: SliderDef[] = [
  { key: 'strength', label: '追う強さ', min: 0, max: 1, step: 0.05, hint: '1 でカーソルの真正面まで向く。0.5 で半分だけ' },
  { key: 'speed', label: '追いつく速さ', min: 1, max: 10, step: 0.5, hint: '大きいほど、すばやく向く' },
  { key: 'headMaxDeg', label: '頭の最大の角度', min: 5, max: 80, step: 1, unit: '度', hint: '首をひねる限界。上下は、この 6 割まで' },
  { key: 'bodyMaxDeg', label: '体の最大の角度', min: 5, max: 60, step: 1, unit: '度', hint: '「体ごと」が ON のときだけ。大きいと、横を向いて見切れることがあります' },
  { key: 'reactDistance', label: '反応する距離', min: 0, max: 4000, step: 50, unit: 'px', hint: 'キャラの頭からカーソルまでが、これより遠いと、正面に戻ります。0 なら、どこまでも追います' }
]

/** 追いかけタブ: 機能 Mod「追いかけ」の ON/OFF と、動き方の調整 */
export function ChaseTab(): React.JSX.Element {
  const [view, setView] = useState<ChaseView | null>(null)
  useEffect(() => {
    void window.vmaid.getChase().then(setView)
    return window.vmaid.onChaseChanged(setView)
  }, [])
  const save = useCallback(async (patch: ChasePatch): Promise<void> => setView(await window.vmaid.saveChase(patch)), [])

  if (!view) return <p className="muted">読み込み中…</p>

  const flag = (key: 'gaze' | 'head' | 'body' | 'cascade', label: string, hint: string): React.JSX.Element => (
    <label className="check">
      <Toggle checked={view[key]} label={label} onChange={(on) => void save({ [key]: on })} />
      {label}
      <span className="muted small"> — {hint}</span>
    </label>
  )

  return (
    <section>
      <h1>追いかけ</h1>
      <p className="muted">
        キャラが、画面上のカーソルの方を向きます。カーソルの位置は、画面上の座標を読むだけで、保存も送信もしません(通信はしません)。
      </p>
      <div className="engine-box">
        <label className="check">
          <Toggle checked={view.enabled} label="追いかけ" onChange={(on) => void window.vmaid.setFeatureMod(CHASE_ID, on)} />
          追いかけ(公式の機能 Mod)
        </label>
        {view.enabled && (
          <>
            {flag('gaze', '視線(目)', '目だけで追う(目のボーンを持つモデルのみ)')}
            {flag('head', '頭と首', '首をひねって、顔を向ける')}
            {flag('body', '体ごと', 'キャラ全体の向きを、少し回す(保存してある向きは、変わりません)')}
            {flag('cascade', '遅れてついてくる', '目 → 頭 → 体の順に、少しずつ遅れて向く(生き物らしい動き)')}
            {SLIDERS.map((d) => {
              const value = view[d.key]
              return (
                <label key={d.key} className="field">
                  <span className="field-label">
                    {d.label}: {Number.isInteger(d.step) || Number.isInteger(value) ? value : value.toFixed(2)}
                    {d.unit ?? ''}
                  </span>
                  <input type="range" min={d.min} max={d.max} step={d.step} value={value} onChange={(e) => void save({ [d.key]: Number(e.target.value) })} />
                  {d.hint && <span className="field-hint">{d.hint}</span>}
                </label>
              )
            })}
            <div className="row">
              <button onClick={() => void save({ gaze: true, head: true, body: false, cascade: true, strength: 0.8, speed: 5, headMaxDeg: 35, bodyMaxDeg: 25, reactDistance: 0 })}>初期値に戻す</button>
            </div>
          </>
        )}
      </div>
      <p className="muted small">
        緊急リセット(基本設定)でも、正面に戻ります。クリック透過の設定とは関係なく、キャラ窓の外のカーソルも追います。PMX は、首・頭・左目・右目の骨を使います(物理で動く髪との見え方は、モデルによって違います)。
      </p>
    </section>
  )
}
