import { useEffect, useState } from 'react'
import type { OverlayEffectInfo } from '@shared/overlay'

const NEW_TEMPLATE = `label: わたしの効果
color: "#ff8ac8"
layers:
  - { type: fog, alpha: 0.5, blobs: 8, size: 0.35, speed: 0.03 }
`

/**
 * 公式の機能 Mod「画面効果」の、効果の作成・登録。効果は「レイヤーの組み合わせ」(YAML)で、スクリプトは使わない。
 * 組み込みの効果は、コピーして作る。保存した効果は、ルールの「画面効果を出す」と、Mod の設定項目(効果)から選べる。
 */
export function OverlayEffectsEditor(): React.JSX.Element {
  const [effects, setEffects] = useState<OverlayEffectInfo[]>([])
  const [selected, setSelected] = useState('spiral')
  const [name, setName] = useState('')
  const [yaml, setYaml] = useState('')
  const [scope, setScope] = useState<'screen' | 'character'>('screen')
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const choose = (list: OverlayEffectInfo[], n: string): void => {
    const e = list.find((x) => x.name === n)
    if (!e) return
    setSelected(n)
    setYaml(e.yaml)
    setName(e.builtin ? `${n}-2` : n) // 組み込みは、別の名前で保存する(コピーして作る)
    setNote(e.error ? { ok: false, text: e.error } : null)
  }

  useEffect(() => {
    void window.vmaid.getOverlayEffects().then((l) => {
      setEffects(l)
      choose(l, 'spiral')
    })
  }, [])

  const current = effects.find((e) => e.name === selected)
  const apply = (r: { ok: boolean; message: string; effects: OverlayEffectInfo[] }, pick?: string): void => {
    setEffects(r.effects)
    setNote({ ok: r.ok, text: r.message })
    if (pick) choose(r.effects, pick)
  }

  return (
    <details className="effects-editor">
      <summary>画面効果を作る・編集する({effects.filter((e) => !e.builtin).length} 個の自作)</summary>
      <p className="muted small">
        効果は、レイヤーを重ねて作ります(スクリプトは使いません)。組み込みの効果を選ぶと中身が見られます。名前を変えて保存すると、コピーして作れます。保存した効果は、ルールの「画面効果を出す」と、Mod の設定項目から選べます。
      </p>
      <div className="row">
        <label className="field-inline">
          効果
          <select value={selected} onChange={(e) => choose(effects, e.target.value)}>
            {effects.map((e) => (
              <option key={e.name} value={e.name}>
                {e.label}({e.name}){e.builtin ? ' [組み込み]' : ''}
                {e.error ? ' [エラー]' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          onClick={() => {
            setName('my-effect')
            setYaml(NEW_TEMPLATE)
            setNote(null)
          }}
        >
          新しく作る
        </button>
      </div>
      <textarea className="mono" rows={12} spellCheck={false} value={yaml} onChange={(e) => setYaml(e.target.value)} />
      <div className="row">
        <label className="field-inline">
          保存する名前
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-effect" />
        </label>
        <button onClick={() => void window.vmaid.saveOverlayEffect(name.trim(), yaml).then((r) => apply(r, r.ok ? name.trim() : undefined))}>保存</button>
        {current && !current.builtin && (
          <button
            className="danger"
            onClick={() => {
              if (window.confirm(`効果「${current.name}」を削除します。`)) void window.vmaid.deleteOverlayEffect(current.name).then((r) => { apply(r); choose(r.effects, 'spiral') })
            }}
          >
            削除
          </button>
        )}
      </div>
      <div className="row">
        <label className="field-inline">
          試す範囲
          <select value={scope} onChange={(e) => setScope(e.target.value as 'screen' | 'character')}>
            <option value="screen">画面全体</option>
            <option value="character">キャラの近くだけ</option>
          </select>
        </label>
        <button className="secondary" onClick={() => void window.vmaid.previewOverlayEffect(yaml, scope).then((r) => setNote({ ok: r.ok, text: r.message }))}>
          試し表示(6 秒。保存はしません)
        </button>
      </div>
      {note && <p className={note.ok ? 'ok small' : 'ng small'}>{note.text}</p>}
      <details>
        <summary className="small">書き方(リファレンス)</summary>
        <pre className="small">{REFERENCE}</pre>
      </details>
    </details>
  )
}

const REFERENCE = `label: 一覧に出す名前
color: "#rrggbb"          # 主な色(ルール・設定で色を指定しないときに使う)
layers:                   # 1〜6 個。上から順に重ねる
  - { type: spiral,    color: main, alpha: 0.55, arms: 2, speed: 0.08, turns: 9 }
      # arms 1〜8 / speed 回転数/秒(±0.3) / turns 中心から端までの巻き数 3〜20
  - { type: fog,       color: main, alpha: 0.5, blobs: 8, size: 0.35, speed: 0.03 }
      # blobs 3〜16 / size 画面の短辺に対する大きさ 0.15〜0.8 / speed 0〜0.2
  - { type: vignette,  color: main, alpha: 0.9, inner: 0.25 }
      # inner 0〜0.9(中心の、色づかない範囲)
  - { type: pulse,     color: main, alpha: 0.5, hz: 0.3 }
      # hz 0.05〜0.5(点滅を避けるため、上限があります)
  - { type: fill,      color: main, alpha: 0.5 }
  - { type: particles, color: main, alpha: 0.6, shape: heart, count: 30, size: 16, speed: 0.05 }
      # shape: dot / heart / star / ring。count 5〜80 / size 4〜60 / speed 0.01〜0.3
  - { type: rings,     color: main, alpha: 0.5, count: 5, speed: 0.08 }
# color は #rrggbb か main(= ルール・設定で指定した色。無ければ、上の color)。alpha は 0〜1。`

