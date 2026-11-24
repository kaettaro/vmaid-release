import { useState } from 'react'
import { DEFAULT_CHARACTER } from '@shared/llm/prompt'
import type { CharacterActionResult, CharacterEdit, SettingsView } from '@shared/settingsApi'
import { TextAreaField, TextField } from './fields'

interface Props {
  view: SettingsView
  /** キャラの操作の結果(最新の設定の見え方つき)を画面に反映する */
  onResult: (r: CharacterActionResult) => void
}

/**
 * キャラクタータブ: キャラ(モデルのファイル + 名前・口調・性格)を、複数、保存して切り替える。
 * 切り替えは、右クリックメニューの「キャラを切り替え」からもできる。話し方・会話履歴・ルールの「対象キャラ」は、キャラごと。
 */
export function CharacterTab({ view, onResult }: Props): React.JSX.Element {
  const [selected, setSelected] = useState(view.activeCharacterId)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const current = view.characters.find((c) => c.id === selected) ?? view.characters.find((c) => c.id === view.activeCharacterId) ?? view.characters[0]

  const run = async (fn: () => Promise<CharacterActionResult>, after?: (r: CharacterActionResult) => void): Promise<void> => {
    const r = await fn()
    onResult(r)
    setNote(r.message ? { ok: r.ok, text: r.message } : null)
    after?.(r)
  }
  const edit = (patch: CharacterEdit): Promise<void> => run(() => window.vmaid.editCharacter(current.id, patch))

  return (
    <section>
      <h1>キャラクター</h1>
      <p className="muted">
        モデル(VRM)と、名前・口調・性格をセットにして、複数のキャラを保存できます。切り替えは、キャラの右クリックメニュー「キャラを切り替え」からも行えます。
        会話の履歴と、話し方は、キャラごとに分かれます。ルールは、「ルール」タブで、キャラごとに動くかどうかを選べます。
      </p>

      <h2>キャラの一覧</h2>
      <ul className="motion-list">
        {view.characters.map((c) => (
          <li key={c.id}>
            <label className="radio-line">
              <input type="radio" name="char" checked={c.id === current.id} onChange={() => setSelected(c.id)} />
              <strong>{c.name}</strong>
              {c.id === view.activeCharacterId && <span className="badge">使用中</span>}
              {c.modelPath === null && <span className="badge warn">モデル未設定</span>}
              {c.modelMissing && <span className="badge warn">モデルのファイルが見つかりません</span>}
            </label>
            {c.id !== view.activeCharacterId && <button onClick={() => void run(() => window.vmaid.switchCharacter(c.id))}>このキャラに切り替え</button>}
          </li>
        ))}
      </ul>
      {view.characters.some((c) => c.id === view.activeCharacterId && c.modelPath === null) && (
        <div className="notice warn" role="status">
          <strong>キャラのモデルが、まだ登録されていません。</strong>
          下の「モデルを選んで、キャラとして追加…」で、VRM(または、MMD 対応 Mod が ON なら PMX)のファイルを選んでください。モデルは、アプリに同梱していません(ご自分で用意したものを使います)。
        </div>
      )}
      <div className="row">
        <button className="primary" onClick={() => void run(() => window.vmaid.addCharacter(), (r) => r.ok && setSelected(r.view.activeCharacterId))}>
          モデルを選んで、キャラとして追加…
        </button>
        <button onClick={() => void run(() => window.vmaid.duplicateCharacter(current.id))}>複製</button>
        <button className="danger" disabled={view.characters.length <= 1} onClick={() => void run(() => window.vmaid.removeCharacter(current.id))}>
          削除
        </button>
      </div>
      {note && <p className={note.ok ? 'ok small' : 'ng small'}>{note.text}</p>}

      <h2>「{current.name}」の設定</h2>
      <div>
        <div className="muted small">モデル</div>
        <div className="row">
          <code className="motion-path" title={current.modelPath ?? ''}>
            {current.modelPath ?? '(未設定)'}
          </code>
          <button onClick={() => void run(() => window.vmaid.changeCharacterModel(current.id))}>モデルを変更…</button>
        </div>
      </div>
      {/* キャラを切り替えたとき、入力欄の内容も入れ替わるように、キャラごとに作り直す */}
      <div key={current.id}>
        <TextField label="名前" value={current.name} onCommit={(v) => void edit({ name: v })} />
        <TextField
          label="ユーザーの呼び方"
          value={current.userCallName}
          hint="キャラがあなたを呼ぶときの呼び方(例: ご主人、先輩、○○さん)"
          onCommit={(v) => void edit({ userCallName: v })}
        />
        <TextField
          label="口調"
          value={current.tone}
          hint="例: やさしく、くだけた丁寧語 / 元気なタメ口 / 関西弁"
          onCommit={(v) => void edit({ tone: v })}
        />
        <TextAreaField
          label="性格・設定(システムプロンプト)"
          value={current.systemPrompt}
          rows={7}
          hint="性格、好きなもの、背景などを自由に書けます。変更は次の発話から反映されます。"
          onCommit={(v) => void edit({ systemPrompt: v })}
        />
        <div className="row">
          <button
            onClick={() => void edit({ tone: DEFAULT_CHARACTER.tone, systemPrompt: DEFAULT_CHARACTER.systemPrompt, userCallName: DEFAULT_CHARACTER.userCallName })}
          >
            口調・性格を既定に戻す
          </button>
        </div>
      </div>
    </section>
  )
}
