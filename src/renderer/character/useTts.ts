import { useCallback, useEffect, useRef } from 'react'
import { SentenceSplitter } from '@shared/tts/sentences'
import { TtsPlayer } from './ttsPlayer'

/**
 * 読み上げをキャラウィンドウへつなぐ。返答のストリーム(断片)を文に区切って、できた順に読み上げる。
 * 設定は、新しい会話の始まり(と、セリフを言うとき)に main から取り直す。オフのときは、何もしない(通信もしない)。
 */
export function useTts(onError: (message: string) => void = () => {}): {
  player: React.RefObject<TtsPlayer | null>
  /** 新しい入力を送るとき(前の読み上げを止めて、設定を取り直す) */
  newTurn: () => void
  streamDelta: (delta: string) => void
  /** 返答が終わった(中断なら捨てる)。残りの文を読み上げに積む */
  streamEnd: (aborted: boolean) => void
  /** ルールの say など、決まったセリフ */
  speakLine: (text: string) => void
  cancel: () => void
} {
  const playerRef = useRef<TtsPlayer | null>(null)
  const splitter = useRef(new SentenceSplitter())
  const errorRef = useRef(onError)
  useEffect(() => {
    errorRef.current = onError
  })

  useEffect(() => {
    const p = new TtsPlayer()
    p.onError = (m) => errorRef.current(m)
    playerRef.current = p
    void window.vmaid.getTtsConfig().then((c) => p.setConfig(c))
    // Mod「音声合成」の ON/OFF が変わったら、すぐ反映する(OFF なら、読み上げ中のものも止まる)
    const offMods = window.vmaid.onModsChanged(() => void window.vmaid.getTtsConfig().then((c) => p.setConfig(c)))
    return () => {
      offMods()
      p.dispose()
      playerRef.current = null
    }
  }, [])

  const refresh = useCallback(async () => {
    const p = playerRef.current
    if (p) p.setConfig(await window.vmaid.getTtsConfig())
  }, [])

  const cancel = useCallback(() => {
    splitter.current.reset()
    playerRef.current?.cancel()
  }, [])

  const newTurn = useCallback(() => {
    cancel()
    void refresh()
  }, [cancel, refresh])

  const streamDelta = useCallback((delta: string) => {
    const p = playerRef.current
    if (!p?.enabled) return
    for (const s of splitter.current.push(delta)) p.speak(s)
  }, [])

  const streamEnd = useCallback((aborted: boolean) => {
    const p = playerRef.current
    if (aborted) {
      cancel()
      return
    }
    if (!p?.enabled) {
      splitter.current.reset()
      return
    }
    for (const s of splitter.current.flush()) p.speak(s)
  }, [cancel])

  const speakLine = useCallback(
    (text: string) => {
      void refresh().then(() => {
        const p = playerRef.current
        if (p?.enabled && p.speakSay) p.speak(text)
      })
    },
    [refresh]
  )

  return { player: playerRef, newTurn, streamDelta, streamEnd, speakLine, cancel }
}
