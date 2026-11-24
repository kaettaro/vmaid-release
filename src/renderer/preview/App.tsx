import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VrmStage } from '../character/vrmStage'
import type { CharacterStage } from '../character/stage'
import type { MotionState } from '@shared/ipc'
import { playableMotions } from '@shared/motions/playable'
import { formatPlayback, progressRatio, type PlaybackInfo } from '@shared/motions/playback'

/** ループで流すときの長さ(秒)。止めるには、別のモーションを再生するか、停止を押す */
const LOOP_SEC = 3600
/** 一覧に出す件数の上限(数千件あっても重くならないように。検索で絞る) */
const LIST_LIMIT = 300

/**
 * モーション再生ウィンドウ(操作用)。一覧から選ぶと、**キャラ本体が**そのモーションを再生する(キャラが 2 人に増えない)。
 * 各モーションの、タグと、割り当て済みのルール(そのモーションを再生するルールの id)も見られる。
 * 基本設定の「このウィンドウの中にもキャラを出す」が ON のときだけ、本体ではなく、このウィンドウの中のキャラで再生する(読み取りだけ。キャラの状態は触らない)。
 */
export function App(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<CharacterStage | null>(null)
  const loadedRef = useRef(false)
  const nameRef = useRef<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [loop, setLoop] = useState(false)
  const loopRef = useRef(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [motions, setMotions] = useState<MotionState | null>(null)
  const [kind, setKind] = useState<'vrm' | 'pmx' | null>(null)
  const [refs, setRefs] = useState<Record<string, string[]>>({})
  /** 基本設定: ウィンドウの中にもキャラを出すか(出すなら、そちらで再生する) */
  const [inWindow, setInWindow] = useState(false)
  const inWindowRef = useRef(false)
  const [stageReady, setStageReady] = useState(false)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  /** 再生中のモーションの状態(進み具合の表示用)。キャラ本体で再生しているときは、main から届く */
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null)
  /** バーをつまんでいる間の位置(つまんでいる間は、届いた位置で、バーを動かさない) */
  const [scrub, setScrub] = useState<number | null>(null)

  const loadMeta = useCallback(async (): Promise<void> => {
    const [state, file, r] = await Promise.all([window.vmaid.getMotions(), window.vmaid.getLastModel(), window.vmaid.getMotionRefs()])
    setMotions(state)
    setKind(file ? file.kind : null)
    setRefs(r)
  }, [])

  // 基本設定(ウィンドウの中にもキャラを出すか)は、ウィンドウに戻ってきたときにも読み直す
  const syncBasic = useCallback(async (): Promise<boolean> => {
    const b = await window.vmaid.getBasic()
    inWindowRef.current = b.previewInWindow
    setInWindow(b.previewInWindow)
    return b.previewInWindow
  }, [])

  const play = useCallback(
    async (n: string): Promise<void> => {
      nameRef.current = n
      setName(n)
      const useWindow = await syncBasic()
      if (!useWindow) {
        setMessage(null)
        window.vmaid.previewMotion(n, { loop: loopRef.current })
        return
      }
      const stage = stageRef.current
      if (!loadedRef.current || !stage) return // 読み込みが終わったら、最後の要求を再生する
      if (!stage.hasMotion(n)) {
        setMessage({ text: `このモデルでは再生できないモーションです: ${n}`, error: true })
        return
      }
      setMessage(null)
      stage.playMotion(n, { interrupt: true, ...(loopRef.current ? { durationSec: LOOP_SEC } : {}) })
    },
    [syncBasic]
  )

  const stop = useCallback((): void => {
    if (inWindowRef.current) stageRef.current?.stopMotion()
    else window.vmaid.stopMotionPreview()
  }, [])

  const seek = useCallback((sec: number): void => {
    if (inWindowRef.current) stageRef.current?.seek(sec)
    else window.vmaid.seekMotion(sec)
  }, [])

  const pause = useCallback((paused: boolean): void => {
    if (inWindowRef.current) stageRef.current?.setPaused(paused)
    else window.vmaid.setMotionPaused(paused)
    setPlayback((p) => (p ? { ...p, paused } : p))
  }, [])

  /** 再生先(キャラ本体 / このウィンドウの中)を切り替える。基本設定の「ウィンドウの中にもキャラを出す」と、同じ値 */
  const chooseTarget = useCallback(
    async (inside: boolean): Promise<void> => {
      await window.vmaid.setBasic({ previewInWindow: inside })
      await syncBasic()
      setPlayback(null)
    },
    [syncBasic]
  )

  // 起動: 一覧の材料を取り、再生の要求(ほかの窓からの「この名前を再生」)を受ける。ウィンドウに戻ってきたときにも、読み直す
  useEffect(() => {
    const reload = (): void => {
      void syncBasic()
      void loadMeta()
    }
    const first = setTimeout(reload, 0)
    const off = window.vmaid.onPreviewPlay((n) => void play(n))
    // キャラ本体で再生しているときの、再生の状態(窓の中のキャラで再生しているときは、下の定期的な読み取りで上書きされる)
    const offProgress = window.vmaid.onMotionProgress((p) => {
      if (!inWindowRef.current) setPlayback(p)
    })
    window.vmaid.previewReady()
    window.addEventListener('focus', reload)
    return () => {
      clearTimeout(first)
      off()
      offProgress()
      window.removeEventListener('focus', reload)
    }
  }, [loadMeta, syncBasic, play])

  // 「ウィンドウの中にもキャラを出す」が ON のときだけ、キャラ(自前のステージ)を読み込む。OFF になったら、捨てる
  useEffect(() => {
    if (!inWindow) return
    let disposed = false
    let stage: CharacterStage | null = null
    void (async () => {
      try {
        setMessage({ text: 'モデルを読み込み中…', error: false })
        const file = await window.vmaid.getLastModel()
        if (!file) {
          setMessage({ text: 'キャラのモデルが選ばれていません。設定 →「キャラクター」でモデルを登録してください', error: true })
          return
        }
        if (file.kind === 'pmx') {
          const { MmdStage } = await import('../character/mmdStage')
          stage = new MmdStage(canvasRef.current!)
        } else stage = new VrmStage(canvasRef.current!)
        if (disposed) {
          stage.dispose()
          return
        }
        stage.motionLoader = (n) => window.vmaid.getMotionData(n, { vrm: file.kind !== 'pmx' })
        stage.onMotionError = (n) => setMessage({ text: `モーションを読み込めませんでした: ${n}`, error: true })
        const state = await window.vmaid.getMotions()
        stage.setMotions(state)
        // モデルごとの表情・衣装の保存値は、読み取りだけ(読み込み後の項目一覧は、表情・衣装パネルへ届けない)
        const profile = await window.vmaid.getProfile(file.hash)
        await stage.loadFile(file, profile)
        if (disposed) {
          stage.dispose()
          return
        }
        stageRef.current = stage
        loadedRef.current = true
        setStageReady(true)
        setMessage(null)
        if (nameRef.current) void play(nameRef.current)
      } catch (e) {
        setMessage({ text: `読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`, error: true })
      }
    })()
    return () => {
      disposed = true
      stage?.dispose()
      stageRef.current = null
      loadedRef.current = false
      setStageReady(false)
    }
  }, [inWindow, play])

  // 窓の中のキャラで再生しているときは、そのステージの再生の状態を、約 0.1 秒ごとに読む
  useEffect(() => {
    if (!inWindow) return
    const timer = setInterval(() => setPlayback(stageRef.current?.getPlayback() ?? null), 100)
    return () => clearInterval(timer)
  }, [inWindow])

  // このモデルで再生できるモーションだけを出す(PMX なら VMD と内蔵、VRM なら VRMA と内蔵)
  const playable = useMemo(() => (motions ? (kind ? playableMotions(kind, motions) : motions.names) : []), [motions, kind])
  const tags = useMemo(() => {
    const count = new Map<string, number>()
    for (const n of playable) for (const t of motions?.tags[n] ?? []) count.set(t, (count.get(t) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1])
  }, [playable, motions])
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return playable.filter((n) => {
      if (tag !== '' && !(motions?.tags[n] ?? []).includes(tag)) return false
      const hay = `${n} ${(motions?.tags[n] ?? []).join(' ')} ${(refs[n] ?? []).join(' ')}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [playable, motions, refs, query, tag])

  const step = (delta: 1 | -1): void => {
    if (shown.length === 0) return
    const i = name ? shown.indexOf(name) : -1
    const next = shown[Math.min(shown.length - 1, Math.max(0, i < 0 ? 0 : i + delta))]
    if (next) void play(next)
  }

  return (
    <div className="preview">
      <aside className={inWindow ? 'side' : 'side wide'}>
        <div className="bar">
          <span className={name ? 'name' : 'name none'} title={name ?? ''}>
            {name ?? 'モーションを選んでください'}
          </span>
          <label className="check">
            <input type="checkbox" checked={loop} onChange={(e) => ((loopRef.current = e.target.checked), setLoop(e.target.checked))} />
            ループ
          </label>
          <button disabled={!name} onClick={() => name && void play(name)}>
            もう一度
          </button>
          <button onClick={stop}>停止</button>
        </div>
        <div className="where" role="radiogroup" aria-label="再生先">
          <span>再生先:</span>
          <label>
            <input type="radio" name="target" checked={!inWindow} onChange={() => void chooseTarget(false)} />
            キャラ本体(画面のキャラが動く)
          </label>
          <label>
            <input type="radio" name="target" checked={inWindow} onChange={() => void chooseTarget(true)} />
            このウィンドウの中のキャラ
          </label>
        </div>
        <div className="progress" aria-label="再生の進み具合">
          {playback ? (
            <>
              <input
                type="range"
                min={0}
                max={playback.duration}
                step={0.01}
                value={scrub ?? Math.min(playback.time, playback.duration)}
                aria-label="再生の位置"
                onChange={(e) => {
                  setScrub(Number(e.target.value))
                  seek(Number(e.target.value))
                }}
                onPointerUp={() => setScrub(null)}
                style={{ ['--ratio' as string]: `${Math.round(progressRatio({ time: scrub ?? playback.time, duration: playback.duration }) * 100)}%` }}
              />
              <span className="time">{formatPlayback({ time: scrub ?? playback.time, duration: playback.duration })}</span>
              <button onClick={() => pause(!playback.paused)}>{playback.paused ? '▶ 再開' : '⏸ 一時停止'}</button>
              {playback.looping && <span className="loopmark">ループ中</span>}
            </>
          ) : (
            <span className="muted">再生していません</span>
          )}
        </div>
        {playback && <div className="note">曲(BGM)は、位置を動かしても、いっしょには動きません。</div>}
        <input
          className="search"
          type="search"
          placeholder="モーション名・タグ・ルールの id で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              step(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              step(-1)
            }
          }}
        />
        {tags.length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="タグで絞り込む">
            <option value="">すべてのタグ</option>
            {tags.map(([t, c]) => (
              <option key={t} value={t}>
                {t}({c}件)
              </option>
            ))}
          </select>
        )}
        <div className="count">{motions ? `${shown.length}件${shown.length > LIST_LIMIT ? `(先頭の ${LIST_LIMIT}件を表示。検索で絞ってください)` : ''}` : '読み込み中…'}</div>
        <ul className="list">
          {shown.slice(0, LIST_LIMIT).map((n) => {
            const rs = refs[n] ?? []
            return (
              <li key={n} className={n === name ? 'row active' : 'row'}>
                <button className="play" aria-label={`${n} を再生`} title="再生" onClick={() => void play(n)}>
                  ▶
                </button>
                <div className="info">
                  <div className="nm" title={n}>
                    {n}
                  </div>
                  {(motions?.tags[n] ?? []).length > 0 && (
                    <div className="chips">
                      {(motions?.tags[n] ?? []).map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="rules" title={rs.join('\n')}>
                    {rs.length === 0 ? 'ルール: なし' : `ルール: ${rs.slice(0, 3).join(', ')}${rs.length > 3 ? ` ほか ${rs.length - 3} 件` : ''}`}
                  </div>
                </div>
              </li>
            )
          })}
          {motions && shown.length === 0 && <li className="none">該当するモーションがありません</li>}
        </ul>
      </aside>
      {inWindow && (
        <main className="main">
          <div className="stage">
            <canvas ref={canvasRef} className="canvas" />
            {message && <div className={message.error ? 'msg error' : 'msg'}>{message.text}</div>}
            {!stageReady && !message && <div className="msg">準備中…</div>}
          </div>
        </main>
      )}
      {!inWindow && message && <div className={message.error ? 'msg error floating' : 'msg floating'}>{message.text}</div>}
    </div>
  )
}
