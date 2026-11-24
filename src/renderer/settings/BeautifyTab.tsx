import { useCallback, useEffect, useState } from 'react'
import { BEAUTIFY_REAL_ID, BEAUTIFY_TOON_ID, REAL_PRESETS, TOON_PRESETS, presetValues, type BeautifyView, type RealParams, type ToonParams } from '@shared/beautify'
import { Toggle } from './Toggle'

interface SliderDef<T> {
  key: keyof T & string
  label: string
  min: number
  max: number
  step: number
  unit?: string
  hint?: string
}

const REAL_SLIDERS: SliderDef<RealParams>[] = [
  { key: 'keyIntensity', label: '主光の強さ', min: 0, max: 3, step: 0.05 },
  { key: 'keyTemp', label: '主光の色温度', min: 2500, max: 10000, step: 100, unit: 'K', hint: '低いほど暖かい(夕方)、高いほど青白い' },
  { key: 'keyAzimuth', label: '主光の左右の向き', min: -90, max: 90, step: 1, unit: '度', hint: '正面が 0、右が +' },
  { key: 'keyElevation', label: '主光の高さ', min: 0, max: 85, step: 1, unit: '度' },
  { key: 'fillIntensity', label: '補助光(影を起こす)', min: 0, max: 2, step: 0.05 },
  { key: 'rimIntensity', label: '輪郭光(背後の縁の光)', min: 0, max: 3, step: 0.05 },
  { key: 'ambient', label: '環境光', min: 0, max: 2, step: 0.05 },
  { key: 'exposure', label: '露出', min: 0.4, max: 2.5, step: 0.05 },
  { key: 'saturation', label: '彩度', min: 0.5, max: 1.6, step: 0.05 },
  { key: 'softShading', label: '陰影のやわらかさ', min: 0, max: 1, step: 0.05, hint: 'VRM(MToon)のみ。1 で、境目がなめらかになる' },
  { key: 'shadowStrength', label: '自分の影の濃さ', min: 0, max: 1, step: 0.05 },
  { key: 'bloom', label: 'ブルーム(光のにじみ)', min: 0, max: 1.5, step: 0.05, hint: '輪郭の内側だけ。0 で、計算しない' },
  { key: 'bloomThreshold', label: 'ブルームの明るさのしきい値', min: 0.3, max: 1.5, step: 0.05 },
  { key: 'bloomRadius', label: 'ブルームの広がり', min: 0, max: 1, step: 0.05 }
]

const TOON_SLIDERS: SliderDef<ToonParams>[] = [
  { key: 'lightIntensity', label: '光の強さ', min: 0, max: 3, step: 0.05 },
  { key: 'lightAzimuth', label: '光の左右の向き', min: -90, max: 90, step: 1, unit: '度' },
  { key: 'lightElevation', label: '光の高さ', min: 0, max: 85, step: 1, unit: '度' },
  { key: 'ambient', label: '環境光', min: 0, max: 2, step: 0.05 },
  { key: 'shadeShift', label: '影の量', min: -1, max: 1, step: 0.05, hint: '大きいほど、影が増える(VRM のみ)' },
  { key: 'shadeEdge', label: '影の境目のくっきり度', min: 0, max: 1, step: 0.05, hint: '0 でぼかし、1 でくっきり(VRM のみ)' },
  { key: 'rim', label: '縁の光(リムライト)', min: 0, max: 1, step: 0.05, hint: 'VRM のみ' },
  { key: 'outline', label: '輪郭線の太さ(倍率)', min: 0, max: 3, step: 0.1, hint: '輪郭線を持つ VRM のみ。0 で、なし' },
  { key: 'saturation', label: '彩度', min: 0.5, max: 1.8, step: 0.05 }
]

/** 美化タブ: 機能 Mod「美化(リアル)」「美化(トゥーン)」の ON/OFF と、見た目の調整(どちらか一方だけ ON にできる) */
export function BeautifyTab(): React.JSX.Element {
  const [view, setView] = useState<BeautifyView | null>(null)
  useEffect(() => {
    void window.vmaid.getBeautify().then(setView)
    return window.vmaid.onBeautifyChanged(setView)
  }, [])
  const save = useCallback(async (patch: Parameters<typeof window.vmaid.saveBeautify>[0]): Promise<void> => setView(await window.vmaid.saveBeautify(patch)), [])

  if (!view) return <p className="muted">読み込み中…</p>

  const section = <T extends RealParams | ToonParams>(
    kind: 'real' | 'toon',
    id: string,
    enabled: boolean,
    title: string,
    desc: string,
    presets: Record<string, { label: string }>,
    sliders: SliderDef<T>[],
    params: T
  ): React.JSX.Element => (
    <div className="engine-box">
      <label className="check">
        <Toggle checked={enabled} label={title} onChange={(on) => void window.vmaid.setFeatureMod(id, on)} />
        {title}(公式の機能 Mod)
      </label>
      <p className="muted small">{desc}</p>
      {enabled && (
        <>
          <label className="field">
            <span className="field-label">プリセット</span>
            <select
              value={presets[params.preset] ? params.preset : 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom') void save({ [kind]: presetValues(kind, e.target.value) })
              }}
            >
              {Object.entries(presets).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
              {!presets[params.preset] && <option value="custom">カスタム</option>}
            </select>
          </label>
          {sliders.map((d) => {
            const value = params[d.key as keyof T] as number
            return (
              <label key={d.key} className="field">
                <span className="field-label">
                  {d.label}: {Number.isInteger(d.step) ? value : value.toFixed(2)}
                  {d.unit ?? ''}
                </span>
                <input type="range" min={d.min} max={d.max} step={d.step} value={value} onChange={(e) => void save({ [kind]: { [d.key]: Number(e.target.value), preset: 'custom' } })} />
                {d.hint && <span className="field-hint">{d.hint}</span>}
              </label>
            )
          })}
          {kind === 'real' && (
            <>
              <label className="check">
                <Toggle checked={(params as RealParams).shadow} label="自分の影" onChange={(on) => void save({ real: { shadow: on, preset: 'custom' } })} />
                自分の体や髪が落とす影(キャラの外には落としません)
              </label>
              <label className="check">
                <Toggle checked={(params as RealParams).tonemap === 'aces'} label="階調" onChange={(on) => void save({ real: { tonemap: on ? 'aces' : 'none', preset: 'custom' } })} />
                階調を整える(明るい所の白飛びを抑え、フィルムのような色合いにする)
              </label>
            </>
          )}
          <div className="row">
            <button onClick={() => void save({ [kind]: presetValues(kind, kind === 'real' ? 'natural' : 'anime') })}>初期値に戻す</button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <section>
      <h1>美化</h1>
      <p className="muted">
        ライティングや陰影を整えて、モデルをきれいに見せます。リアル寄りと、トゥーン(アニメ)寄りがあり、どちらか一方だけ ON にできます(片方を ON にすると、もう片方は OFF になります)。
        見た目が変わるだけで、通信はしません。重くなったときは、OFF にするか、ブルームを 0 にしてください。
      </p>
      {section('real', BEAUTIFY_REAL_ID, view.realEnabled, '美化(リアル)', '主光・補助光・輪郭光、階調、自分の影、ブルーム。RayMMD のような雰囲気に寄せます。', REAL_PRESETS, REAL_SLIDERS, view.real)}
      {section('toon', BEAUTIFY_TOON_ID, view.toonEnabled, '美化(トゥーン)', '影の境目・縁の光・輪郭線・彩度。アニメ調にくっきり、またはやわらかく見せます。', TOON_PRESETS, TOON_SLIDERS, view.toon)}
      <p className="muted small">VRM(MToon)は、陰影・縁の光・輪郭線まで調整できます。MMD(PMX)は、ライトと仕上げ(階調・彩度・ブルーム)だけが効きます。</p>
    </section>
  )
}
