import { useEffect, useState } from 'react'
import type { BasicPatch, BasicView } from '@shared/basic'
import { DEFAULT_RESET_SHORTCUT } from '@shared/basic'
import { Toggle } from './Toggle'

/** 基本設定タブ: 本体の基本項目(Mod ではない)。倍率・クリック透過・最前面・起動時の表示と、緊急リセット */
export function BasicTab(): React.JSX.Element {
  const [view, setView] = useState<BasicView | null>(null)
  const [error, setError] = useState('')
  const [shortcut, setShortcut] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    void window.vmaid.getBasic().then((v) => {
      setView(v)
      setShortcut(v.resetShortcut)
    })
    return window.vmaid.onBasicChanged(setView) // メニュー・ホイール・リセットでの変更も、反映する
  }, [])

  const apply = async (patch: BasicPatch): Promise<void> => {
    const r = await window.vmaid.setBasic(patch)
    setView(r.view)
    setShortcut(r.view.resetShortcut)
    setError(r.error)
  }

  if (!view) return <p className="muted">読み込み中…</p>
  return (
    <section>
      <h1>基本設定</h1>
      <p className="muted">本体の基本の設定です(Mod の設定は、「Mod」タブにあります)。</p>

      <label className="field">
        <span className="field-label">大きさ: {Math.round(view.scale * 100)}%</span>
        <input type="range" min={0.3} max={3} step={0.05} value={view.scale} onChange={(e) => void apply({ scale: Number(e.target.value) })} />
        <span className="field-hint">キャラの上でマウスのホイールを回しても、変えられます。</span>
      </label>
      <label className="check">
        <Toggle checked={view.clickThrough} label="クリック透過" onChange={(on) => void apply({ clickThrough: on })} />
        クリック透過: キャラのいない場所のクリックを、下のアプリに通す
      </label>
      <label className="check">
        <Toggle checked={view.alwaysOnTop} label="最前面" onChange={(on) => void apply({ alwaysOnTop: on })} />
        いつも最前面に表示する
      </label>
      <label className="check">
        <Toggle checked={view.showOnStartup} label="起動時に表示" onChange={(on) => void apply({ showOnStartup: on })} />
        起動したとき、キャラを表示する
      </label>

      <h2>モーション再生ウィンドウ</h2>
      <label className="check">
        <Toggle checked={view.previewInWindow} label="ウィンドウの中にもキャラを出す" onChange={(on) => void apply({ previewInWindow: on })} />
        再生ウィンドウの中に、確認用のキャラを出す(ON のときは、ウィンドウの中のキャラで再生し、画面のキャラは動きません)
      </label>
      <p className="muted small">OFF(既定)では、再生ウィンドウで選んだモーションを、画面のキャラが直接再生します(キャラが 2 人に増えないので、雰囲気を保てます)。</p>

      <h2>緊急リセット</h2>
      <p className="muted">
        キャラが消えた・画面の外に出た・非表示にして戻せない、などで困ったときに、キャラを<strong>初期の表示</strong>(表示・主画面の右下・大きさ 100%・クリック透過 OFF)に戻します。
        向き・再生中のモーション・ルールの効果(状態・小道具・画面効果・ゲーム)・重ねた表情・衣装セットも、初期に戻します。保存した設定と、Mod の ON/OFF は、変わりません。
        トレイアイコンや、キャラの右クリックメニューの「キャラを初期状態に戻す」からも、使えます。
      </p>
      <div className="row">
        <button className="danger" onClick={() => window.vmaid.resetCharacter()}>
          いますぐ、初期状態に戻す…
        </button>
        <button disabled={!view.canUndoReset} onClick={() => window.vmaid.undoResetCharacter()} title="直前のリセットを取り消して、位置・大きさ・クリック透過・向き・重ねた表情・衣装セットを、リセット前に戻します">
          リセット前の状態に戻す
        </button>
      </div>
      <label className="check">
        <Toggle checked={view.confirmReset} label="リセットの前に確認する" onChange={(on) => void apply({ confirmReset: on })} />
        リセットの前に、確認のダイアログを出す
      </label>
      <label className="field">
        <span className="field-label">リセットのショートカット(どのアプリを使っていても、効きます)</span>
        <span className="row">
          <input type="text" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder={DEFAULT_RESET_SHORTCUT} style={{ width: '20em' }} />
          <button disabled={shortcut.trim() === view.resetShortcut} onClick={() => void apply({ resetShortcut: shortcut }).then(() => setDone('ショートカットを変更しました'))}>
            変更
          </button>
          <button onClick={() => void apply({ resetShortcut: DEFAULT_RESET_SHORTCUT })}>既定に戻す</button>
        </span>
        <span className="field-hint">
          例: CommandOrControl+Alt+Shift+R(Ctrl・Alt・Shift・Command を組み合わせます)。
          {view.resetShortcutOk ? ' いまのショートカットは、登録できています。' : ' いまのショートカットは、ほかのアプリが使っているため、登録できていません(別の組み合わせにするか、トレイのメニューを使ってください)。'}
        </span>
      </label>
      {error && <div className="notice error" role="alert">{error}</div>}
      {!error && done && <p className="ok small">{done}</p>}
    </section>
  )
}
