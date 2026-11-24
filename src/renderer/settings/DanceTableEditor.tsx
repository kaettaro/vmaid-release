import { useState } from 'react'
import { MAX_DANCES, parseDanceDrafts, serializeDanceDrafts, type DanceEntry } from '@shared/dance'

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/**
 * ダンスの楽曲の表の編集(Mod のスロット kind: dances)。1 行 = 楽曲の名前 + 踊るモーション + BGM(曲ファイル・開始位置・音量)。
 * 「踊って ○○」の○○ に合う行が選ばれ、モーションと BGM が一緒に始まる。名前が空の行は、名前を入れるまで、踊りには使われない(選んだモーション・曲は、消えずに残る)。
 */
export function DanceTableEditor({
  value,
  motionNames,
  onChange
}: {
  /** スロットの値(JSON)。親が key で作り直すので、最初の 1 回だけ、行に読み込む */
  value: string
  motionNames: string[]
  onChange: (value: string) => void
}): React.JSX.Element {
  const [rows, setRows] = useState<DanceEntry[]>(() => parseDanceDrafts(value))

  const commit = (next: DanceEntry[]): void => {
    setRows(next)
    onChange(serializeDanceDrafts(next)) // 名前が空の行(下書き)も保存する。使われるのは、名前とモーションがそろった行だけ
  }
  const patch = (i: number, p: Partial<DanceEntry>): void => commit(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))

  return (
    <div className="dance-table">
      {rows.length === 0 && <p className="muted small">まだ、楽曲がありません。下の「楽曲を足す」で、名前・モーション・BGM を決めてください。</p>}
      {rows.map((r, i) => (
        <div key={i} className="engine-box">
          <div className="row">
            <label className="row">
              楽曲の名前
              <input type="text" defaultValue={r.name} maxLength={40} placeholder="例: ワルツ" onBlur={(e) => e.target.value !== r.name && patch(i, { name: e.target.value })} />
            </label>
            <label className="row">
              モーション
              <select value={r.motion} onChange={(e) => patch(i, { motion: e.target.value })}>
                {!motionNames.includes(r.motion) && <option value={r.motion}>{r.motion}(見つかりません)</option>}
                {motionNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <span>BGM</span>
            <code className="small">{r.bgm === '' ? '(なし。モーションだけ)' : fileName(r.bgm)}</code>
            <button
              onClick={() =>
                void window.vmaid.pickAudioFile().then((p) => {
                  if (p) patch(i, { bgm: p })
                })
              }
            >
              {r.bgm === '' ? '曲を選ぶ…' : '曲を選び直す…'}
            </button>
            {r.bgm !== '' && <button onClick={() => patch(i, { bgm: '' })}>曲を外す</button>}
          </div>
          {r.bgm !== '' && (
            <div className="row">
              <label className="row">
                曲の開始位置(秒)
                <input
                  type="number"
                  min={0}
                  max={3600}
                  step={0.1}
                  defaultValue={r.offsetSec}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n !== r.offsetSec) patch(i, { offsetSec: n })
                  }}
                />
              </label>
              <label className="row">
                BGM の音量 {Math.round(r.volume * 100)}%
                <input type="range" min={0} max={1} step={0.05} value={r.volume} onChange={(e) => patch(i, { volume: Number(e.target.value) })} />
              </label>
            </div>
          )}
          <div className="row">
            <button disabled={r.name.trim() === ''} onClick={() => window.vmaid.previewAudio({ kind: 'dance', entry: r })}>
              試しに踊る
            </button>
            <button onClick={() => commit(rows.filter((_, j) => j !== i))}>この楽曲を削除</button>
          </div>
        </div>
      ))}
      {rows.length < MAX_DANCES && (
        <div className="row">
          <button onClick={() => commit([...rows, { name: '', motion: motionNames[0] ?? '', bgm: '', offsetSec: 0, volume: 1 }])}>楽曲を足す</button>
        </div>
      )}
      <p className="muted small">
        「踊って ○○」と入力すると、名前が○○の楽曲のモーションが始まり、同時に BGM が流れます(モーションが終わると、BGM も止まります)。表に無い名前は、その名前のモーションを、BGM なしで再生します。
        曲の頭に前奏があって振り付けと合わないときは、「曲の開始位置」で、曲を途中から流します。曲のファイルは自分で選びます(VMaid は同梱しません)。
      </p>
    </div>
  )
}
