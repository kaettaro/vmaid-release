import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { INPUT_IDLE_CLOSE_MS, shouldAutoCloseInput } from '@shared/chat/bubble'
import { defaultPlacementOptions, placeUserBubble, type UserBubblePlacement } from '@shared/chat/placement'
import { resolveBubbleStyle, type BubbleView } from '@shared/bubble'
import type { ChatState } from './useChat'

interface Props {
  /** UI全体の縮小率(ウィンドウが小さいとき) */
  uiScale: number
  state: ChatState
  /** 吹き出し拡張の設定(Mod が OFF・未取得なら、ふつうの見た目) */
  bubble?: BubbleView | null
  characterId?: string
  onSubmit: (text: string) => void
  onCloseInput: () => void
  onAbort: () => void
}

/**
 * キャラの頭上に「キャラのセリフ」、キャラの横に「自分の入力欄」を出す吹き出し。
 * クリック透過の当たり判定に含めるため、吹き出しの要素には data-ui を付ける(App.tsx が参照)。
 */
export function ChatBubble({ uiScale, state, bubble, characterId = '', onSubmit, onCloseInput, onAbort }: Props): React.JSX.Element {
  const { inputOpen, lastUser, reply, status, error, prep } = state
  const showCharacter = status !== 'idle' || reply !== ''
  const showUser = inputOpen || lastUser !== null
  const active = bubble && bubble.enabled ? bubble : null
  const mine = active ? resolveBubbleStyle({ settings: active, characterId, side: 'character', emotion: state.emotion, text: reply }) : null
  const yours = active ? resolveBubbleStyle({ settings: active, characterId, side: 'user' }) : null

  return (
    <>
      {showCharacter && (
        <div
          className={`bubble bubble-character${status === 'error' ? ' is-error' : ''}`}
          data-ui
          data-shape={mine?.shape}
          data-shake={mine?.shake ? '' : undefined}
          style={mine?.css as React.CSSProperties | undefined}
        >
          <div className="bubble-scroll">
            {status === 'error' ? (
              <>
                {error}
                {!error?.includes('一時的') && (
                  <button className="link" onClick={() => window.vmaid.openSettings()}>
                    設定を開く
                  </button>
                )}
              </>
            ) : reply === '' && prep && prep.phase !== 'loading' ? (
              // 初回だけ、AIモデルのダウンロード中の表示(それ以外は文字を出さず「…」だけ)
              <span className="muted">
                {prep.phase === 'downloading' ? `AIモデルを準備しています… ${Math.round(prep.fraction * 100)}%` : 'AIモデルを確認しています…'}
              </span>
            ) : reply === '' ? (
              <span className="dots" aria-label="考え中">
                <i />
                <i />
                <i />
              </span>
            ) : (
              reply
            )}
          </div>
        </div>
      )}
      {showUser && (
        <UserBubble uiScale={uiScale} shape={yours?.shape} css={yours?.css}>
          {inputOpen ? (
            <>
              {lastUser !== null && <div className="sent-prev">{lastUser}</div>}
              <Input status={status} onSubmit={onSubmit} onClose={onCloseInput} />
            </>
          ) : (
            <div className="bubble-scroll sent">{lastUser}</div>
          )}
        </UserBubble>
      )}
      {(status === 'waiting' || status === 'streaming') && (
        <button className="stop" data-ui onClick={onAbort} aria-label="返答を止める" title="返答を止める (Esc)">
          <span aria-hidden />
        </button>
      )}
    </>
  )
}

/** 画面中央下(=自分のいる側)の座標。ウィンドウがあるディスプレイの作業領域の下端中央 */
function screenBottomCenter(): { x: number; y: number } {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number }
  return { x: (s.availLeft ?? 0) + s.availWidth / 2, y: (s.availTop ?? 0) + s.availHeight }
}

/**
 * 自分の吹き出し。キャラと「画面中央下」を結ぶ線上のキャラの近くに置き、しっぽは画面中央下を指す
 * (自分が画面の手前から話しかけているように見える)。ウィンドウの移動・拡大縮小に追従する。
 */
function UserBubble({ uiScale, shape, css, children }: { uiScale: number; shape?: string; css?: Record<string, string>; children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<UserBubblePlacement | null>(null)

  useLayoutEffect(() => {
    let raf = 0
    let last = ''
    const tick = (): void => {
      const el = ref.current
      if (el) {
        const bubble = { w: el.offsetWidth, h: el.offsetHeight }
        const p = placeUserBubble(
          { w: window.innerWidth, h: window.innerHeight },
          { x: window.screenX, y: window.screenY },
          screenBottomCenter(),
          bubble,
          {
            ...defaultPlacementOptions,
            tailLength: defaultPlacementOptions.tailLength * uiScale,
            tailInset: defaultPlacementOptions.tailInset * uiScale,
            tailHalfBase: defaultPlacementOptions.tailHalfBase * uiScale
          }
        )
        // 位置が動いたときだけ更新する(毎フレームの再描画を避ける)
        const key = [p.left, p.top, p.tail.left, p.tail.top, ...p.tail.points.flatMap((q) => [q.x, q.y])].map((v) => Math.round(v)).join(',')
        if (key !== last) {
          last = key
          setPlace(p)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [uiScale])

  return (
    <div
      ref={ref}
      className="bubble bubble-user"
      data-ui
      data-shape={shape}
      // 最初の計測が終わるまでは見せない(左上に一瞬出るのを避ける)
      style={{ ...(css as React.CSSProperties | undefined), ...(place ? { left: place.left, top: place.top } : { visibility: 'hidden' }) }}
    >
      {children}
      {place && (
        <span
          className="tail"
          // 三角形は3点の多角形(clip-path)。底辺は吹き出しの内側に潜らせてあり、見える辺は2辺だけになる
          style={{
            left: place.tail.left,
            top: place.tail.top,
            width: place.tail.width,
            height: place.tail.height,
            clipPath: `polygon(${place.tail.points.map((q) => `${q.x}px ${q.y}px`).join(', ')})`
          }}
        />
      )}
    </div>
  )
}

function Input({
  status,
  onSubmit,
  onClose
}: {
  status: ChatState['status']
  onSubmit: (t: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    // ウィンドウがキーボードフォーカスを得るまで少し遅れることがあるので、少し待ってから合わせる
    const id = setTimeout(() => ref.current?.focus(), 30)
    return () => clearTimeout(id)
  }, [])
  // 返答が終わったら、すぐ次を打てるように入力欄へフォーカスを戻す(他のアプリを触っているときは奪わない)
  useEffect(() => {
    if (status === 'idle' && document.hasFocus()) ref.current?.focus()
  }, [status])
  // 空のまま放置したら閉じる(送ったあとも開いたままなので)。書きかけ・返答待ちの間は閉じない
  useEffect(() => {
    if (!shouldAutoCloseInput(text, status)) return
    const id = setTimeout(onClose, INPUT_IDLE_CLOSE_MS)
    return () => clearTimeout(id)
  }, [text, status, onClose])

  return (
    <>
      <textarea
        ref={ref}
        rows={2}
        value={text}
        placeholder="…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // 日本語入力の変換確定のEnterでは送信しない(isComposing / 旧WebKitの keyCode 229)
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (text.trim()) {
              onSubmit(text)
              setText('') // 送ったら空にして、続けて次を打てる
            }
          }
          // Esc は、窓全体で受ける(App.tsx。吹き出しを、まとめて閉じる)
        }}
      />
    </>
  )
}
