import { useEffect, useState } from 'react'
import { ARM_ANGLE_RANGE, type VmdImportView } from '@shared/vmdImport'

/** 標準の MMD モデルの A ポーズの腕の角度(目安。実測値は、約 45°) */
const STANDARD_ARM_DEG = 45

/** 機能 Mod「MMD 対応」の設定の、VMD の変換の部分(Mod タブの、この Mod の行の中)。腕の基準の角度 */
export function VmdImportTab(): React.JSX.Element {
  const [view, setView] = useState<VmdImportView | null>(null)
  useEffect(() => {
    void window.vmaid.getVmdImport().then(setView)
  }, [])
  if (!view) return <p className="muted">読み込み中…</p>
  const auto = view.armAngleDeg === null
  const save = (armAngleDeg: number | null): void => void window.vmaid.saveVmdImport({ armAngleDeg }).then(setView)
  return (
    <div className="engine-box">
      <p className="muted small">
        MMD のモーションは、モデルの「A ポーズ」(腕が水平から少し下がった立ち姿)を基準に作られています。VRM(T ポーズ)に合わせるとき、その角度が違うと、腕の高さがずれます。
        モーションを作ったモデルに合わせて調整できます(標準の MMD モデルの実測値は約 {STANDARD_ARM_DEG}°。変えると、変換し直されます)。
      </p>
      <label className="check">
        <input type="checkbox" checked={auto} onChange={(e) => save(e.target.checked ? null : STANDARD_ARM_DEG)} />
        標準(実測値)を使う
      </label>
      {!auto && (
        <label className="field">
          <span className="field-label">腕の基準の角度: {Math.round(view.armAngleDeg ?? STANDARD_ARM_DEG)}°</span>
          <input
            type="range"
            min={ARM_ANGLE_RANGE.min}
            max={ARM_ANGLE_RANGE.max}
            step={1}
            value={view.armAngleDeg ?? STANDARD_ARM_DEG}
            onChange={(e) => setView({ ...view, armAngleDeg: Number(e.target.value) })}
            onMouseUp={(e) => save(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => save(Number((e.target as HTMLInputElement).value))}
          />
        </label>
      )}
      <p className="muted small">
        VMD の取り込みは、モーションタブの「追加」から。体と表情が別ファイルのときは、同じフォルダ・同じ名前のものを(例: 曲名_body.vmd と 曲名_face.vmd)まとめて選ぶと、1 つのモーションになります。あとから足すときは、モーションタブの「表情 VMD」から。
      </p>
    </div>
  )
}
