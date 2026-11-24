import { useEffect, useRef, useState } from 'react'
import type { CharacterActionResult, SettingsPatch, SettingsView } from '@shared/settingsApi'
import type { SpeakerStyle } from '@shared/tts/voicevox'
import type { ModsView } from '@shared/modsApi'
import { VOICE_LIMITS } from '@shared/tts/voicevox'
import { TextField } from './fields'
import { Toggle } from './Toggle'

interface Props {
  view: SettingsView
  update: (patch: SettingsPatch) => Promise<void>
  onResult: (r: CharacterActionResult) => void
}

const SAMPLE = 'こんにちは。今日もいい天気ですね。'

/** 音声タブ: キャラに声を出させる(既定オフ)。OSの音声か、VOICEVOX 互換のローカルエンジンを選ぶ */
export function VoiceTab({ view, update, onResult }: Props): React.JSX.Element {
  const t = view.tts
  const active = view.characters.find((c) => c.id === view.activeCharacterId) ?? view.characters[0]
  const [speakers, setSpeakers] = useState<SpeakerStyle[]>([])
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([])
  const playing = useRef<{ stop: () => void } | null>(null)
  // 音声合成は、公式の機能 Mod「音声合成」(tts)。このタブのチェックが、Mod の ON/OFF そのもの
  const [modOn, setModOn] = useState<boolean | null>(null)
  useEffect(() => {
    const pick = (v: ModsView): void => setModOn(v.features.some((f) => f.id === 'tts' && f.enabled))
    void window.vmaid.getMods().then(pick)
    return window.vmaid.onModsChanged(pick)
  }, [])

  // OS の音声の一覧(読み込みが遅れることがあるので、変更の通知も受ける)
  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth) return
    const load = (): void => setSystemVoices(synth.getVoices())
    load()
    synth.addEventListener('voiceschanged', load)
    return () => synth.removeEventListener('voiceschanged', load)
  }, [])
  useEffect(() => () => playing.current?.stop(), [])

  const editVoice = async (voice: Partial<typeof active.voice>): Promise<void> => {
    onResult(await window.vmaid.editCharacter(active.id, { voice }))
  }

  const loadSpeakers = async (): Promise<void> => {
    setNote({ ok: true, text: '接続しています…' })
    const r = await window.vmaid.ttsSpeakers()
    setSpeakers(r.speakers)
    setNote({ ok: r.ok, text: r.message })
  }

  const preview = async (): Promise<void> => {
    playing.current?.stop()
    if (t.backend === 'system') {
      const synth = window.speechSynthesis
      if (!synth) return setNote({ ok: false, text: 'この環境では、OSの音声が使えません' })
      synth.cancel()
      const u = new SpeechSynthesisUtterance(SAMPLE)
      u.lang = 'ja-JP'
      const voice = active.voice.systemVoice ? systemVoices.find((v) => v.name === active.voice.systemVoice) : systemVoices.find((v) => v.lang.toLowerCase().startsWith('ja'))
      if (voice) u.voice = voice
      u.rate = active.voice.speed
      u.pitch = Math.min(2, Math.max(0, 1 + active.voice.pitch * 3.3))
      u.volume = t.volume
      playing.current = { stop: () => synth.cancel() }
      synth.speak(u)
      setNote(voice ? { ok: true, text: `「${voice.name}」で読み上げます` } : { ok: false, text: '日本語の音声が見つかりません。OSの設定で、日本語の音声を追加してください(未確認の環境があります)' })
      return
    }
    setNote({ ok: true, text: '合成しています…' })
    const r = await window.vmaid.ttsSynthesize(SAMPLE)
    if (!r.ok) return setNote({ ok: false, text: r.message })
    if (!r.wav) return setNote({ ok: false, text: '読み上げる内容がありません' })
    const ctx = new AudioContext()
    const buf = await ctx.decodeAudioData(r.wav.slice().buffer)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.onended = () => void ctx.close()
    playing.current = { stop: () => { try { src.stop() } catch { /* すでに止まっている */ } } }
    src.start()
    setNote({ ok: true, text: '再生しています' })
  }

  const jaVoices = systemVoices.filter((v) => v.lang.toLowerCase().startsWith('ja'))

  if (modOn === null) return <p className="muted">読み込み中…</p>
  const toggle = (
    <label className="check">
      <Toggle checked={modOn} label="キャラに声を出させる" onChange={(on) => void window.vmaid.setFeatureMod('tts', on)} />
      キャラに声を出させる(公式の機能 Mod「音声合成」)
    </label>
  )
  if (!modOn) {
    return (
      <section>
        <h1>音声</h1>
        <p className="muted">キャラが、返答を声に出します。OFF の間は、声を出さず、音声合成のエンジンへの通信もしません。声の設定は、ON にすると出ます(保存した設定は残ります)。</p>
        {toggle}
      </section>
    )
  }

  return (
    <section>
      <h1>音声</h1>
      <p className="muted">
        キャラが、返答を声に出します(既定はオフ)。声は、キャラごとに選べます。音声合成は、すべてこのPCの中(OSの音声、または、あなたが起動した VOICEVOX 互換のエンジン)で行います。
      </p>

      {toggle}

      <h2>方式</h2>
      <div className="radio-group">
        <label className="radio-line">
          <input type="radio" name="tts-backend" checked={t.backend === 'system'} onChange={() => void update({ tts: { backend: 'system' } })} />
          <span>
            <strong>OSの音声</strong>
            <br />
            <span className="muted small">追加の準備は不要。日本語の音声が、OSに入っている必要があります(Windows での動作は未確認)</span>
          </span>
        </label>
        <label className="radio-line">
          <input type="radio" name="tts-backend" checked={t.backend === 'voicevox'} onChange={() => void update({ tts: { backend: 'voicevox' } })} />
          <span>
            <strong>VOICEVOX 互換のエンジン</strong>
            <br />
            <span className="muted small">VOICEVOX などを、あなたが別に入れて起動します(VMaid は同梱しません)。声ごとの利用規約は、各自で確認してください。配信・動画での公開など、音声を公に使うときは、エンジン・話者の規約が定めるクレジット表記などが必要な場合があります</span>
          </span>
        </label>
      </div>

      {t.backend === 'voicevox' && (
        <>
          <TextField
            label="エンジンの接続先"
            value={t.endpoint}
            hint="VOICEVOX の既定は http://127.0.0.1:50021 です。会話の文が、ここへ送られます。"
            onCommit={(v) => void update({ tts: { endpoint: v } })}
          />
          <div className="engine-box">
            <label className="check">
              <Toggle checked={t.autoStart} label="VOICEVOX を自動で起動する" onChange={(on) => void update({ tts: { autoStart: on } })} />
              VOICEVOX を、必要なときに、自動で起動する
            </label>
            <p className="muted small">
              VMaid の起動時と、読み上げの前に、エンジンに接続できなければ、下で選んだ実行ファイルを起動します(VMaid を終了すると、VMaid が起動したエンジンは止まります)。
              <strong>接続先が自分のPC(127.0.0.1 / localhost)のときだけ</strong>使えます。VMaid は、VOICEVOX を同梱しません。
            </p>
            <div className="row">
              <code className="small">{t.enginePath ?? '(未選択)'}</code>
              <button
                onClick={() =>
                  void window.vmaid.pickTtsEngine().then(async (p) => {
                    if (p) setNote({ ok: true, text: `エンジンに、${p} を選びました` })
                    onResult({ ok: true, message: '', view: await window.vmaid.getSettings() })
                  })
                }
              >
                エンジンを選ぶ…
              </button>
              <button
                disabled={!t.autoStart || !t.enginePath}
                onClick={() => {
                  setNote({ ok: true, text: 'エンジンを起動しています…(最大 60 秒)' })
                  void window.vmaid.startTtsEngine().then((r) => setNote({ ok: r.ok, text: r.message }))
                }}
              >
                いま起動してみる
              </button>
            </div>
            <p className="muted small">選ぶもの: Windows は VOICEVOX.exe(またはエンジンの run.exe)、macOS は VOICEVOX.app。</p>
          </div>
          {!t.endpointIsLoopback && (
            <div className="notice error" role="alert">
              この接続先は、あなたのPCの外(または別の名前)です。読み上げる文(会話の内容)が、外部に送られる可能性があります。信頼できる接続先だけを指定してください。
            </div>
          )}
          <div className="row">
            <button onClick={() => void loadSpeakers()}>接続して、声の一覧を取得</button>
          </div>
        </>
      )}

      <h2>「{active.name}」の声</h2>
      {t.backend === 'voicevox' ? (
        <label className="field">
          <span className="field-label">声(話者)</span>
          <select value={active.voice.speaker ?? ''} onChange={(e) => void editVoice({ speaker: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">(未選択)</option>
            {active.voice.speaker !== null && !speakers.some((s) => s.id === active.voice.speaker) && <option value={active.voice.speaker}>ID {active.voice.speaker}</option>}
            {speakers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="field-hint">「接続して、声の一覧を取得」を押すと、選べるようになります。</span>
        </label>
      ) : (
        <label className="field">
          <span className="field-label">声</span>
          <select value={active.voice.systemVoice ?? ''} onChange={(e) => void editVoice({ systemVoice: e.target.value === '' ? null : e.target.value })}>
            <option value="">(OSの既定の日本語)</option>
            {jaVoices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
                {v.localService ? '' : '(ネットワークの音声)'}
              </option>
            ))}
          </select>
          {jaVoices.length === 0 && <span className="field-hint">日本語の音声が見つかりません(OSの設定で追加できる場合があります)。</span>}
        </label>
      )}

      <label className="field">
        <span className="field-label">話す速さ: {active.voice.speed.toFixed(2)}</span>
        <input type="range" min={VOICE_LIMITS.speed.min} max={VOICE_LIMITS.speed.max} step={0.05} value={active.voice.speed} onChange={(e) => void editVoice({ speed: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span className="field-label">声の高さ: {active.voice.pitch.toFixed(2)}</span>
        <input type="range" min={VOICE_LIMITS.pitch.min} max={VOICE_LIMITS.pitch.max} step={0.01} value={active.voice.pitch} onChange={(e) => void editVoice({ pitch: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span className="field-label">音量: {Math.round(t.volume * 100)}%</span>
        <input type="range" min={0} max={1} step={0.05} value={t.volume} onChange={(e) => void update({ tts: { volume: Number(e.target.value) } })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={t.speakSay} onChange={(e) => void update({ tts: { speakSay: e.target.checked } })} />
        ルールの「セリフを言う」も、声に出す
      </label>

      <div className="row">
        <button className="primary" onClick={() => void preview()}>
          試し聞き
        </button>
        <button onClick={() => playing.current?.stop()}>止める</button>
      </div>
      {note && <p className={note.ok ? 'ok small' : 'ng small'}>{note.text}</p>}
      <p className="muted small">変更は、次の読み上げから反映されます。口の動きは、声の大きさに合わせて動きます(OSの音声は、声が出ている間だけ動きます)。</p>
    </section>
  )
}
