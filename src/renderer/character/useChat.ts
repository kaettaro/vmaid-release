import { useCallback, useEffect, useRef, useState } from 'react'
import { bubbleDisplayMs } from '@shared/chat/bubble'
import { dismissed, isBusy } from '@shared/chat/dismiss'
import type { ChatPrep } from '@shared/modelsApi'

export type ChatStatus = 'idle' | 'waiting' | 'streaming' | 'error'

export interface ChatState {
  /** 入力用の吹き出しを編集中か */
  inputOpen: boolean
  /** 直近に送った自分のセリフ(入力用の吹き出しに残す) */
  lastUser: string | null
  /** キャラの返答(ストリーミング中は伸びていく) */
  reply: string
  status: ChatStatus
  error: string | null
  /** モデルのダウンロード・読み込み中の状況(返答が始まるまで) */
  prep: ChatPrep | null
  /** AI が最後に返した感情(感情タグ。吹き出しの見た目を変えるのに使う。新しい返答・セリフで消える) */
  emotion: string | null
}

interface Hooks {
  /** 最初のチャンクが届いたとき(喋り始め) */
  onSpeakStart: () => void
  /** 返答の完了・中断・エラー(喋り終わり) */
  onSpeakEnd: () => void
  /** ルールの say(決まったセリフ)を出す間、口だけを動かす */
  onLipSync: (durationMs: number) => void
  /** 返答が正常に終わった(ルールの replyDone)。text は、返答の本文 */
  onReplyDone: (text: string) => void
  /** AI に送った(返答を考え始めた)。text は、入力した文(裏の指示は、空)(ルールの replyStart) */
  onReplyStart: (text: string) => void
  /**
   * ユーザーが入力を送ろうとしたとき、ルール(トリガーワード)に通す。
   * true を返すと、その入力はルールが処理したので、AIには送らない。
   */
  beforeSend: (text: string) => boolean
  /** 入力・操作があった(放置時間のリセット) */
  onActivity: () => void
  /** いま続いている状態の名前(Mod の、状態のときだけ足す指示文に使う) */
  getStates?: () => string[]
  /** 読み上げ: 新しい入力を送る(前の読み上げを止める) */
  onNewTurn: () => void
  /** 読み上げ: 返答の断片 */
  onChunk: (delta: string) => void
  /** 読み上げ: 返答が終わった(aborted=中断・エラー) */
  onStreamEnd: (aborted: boolean) => void
  /** 読み上げ: ルールの say(決まったセリフ) */
  onSayLine: (text: string) => void
}

const initial: ChatState = { inputOpen: false, lastUser: null, reply: '', status: 'idle', error: null, prep: null, emotion: null }

/** 会話の状態管理。main からのストリーミングを受けて、吹き出しの表示状態を作る */
export function useChat({ onSpeakStart, onSpeakEnd, onLipSync, onReplyDone, onReplyStart, beforeSend, onActivity, onNewTurn, onChunk, onStreamEnd, onSayLine, getStates }: Hooks) {
  const [state, setState] = useState<ChatState>(initial)
  const statusRef = useRef<ChatStatus>('idle')
  /** 直近に送った文(入力欄を閉じたあとの、吹き出しを消す時間の見積もり用) */
  const lastTextRef = useRef('')
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Esc で閉じた(中断した)返答の、あとから届く断片・完了・エラーを、吹き出しに出さないための印。次の送信・セリフで解く */
  const dismissedRef = useRef(false)
  /** 裏の指示(ルールの「AI に頼んで言う」)の返答を待っている・受けている間。準備中の表示・エラーは出さない(邪魔をしない) */
  const askingRef = useRef(false)
  /** 入力欄が開いているか(裏の指示を始めない判断用) */
  const inputOpenRef = useRef(false)
  const hooks = useRef({ onSpeakStart, onSpeakEnd, onLipSync, onReplyDone, onReplyStart, beforeSend, onActivity, onNewTurn, onChunk, onStreamEnd, onSayLine, getStates })
  useEffect(() => {
    hooks.current = { onSpeakStart, onSpeakEnd, onLipSync, onReplyDone, onReplyStart, beforeSend, onActivity, onNewTurn, onChunk, onStreamEnd, onSayLine, getStates } // 最新のコールバックを購読側から参照する
  })

  const set = useCallback((patch: Partial<ChatState>) => {
    if (patch.status) statusRef.current = patch.status
    if (patch.inputOpen !== undefined) inputOpenRef.current = patch.inputOpen
    setState((s) => ({ ...s, ...patch }))
  }, [])

  const clearHideTimer = (): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }

  /** 一定時間後に、返答と自分のセリフの吹き出しを消す(入力中は消さない) */
  const scheduleHide = useCallback((text: string) => {
    clearHideTimer()
    hideTimer.current = setTimeout(() => {
      setState((s) => {
        // 返答待ち・返答中は消さない(完了したときに、あらためて予約される)
        if (s.status === 'waiting' || s.status === 'streaming') return s
        // 入力欄を開いている間は、入力欄(と直前に送った文)は残し、キャラの返答・エラーだけ消す
        return s.inputOpen ? { ...s, reply: '', error: null, prep: null, status: 'idle' } : { ...initial }
      })
    }, bubbleDisplayMs(text))
  }, [])

  useEffect(() => {
    const offChunk = window.vmaid.onChatChunk((delta) => {
      if (dismissedRef.current) return // Esc で閉じたあとに届いた断片は、出さない
      if (statusRef.current !== 'streaming') hooks.current.onSpeakStart()
      statusRef.current = 'streaming'
      hooks.current.onChunk(delta)
      setState((s) => ({ ...s, status: 'streaming', reply: s.reply + delta }))
    })
    const offDone = window.vmaid.onChatDone(({ text, aborted }) => {
      askingRef.current = false
      hooks.current.onStreamEnd(aborted) // 残りの文を読み上げに積んでから、喋り終わり(読み上げが終わるまで待つ)にする
      hooks.current.onSpeakEnd()
      set({ status: 'idle' })
      if (dismissedRef.current) return // Esc で閉じていた: 吹き出しは出さず、返答完了のルールも動かさない
      scheduleHide(text)
      if (!aborted && text) hooks.current.onReplyDone(text)
    })
    const offPrep = window.vmaid.onChatPrep((prep) => {
      if (askingRef.current) return // 裏の指示では、ダウンロード・読み込みの表示を出さない
      setState((s) => ({ ...s, prep }))
    })
    const offEmotion = window.vmaid.onChatEmotion((emotion) => setState((s) => ({ ...s, emotion })))
    const offError = window.vmaid.onChatError((message) => {
      hooks.current.onStreamEnd(true)
      hooks.current.onSpeakEnd()
      if (askingRef.current) {
        // 裏の指示の失敗は、黙って終わる(頼まれていない話しかけで、エラーを出して邪魔をしない)
        askingRef.current = false
        set({ status: 'idle' })
        return
      }
      if (dismissedRef.current) {
        set({ status: 'idle' }) // Esc で閉じていたら、エラーも出さない
        return
      }
      set({ status: 'error', error: message, reply: '', prep: null })
      scheduleHide(message)
    })
    return () => {
      offChunk()
      offDone()
      offPrep()
      offEmotion()
      offError()
      clearHideTimer()
    }
  }, [set, scheduleHide])

  /** キャラをクリックしたとき。進行中の返答は残したまま入力欄を開く(開いているなら、そのまま) */
  const openInput = useCallback(() => {
    clearHideTimer()
    dismissedRef.current = false
    hooks.current.onActivity()
    window.vmaid.focusWindow()
    window.vmaid.prepareChat() // 内蔵LLMなら、入力している間にモデルを先に読み込む(待ち時間を隠す)
    set({ inputOpen: true })
  }, [set])

  /** 入力欄を閉じる。残っている吹き出し(直前に送った文・返答)は、少ししてから消える */
  const closeInput = useCallback(() => {
    set({ inputOpen: false })
    scheduleHide(lastTextRef.current)
  }, [set, scheduleHide])

  const submit = useCallback(
    (text: string) => {
      const t = text.trim()
      if (!t) return
      clearHideTimer()
      dismissedRef.current = false
      askingRef.current = false // 自分の入力が優先(裏の指示は、main が中断する)
      hooks.current.onActivity()
      hooks.current.onNewTurn() // 前の読み上げは止める(新しい入力が来た)
      // トリガーワード: ルールが処理した入力は、AIに送らない(自分の吹き出しは残す)。
      // 入力欄は開いたままにして(そのまま次を打てる)、送った文は入力欄の上に残す。
      // ルールの say(キャラのセリフ)を、あとから上書きしないため、キャラの吹き出し=reply はここでは触らない
      lastTextRef.current = t
      set({ inputOpen: true, lastUser: t, error: null })
      // 吹き出しを消す予約は、「あとから呼ばれたほう」が勝つ。先に自分の入力の分を予約しておき、
      // そのあとのルール実行で say(キャラのセリフ)があれば、そちらの表示時間で上書きされるようにする
      scheduleHide(t)
      if (hooks.current.beforeSend(t)) return
      set({ reply: '', status: 'waiting', prep: null, emotion: null })
      hooks.current.onReplyStart(t)
      window.vmaid.sendChat(t, hooks.current.getStates?.()) // main が前の応答を中断して新しく始める
    },
    [set, scheduleHide]
  )

  /**
   * ルールの「AI に頼んで言う」: 裏で AI に頼み、返答だけを、キャラの吹き出し・読み上げ・感情に流す(自分の吹き出しは出さない)。
   * 入力欄を開いている・返答中・すでに頼んでいるときは、何もしない(false)。返答が始まるまでは、何も出さない。
   */
  const ask = useCallback(
    (instruction: string, save: boolean): boolean => {
      if (inputOpenRef.current || askingRef.current || isBusy({ status: statusRef.current })) return false
      clearHideTimer()
      dismissedRef.current = false
      askingRef.current = true
      hooks.current.onNewTurn()
      set({ reply: '', error: null, prep: null, emotion: null })
      hooks.current.onReplyStart('')
      window.vmaid.askAi(instruction, { states: hooks.current.getStates?.(), save })
      return true
    },
    [set]
  )

  /** ルールの say: 決まったセリフを、キャラの吹き出しに出す(AIは使わない) */
  const say = useCallback(
    (text: string) => {
      clearHideTimer()
      if (askingRef.current) {
        askingRef.current = false
        window.vmaid.abortChat() // 頼んでいた返答は、やめる(決まったセリフと、混ざらないように)
      }
      dismissedRef.current = false
      set({ reply: text, status: 'idle', error: null, prep: null, emotion: null })
      scheduleHide(text)
      // セリフを言う間だけ、口を動かす。喋り中の状態(モーションの切り替え)には入らず、同じルールの playMotion を妨げない
      hooks.current.onLipSync(Math.min(4000, 800 + text.length * 120))
      hooks.current.onSayLine(text)
    },
    [set, scheduleHide]
  )

  /** 応答の中断(完了通知が main から来て、喋り終わりになる) */
  const abort = useCallback(() => window.vmaid.abortChat(), [])

  /**
   * Esc: 入力欄・送った文・返答の吹き出しを、まとめて閉じる(返答中なら、中断もする)。
   * 中断した返答の、あとから届く断片・エラーは、出さない。
   */
  const dismiss = useCallback(() => {
    clearHideTimer()
    if (isBusy({ status: statusRef.current }) || askingRef.current) {
      dismissedRef.current = true
      askingRef.current = false
      window.vmaid.abortChat()
    }
    inputOpenRef.current = false
    setState((s) => dismissed(s))
  }, [])

  /** 裏の指示の返答を待っている・受けている間か(話しかけ控えが、「会話中」とみなす) */
  const asking = useCallback((): boolean => askingRef.current, [])

  return { state, openInput, closeInput, submit, say, ask, asking, abort, dismiss }
}
