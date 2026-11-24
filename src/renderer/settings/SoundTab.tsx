import { useCallback, useEffect, useState } from 'react'
import { MAX_SOUNDS, type Sound, type SePatch, type SeView } from '@shared/sound'
import { Toggle } from './Toggle'

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/** 効果音タブ: 名前をつけた音ファイルを登録する(機能 Mod「効果音」)。ルールのアクション「効果音を鳴らす」で、その名前を使って鳴らす */
export function SoundTab(): React.JSX.Element {
  const [view, setView] = useState<SeView | null>(null)
  const [draftName, setDraftName] = useState('')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void window.vmaid.getSound().then(setView)
    return window.vmaid.onSoundChanged(setView)
  }, [])

  const save = useCallback(async (patch: SePatch): Promise<void> => setView(await window.vmaid.saveSound(patch)), [])

  if (!view) return <p className="muted">読み込み中…</p>

  const setSound = (name: string, patch: Partial<Sound>): Promise<void> => save({ sounds: view.sounds.map((s) => (s.name === name ? { ...s, ...patch } : s)) })

  const addSound = async (): Promise<void> => {
    const name = draftName.trim()
    if (name === '') return setNote('先に、効果音の名前を入力してください')
    if (view.sounds.some((s) => s.name === name)) return setNote('同じ名前の効果音が、すでにあります')
    const path = await window.vmaid.pickAudioFile()
    if (!path) return
    await save({ sounds: [...view.sounds, { name, path, volume: 1 }] })
    setDraftName('')
    setNote(`「${name}」に「${fileName(path)}」を登録しました`)
  }

  const toggle = (
    <label className="check">
      <Toggle checked={view.enabled} label="効果音を使う" onChange={(on) => void window.vmaid.setFeatureMod('se', on)} />
      効果音を使う(公式の機能 Mod「効果音(SE)」)
    </label>
  )

  if (!view.enabled) {
    return (
      <section>
        <h1>効果音</h1>
        <p className="muted">音ファイルを登録して、ルールのアクション「効果音を鳴らす」で、クリックしたとき・時間になったときなどに、鳴らせます。OFF の間は、鳴りません。登録は、ON にすると出ます(保存した設定は残ります)。</p>
        {toggle}
      </section>
    )
  }

  return (
    <section>
      <h1>効果音</h1>
      <p className="muted">
        音に名前をつけて登録します。ルールの「効果音を鳴らす」(アクション)で、その名前を指定すると、鳴ります(重ねて鳴らせます)。音ファイルは、自分で選んでください(VMaid は音を同梱しません。著作権は各自で確認してください)。
        ダンスの BGM は、設定 → Mod の「ダンス」で、楽曲ごとに選びます。
      </p>
      {toggle}

      <label className="field">
        <span className="field-label">全体の音量: {Math.round(view.volume * 100)}%</span>
        <input type="range" min={0} max={1} step={0.05} value={view.volume} onChange={(e) => void save({ volume: Number(e.target.value) })} />
      </label>

      <h2>登録した効果音</h2>
      {view.sounds.length === 0 && <p className="muted">まだ、ありません。下で、名前をつけて、音ファイルを選んでください。</p>}
      {view.sounds.map((s) => (
        <div key={s.name} className="engine-box">
          <div className="row">
            <strong>{s.name}</strong>
            <code className="small">{fileName(s.path)}</code>
            <button
              onClick={() =>
                void window.vmaid.pickAudioFile().then((p) => {
                  if (p) void setSound(s.name, { path: p })
                })
              }
            >
              音を選び直す…
            </button>
            <button onClick={() => window.vmaid.previewAudio({ kind: 'sound', name: s.name })}>試しに鳴らす</button>
            <button onClick={() => void save({ sounds: view.sounds.filter((x) => x.name !== s.name) })}>削除</button>
          </div>
          <label className="row">
            この音の音量 {Math.round(s.volume * 100)}%
            <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => void setSound(s.name, { volume: Number(e.target.value) })} />
          </label>
        </div>
      ))}

      {view.sounds.length < MAX_SOUNDS && (
        <div className="row">
          <input type="text" value={draftName} placeholder="効果音の名前(例: ぴこん)" maxLength={40} onChange={(e) => setDraftName(e.target.value)} />
          <button onClick={() => void addSound()}>音ファイルを選んで、登録…</button>
        </div>
      )}
      {note && <p className="muted small">{note}</p>}
      <p className="muted small">選べる形式: mp3 / wav / ogg / m4a / aac / flac(80MB まで)。音ファイルは、VMaid の中にコピーせず、選んだ場所のものを読みます(動かしたり消したりすると、鳴らなくなります)。</p>
    </section>
  )
}
