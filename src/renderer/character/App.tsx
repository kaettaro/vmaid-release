import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelFile, MotionState } from '@shared/ipc'
import { uiScaleForWidth } from '@shared/chat/bubble'
import { isDoubleClick, type ClickPoint } from '@shared/chat/clicks'
import type { ModsView } from '@shared/modsApi'
import { GestureRecognizer, type GestureEvent } from '@shared/touch/gesture'
import { dragToPitch, dragToYaw, snapPitch, snapYaw, type Orientation } from '@shared/character/yaw'
import { readOrientation } from '@shared/adjust'
import { resolveBeautify, type ResolvedBeautify } from '@shared/beautify'
import type { ChaseSettings, ChaseView } from '@shared/chase'
import type { CustomTouchPart } from '@shared/touch/parts'
import { parseGameInput } from '@shared/game/registry'
import type { GameId } from '@shared/game/engine'
import type { BubbleView } from '@shared/bubble'
import { escAction, isEscapeKey } from '@shared/chat/dismiss'
import { ChatBubble } from './ChatBubble'
import { useChat } from './useChat'
import { useRules } from './useRules'
import { useTts } from './useTts'
import { useAudio } from './useAudio'
import type { CharacterStage } from './stage'
import { VrmStage } from './vrmStage'

/** ホイール1目盛りあたりの拡大縮小の強さ(指数。トラックパッドの細かい入力でも滑らか) */
const WHEEL_SENSITIVITY = 0.0015
/** これ未満の移動・時間で離したらクリックとみなす */
const CLICK_MAX_MOVE_PX = 5
const CLICK_MAX_MS = 400

export function App(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<CharacterStage | null>(null)
  /** いま使う美化(機能 Mod「美化」)。ステージを入れ替えたとき、新しいステージへ渡す */
  const beautifyRef = useRef<ResolvedBeautify>(null)
  /** 追いかけ(機能 Mod): 設定(OFF なら null)と、カーソルの位置(このウィンドウの中のピクセル) */
  const chaseRef = useRef<ChaseSettings | null>(null)
  /** Mod が宣言した、触れ合いの部位(有効なもの) */
  const touchPartsRef = useRef<CustomTouchPart[]>([])
  const chaseCursorRef = useRef<{ x: number; y: number } | null>(null)
  /** 最後に受け取ったモーションの一覧(ステージを入れ替えたとき、新しいステージへ渡す) */
  const lastMotionsRef = useRef<MotionState | null>(null)
  const clickThroughRef = useRef(true)
  const scaleRef = useRef(1)
  const draggingRef = useRef(false)
  const [message, setMessage] = useState<{ text: string; error: boolean; action?: { label: string; run: () => void } } | null>(null)
  const [hasModel, setHasModel] = useState(false)
  /** 頭のてっぺんの高さ(css px)。返答の吹き出しを、頭のすぐ上に付ける */
  const [headTop, setHeadTop] = useState<number | null>(null)
  const overUiRef = useRef(false)
  const [uiScale, setUiScale] = useState(() => uiScaleForWidth(window.innerWidth))

  // ルール(if-then): 起動・クリック・放置・時刻・チャット入力(トリガーワード)・返答完了で、アクションを実行する
  const sayRef = useRef<(text: string) => void>(() => {})
  const askRef = useRef<(instruction: string, save: boolean) => boolean>(() => false)
  /** いま出している画面効果を出した Mod の id(自分のルールなら null) */
  const overlaySourceRef = useRef<string | null>(null)
  /** いま適用している表情・衣装セットを適用した Mod の id(自分のルールなら null) */
  /** 表情・衣装セットを重ねた Mod(Mod が OFF になったら、その Mod の分を外す) */
  const presetSourcesRef = useRef<Set<string>>(new Set())
  // 機能 Mod「美化(リアル)」「美化(トゥーン)」: ON/OFF・設定の変更を、描画へすぐ反映する
  useEffect(() => {
    const apply = (v: Parameters<typeof resolveBeautify>[0]): void => {
      beautifyRef.current = resolveBeautify(v)
      stageRef.current?.setBeautify(beautifyRef.current)
    }
    void window.vmaid.getBeautify().then(apply)
    return window.vmaid.onBeautifyChanged(apply)
  }, [])

  // Mod が宣言した触れ合いの部位: Mod・パックが変わるたびに取り直して、ステージへ渡す
  useEffect(() => {
    const load = (): void => {
      void window.vmaid.getTouchParts().then((parts) => {
        touchPartsRef.current = parts
        stageRef.current?.setTouchParts(parts)
      })
    }
    load()
    const offPacks = window.vmaid.onPacksChanged(load)
    const offMods = window.vmaid.onModsChanged(load)
    return () => {
      offPacks()
      offMods()
    }
  }, [])

  // 追いかけ(機能 Mod): 設定と、カーソルの位置をステージへ渡す
  useEffect(() => {
    const apply = (v: ChaseView): void => {
      const { enabled, ...settings } = v
      chaseRef.current = enabled ? settings : null
      stageRef.current?.setChase(chaseRef.current)
      if (!enabled) stageRef.current?.setChaseCursor(null)
    }
    void window.vmaid.getChase().then(apply)
    const offChanged = window.vmaid.onChaseChanged(apply)
    const offCursor = window.vmaid.onChaseCursor((c) => {
      chaseCursorRef.current = { x: c.x - c.wx, y: c.y - c.wy }
      stageRef.current?.setChaseCursor(chaseCursorRef.current)
    })
    return () => {
      offChanged()
      offCursor()
    }
  }, [])

  // 効果音(機能 Mod「効果音」)と、ダンスの BGM(楽曲の表に BGM があれば、モーションの開始・終了に合わせて流す・止める)
  const audio = useAudio()
  const audioRef = useRef(audio)
  useEffect(() => {
    audioRef.current = audio
  })
  /** ゲーム(機能 Mod)が続いているか。続いている間は、チャットの「5」「3の2」などを、ゲームの手として受ける */
  const gameActiveRef = useRef(false)
  /** いま遊んでいるゲーム(チャットの手の読み方・「もう一回」で、同じゲームを始めるのに使う) */
  const gameIdRef = useRef<GameId | null>(null)
  /** いま BGM を流している(流そうとしている)ルールの Mod の id(自分のルールなら null)。その Mod が OFF になったら止める */
  const bgmSourceRef = useRef<string | null>(null)
  /** 会話中(入力欄を開いている・返答中)。話しかけ控えに使う */
  const chatBusyRef = useRef(false)
  /** 裏の指示(AI に頼んで言う)の返答を待っている・受けている間か(useChat の asking)。話しかけ控えが、会話中とみなす */
  const askingRef = useRef<(() => boolean) | null>(null)
  const rules = useRules({
    talkBusy: () => chatBusyRef.current || gameActiveRef.current || document.hidden || (askingRef.current?.() ?? false),
    hasMotion: (n) => stageRef.current?.hasMotion(n) ?? false,
    motionsWithTag: (t) => stageRef.current?.motionsWithTag(t) ?? [],
    playMotion: (n, opts) => {
      if (opts?.bgm) bgmSourceRef.current = opts.source ?? null
      audio.playMotion(stageRef.current, n, opts, opts?.bgm)
    },
    stopMotion: (bgm) => {
      stageRef.current?.stopMotion()
      if (bgm) audio.stopBgm()
    },
    startGame: (opts) => window.vmaid.startGame(opts as Parameters<typeof window.vmaid.startGame>[0]),
    stopGame: () => window.vmaid.stopGame(),
    playSound: (n) => audio.playSound(n),
    setExpression: (n, v, sec, src) => stageRef.current?.setExpression(n, v, sec, src),
    say: (t) => sayRef.current(t),
    askAi: (instruction, save) => askRef.current(instruction, save),
    showProp: (id, source, sec) => {
      void window.vmaid.getPropData(id).then((p) => p && stageRef.current?.showProp(id, p.payload, p.spec, sec, source))
    },
    hideProp: (id) => stageRef.current?.hideProp(id),
    showOverlay: (req, source) => {
      overlaySourceRef.current = source
      window.vmaid.showOverlay(req)
    },
    hideOverlay: () => {
      overlaySourceRef.current = null
      window.vmaid.hideOverlay()
    },
    moveTo: (target, mode) => window.vmaid.moveTo(target, mode),
    stopMove: () => window.vmaid.stopMove(),
    releaseSources: (keep, all) => {
      stageRef.current?.releaseSources(keep, all)
      // Mod が流した BGM は、その Mod が OFF になったら止める(自分のルールの分は、all のときだけ)
      const bsrc = bgmSourceRef.current
      if (all || (bsrc !== null && !keep.has(bsrc))) {
        bgmSourceRef.current = null
        audioRef.current.stopBgm()
      }
      // Mod が出した画面効果は、その Mod が OFF になったら消す(自分のルールの分は、all のときだけ)
      const src = overlaySourceRef.current
      if (all || (src !== null && !keep.has(src))) {
        overlaySourceRef.current = null
        window.vmaid.hideOverlay()
      }
      // Mod が適用した表情・衣装セット(モーフなど)も、その Mod が OFF になったら戻す
      if (all) {
        presetSourcesRef.current.clear()
        window.vmaid.revertPreset()
      } else {
        for (const psrc of [...presetSourcesRef.current]) {
          if (keep.has(psrc)) continue
          presetSourcesRef.current.delete(psrc)
          window.vmaid.revertPreset({ source: psrc })
        }
      }
    },
    clearProps: () => stageRef.current?.clearProps(),
    applyPreset: (name, sec, source, mode) => {
      if (source !== null) presetSourcesRef.current.add(source)
      void window.vmaid.applyPreset(name, { transient: true, revertAfterSec: sec, mode, source })
    },
    revertPreset: (name) => {
      window.vmaid.revertPreset(name === '' ? undefined : { name })
    },
    resetLook: () => window.vmaid.resetLook()
  })
  const { fire } = rules
  // 「Mod の効果を今すぐ解除」(ホットキー・メニュー): 状態・感情値・小道具・表情の上書きを止める
  const releaseAllRef = useRef(rules.releaseAll)
  useEffect(() => {
    releaseAllRef.current = rules.releaseAll
  })
  // 緊急リセット(ショートカット・メニュー・基本設定): 向き・再生中のモーション・ルールの効果を、初期に戻す(窓の位置・倍率は main が戻している)
  useEffect(
    () =>
      window.vmaid.onCharacterReset(() => {
        releaseAllRef.current()
        audioRef.current.stopAll()
        stageRef.current?.setOrientation({ yaw: 0, pitch: 0 }, true)
        stageRef.current?.stopMotion()
        setMessage({ text: 'キャラを初期状態に戻しました', error: false, action: { label: '元に戻す', run: () => window.vmaid.undoResetCharacter() } })
        setTimeout(() => setMessage((cur) => (cur?.text.startsWith('キャラを初期状態') ? null : cur)), 15_000)
      }),
    []
  )
  // リセットの取り消し: 向きを戻す(位置・大きさなどは main が戻している)
  useEffect(
    () =>
      window.vmaid.onCharacterRestore((o) => {
        stageRef.current?.setOrientation(o, true)
        setMessage({ text: 'リセット前の状態に戻しました', error: false })
        setTimeout(() => setMessage((cur) => (cur?.text.startsWith('リセット前の状態') ? null : cur)), 4000)
      }),
    []
  )

  // 読み上げの失敗(エンジンに接続できない等)は、短く知らせる。続けて出ないよう、10秒に1回まで
  const lastTtsErrorAt = useRef(0)
  const tts = useTts((m) => {
    if (Date.now() - lastTtsErrorAt.current < 10_000) return
    lastTtsErrorAt.current = Date.now()
    setMessage({ text: `読み上げに失敗しました: ${m}`, error: true })
    setTimeout(() => setMessage((cur) => (cur?.text.startsWith('読み上げに失敗') ? null : cur)), 6000)
  })
  const ttsPlayer = tts.player
  // 吹き出し拡張(機能 Mod)の設定と、いま使っているキャラの id(キャラごとの上書きに使う)
  const [bubble, setBubble] = useState<BubbleView | null>(null)
  const [activeCharacterId, setActiveCharacterId] = useState('')
  useEffect(() => {
    void window.vmaid.getBubble().then(setBubble)
    return window.vmaid.onBubbleChanged(setBubble)
  }, [])
  useEffect(() => {
    void window.vmaid.getCharacterChange().then((c) => setActiveCharacterId(c.activeId))
    return window.vmaid.onCharacterChanged((c) => setActiveCharacterId(c.activeId))
  }, [])
  const chat = useChat({
    onSpeakStart: () => stageRef.current?.speakStart(),
    // 声を出している間は、読み上げが終わるまで「喋り中」を続ける(声が続いているのに、動きが止まらないように)
    onSpeakEnd: () => {
      const p = tts.player.current
      if (p?.enabled) p.whenIdle(() => stageRef.current?.speakEnd())
      else stageRef.current?.speakEnd()
    },
    onNewTurn: tts.newTurn,
    onChunk: tts.streamDelta,
    onStreamEnd: tts.streamEnd,
    onSayLine: tts.speakLine,
    onLipSync: (ms) => stageRef.current?.lipSync(ms),
    onReplyDone: (text) => void fire({ type: 'replyDone', text }),
    onReplyStart: (text) => void fire({ type: 'replyStart', text }),
    beforeSend: (text) => {
      // ゲーム中は、手(「5」「3の2」「左上」)・「もう一回」・「やめる」を、ゲームの操作として受ける(AI には送らない)
      if (gameActiveRef.current) {
        const cmd = parseGameInput(gameIdRef.current, text)
        if (cmd) {
          if (cmd.kind === 'move') window.vmaid.gameMove(cmd.move)
          else if (cmd.kind === 'restart') window.vmaid.startGame(gameIdRef.current ? { game: gameIdRef.current } : undefined)
          else window.vmaid.stopGame()
          return true
        }
      }
      return fire({ type: 'userMessage', text }).consumed
    },
    onActivity: () => void fire({ type: 'activity' }),
    getStates: rules.activeStates
  })
  useEffect(() => {
    sayRef.current = chat.say
    askRef.current = chat.ask
    askingRef.current = chat.asking
  })
  const startedRef = useRef(false)
  const fireRef = useRef(fire)
  useEffect(() => {
    fireRef.current = fire
  })
  // スクリプト Mod の host.say / rules.emit
  useEffect(() => window.vmaid.onScriptSay((text) => sayRef.current(text)), [])
  // スクリプト Mod の host.ai.say: 「AI に頼んで言う」と同じ(会話中などは、始めない)
  useEffect(() => window.vmaid.onScriptAsk((r) => void askRef.current(r.instruction, r.save)), [])
  useEffect(() => window.vmaid.onScriptEvent((e) => void fireRef.current({ type: 'modEvent', modId: e.modId, name: e.name })), [])
  // AI の返答の感情タグ → ルール(トリガー「AI が感情を表したとき」)
  useEffect(() => window.vmaid.onChatEmotion((emotion) => void fireRef.current({ type: 'llmEmotion', emotion })), [])
  // AI の返答の動きの指定([pose:…]) → ルール(トリガー「AI が動き(ポーズ)を指定したとき」)
  useEffect(() => window.vmaid.onChatPose((pose) => void fireRef.current({ type: 'llmPose', pose })), [])
  // 移動(機能 Mod「より自由な移動」): ウィンドウを動かすのは main。ここでは、歩行のモーション・体の向き・ワープのあとのモーションを担当する
  const moveOrientationRef = useRef<Orientation | null>(null)
  useEffect(
    () =>
      window.vmaid.onMoveState((m) => {
        const stage = stageRef.current
        if (!stage) return
        const pick = (tag: string): string | null => {
          const list = tag ? stage.motionsWithTag(tag) : []
          return list.length > 0 ? list[Math.floor(Math.random() * list.length)] : null
        }
        if (m.kind === 'walk') {
          // 歩く向きに体を向ける(保存してある向きは、歩き終わったら戻す)。歩行のモーションを、歩いている間、ループする
          const saved = (moveOrientationRef.current ??= stage.getOrientation())
          stage.setFitLocked(true)
          stage.setOrientation({ yaw: m.yaw, pitch: saved.pitch })
          const name = pick(m.tag) ?? (stage.hasMotion('walk') ? 'walk' : null)
          if (name) stage.playMotion(name, { durationSec: 3600, interrupt: true })
        } else if (m.kind === 'idle') {
          const wasWalking = moveOrientationRef.current !== null
          if (moveOrientationRef.current) stage.setOrientation(moveOrientationRef.current)
          moveOrientationRef.current = null
          stage.setFitLocked(false)
          if (wasWalking) stage.stopMotion()
          if (m.ended && m.mode === 'warp') {
            const name = pick(m.warpTag)
            if (name) stage.playMotion(name, { interrupt: true })
          }
          if (m.ended && m.mode) void fireRef.current({ type: 'moveEnd', mode: m.mode })
        }
      }),
    []
  )
  // 会話中(入力欄を開いている・返答中)は、自動の移動を控える
  const chatBusy = chat.state.inputOpen || chat.state.status !== 'idle'
  useEffect(() => {
    chatBusyRef.current = chatBusy
  }, [chatBusy])
  useEffect(() => window.vmaid.setMoveBusy(chatBusy), [chatBusy])
  // ゲーム(機能 Mod): 手・結果をルールのトリガーへ、始まり・終わりをチャット入力の振り分けへ
  useEffect(
    () =>
      window.vmaid.onGameEvent((e) => {
        if (e.type === 'state') {
          gameActiveRef.current = e.active
          gameIdRef.current = e.game
        } else if (e.type === 'move') void fireRef.current({ type: 'gameMove', who: e.who, game: e.game })
        else void fireRef.current({ type: 'gameResult', result: e.result, game: e.game })
      }),
    []
  )
  const openInputRef = useRef(chat.openInput)
  useEffect(() => {
    openInputRef.current = chat.openInput
  })
  // Esc: 吹き出し(入力欄・送った文・返答)を、まとめて閉じる。返答中なら、中断もする。
  // 入力欄の中だけでなく、窓全体で受ける(入力欄から、フォーカスが外れていても、閉じられるように)。
  // 日本語入力(IME)で、変換中の Esc は、変換の取り消しなので、何もしない(2 回目の Esc で閉じる)。
  const chatState = chat.state
  const dismissChat = chat.dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isEscapeKey(e)) return
      if (!escAction(chatState).handled) return
      dismissChat()
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [chatState, dismissChat])

  // 入力欄を開いている間の、フォーカスの扱い: 窓にフォーカスが戻ったら、入力欄に戻す(Esc が届くように)。
  // フォーカスを失って、空のまま 4 秒たったら、入力欄を閉じる(Esc が届かないまま、残らないように。書きかけは残す)
  const inputOpenNow = chat.state.inputOpen
  const closeChatInput = chat.closeInput
  useEffect(() => {
    if (!inputOpenNow) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const textarea = (): HTMLTextAreaElement | null => document.querySelector('.bubble-user textarea')
    const onFocus = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      textarea()?.focus()
    }
    const onBlur = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (!document.hasFocus() && (textarea()?.value ?? '') === '') closeChatInput()
      }, 4000)
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [inputOpenNow, closeChatInput])

  // クリック透過の制御: キャラのいる場所と吹き出しの上だけマウスを受け、それ以外は下のアプリへ通す。
  // モデル未読込のときは全面で受ける(右クリックメニューを使えるように)
  const syncIgnore = useCallback(() => {
    const stage = stageRef.current
    if (!stage || draggingRef.current) return
    const ignore = clickThroughRef.current && stage.hasModel && !stage.isHit && !overUiRef.current
    window.vmaid.setIgnoreMouse(ignore)
  }, [])

  /**
   * 読み込むモデルの種類(vrm / mmd)に合ったステージにする。違えば、いまのステージを捨てて、作り直す。
   * MMD のステージ(と、その読み込み用のコード)は、MMD 対応 Mod で PMX を読むときだけ、読み込む
   */
  const ensureStage = useCallback(
    async (kind: 'vrm' | 'mmd'): Promise<CharacterStage> => {
      const cur = stageRef.current
      if (cur && cur.kind === kind) return cur
      cur?.dispose()
      stageRef.current = null
      let next: CharacterStage
      if (kind === 'mmd') {
        const { MmdStage } = await import('./mmdStage')
        next = new MmdStage(canvasRef.current!)
      } else next = new VrmStage(canvasRef.current!)
      next.onHitChange = syncIgnore
      next.onLayout = setHeadTop
      // 音声合成の再生状況を、口の動き(リップシンク)へ渡す
      next.speechSource = () => ({ level: ttsPlayer.current?.level ?? null, speaking: ttsPlayer.current?.systemSpeakingNow ?? false })
      next.motionLoader = (name) => window.vmaid.getMotionData(name, { vrm: kind === 'vrm' })
      next.setBeautify(beautifyRef.current)
      next.setChase(chaseRef.current)
      next.setTouchParts(touchPartsRef.current)
      next.setChaseCursor(chaseCursorRef.current)
      next.onMotionStart = (name) => audioRef.current.bgm.current?.start(name)
      next.onMotionEnd = (name) => audioRef.current.bgm.current?.stop(name)
      next.onMotionError = (name) => setMessage({ text: `モーションを読み込めませんでした: ${name}`, error: true })
      if (lastMotionsRef.current) next.setMotions(lastMotionsRef.current)
      stageRef.current = next
      setHasModel(false)
      return next
    },
    [syncIgnore, ttsPlayer]
  )

  const loadModel = useCallback(
    async (file: ModelFile) => {
      setMessage({ text: `「${file.name}」を読み込み中…`, error: false })
      try {
        const stage = await ensureStage(file.kind === 'pmx' ? 'mmd' : 'vrm')
        // モデルごとの調整値を復元し、表情・衣装パネルへ項目を届ける
        const profile = await window.vmaid.getProfile(file.hash)
        const snapshot = await stage.loadFile(file, profile)
        window.vmaid.notifyModelLoaded(file.path)
        if (snapshot) window.vmaid.publishAdjust(snapshot)
        stage.setOrientation(readOrientation(profile), true) // 保存してある向きを復元する
        setHasModel(true)
        setMessage(null)
        // 起動したときのルール(あいさつ等)。アプリの起動後、最初にモデルが出たときに1回だけ。
        // モーションの登録(非同期)が終わるのを少し待ってから発火する
        if (!startedRef.current) {
          startedRef.current = true
          setTimeout(() => fireRef.current({ type: 'startup' }), 1200)
        }
        console.info('モデル読み込み完了', file.name, file.kind)
        syncIgnore()
      } catch (e) {
        setMessage({
          text: `「${file.name}」を読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`,
          error: true
        })
      }
    },
    [ensureStage, syncIgnore]
  )

  useEffect(() => {
    void ensureStage('vrm')
    const applyMotions = (state: MotionState): void => {
      lastMotionsRef.current = state
      stageRef.current?.setMotions(state)
    }
    void window.vmaid.getMotions().then(applyMotions)
    const offMotions = window.vmaid.onMotionsChanged(applyMotions)
    const offPreview = window.vmaid.onMotionPreview(({ name, loop }) => audioRef.current.playMotion(stageRef.current, name, { interrupt: true, ...(loop ? { durationSec: 3600 } : {}) }))
    const offStop = window.vmaid.onMotionStop(() => {
      stageRef.current?.stopMotion()
      audioRef.current.stopBgm()
    })
    const offSeek = window.vmaid.onMotionSeek((sec) => stageRef.current?.seek(sec))
    const offPause = window.vmaid.onMotionPause((paused) => stageRef.current?.setPaused(paused))
    // 再生ウィンドウの、進み具合の表示のために、再生中の状態を、約 0.1 秒ごとに報告する(再生が終わったら、null を 1 回)
    let reporting = false
    const reportTimer = setInterval(() => {
      const p = stageRef.current?.getPlayback() ?? null
      if (p) {
        reporting = true
        window.vmaid.reportPlayback(p)
      } else if (reporting) {
        reporting = false
        window.vmaid.reportPlayback(null)
      }
    }, 100)
    // 設定画面の「試しに再生」: 効果音、または、ダンスの行(モーション + BGM)
    const offAudio = window.vmaid.onAudioPreview((req) => {
      if (req.kind === 'sound') audioRef.current.playSound(req.name)
      else {
        const e = req.entry
        audioRef.current.playMotion(stageRef.current, e.motion, { interrupt: true }, e.bgm === '' ? undefined : { path: e.bgm, offsetSec: e.offsetSec, volume: e.volume })
      }
    }) // 試し再生は、いまのモーションを待たずに、すぐ始める
    void window.vmaid.getDisplay().then((d) => {
      clickThroughRef.current = d.clickThrough
      scaleRef.current = d.scale
      syncIgnore()
    })
    const offDisplay = window.vmaid.onDisplayChanged((d) => {
      clickThroughRef.current = d.clickThrough
      scaleRef.current = d.scale
      syncIgnore()
    })
    const offAdjust = window.vmaid.onAdjustApply(({ key, value }) => stageRef.current?.adjustSet(key, value))
    const offAdjustReset = window.vmaid.onAdjustResetAll(() => stageRef.current?.adjustResetAll())
    const offAdjustAll = window.vmaid.onAdjustApplyAll((values) => stageRef.current?.adjustSetAll(values))
    const offModel = window.vmaid.onModelLoad((f) => void loadModel(f))
    void window.vmaid.getLastModel().then(async (f) => {
      if (f) return loadModel(f)
      // PMX のキャラで、MMD 対応 Mod が OFF のとき、何も出ないので、理由を知らせる
      const s = await window.vmaid.getSettings()
      const active = s.characters.find((c) => c.id === s.activeCharacterId)
      if (active?.modelPath && /\.pmx$/i.test(active.modelPath)) setMessage({ text: 'このキャラのモデルは PMX です。設定 →「Mod」で「MMD 対応」を ON にすると表示されます', error: false })
    })
    // MMD 対応 Mod の ON/OFF: OFF にしたら PMX を外し、ON に戻したら、モデルを読み直す
    let mmdOn: boolean | null = null
    const offMmd = window.vmaid.onModsChanged((v) => {
      const on = v.features.some((f) => f.id === 'mmd' && f.enabled)
      const was = mmdOn
      mmdOn = on
      if (was === null || was === on) return
      if (!on && stageRef.current?.kind === 'mmd') {
        void ensureStage('vrm').then(() => setMessage({ text: 'Mod「MMD 対応」が OFF のため、PMX のモデルを表示していません(ON に戻すと、また表示されます)', error: false }))
      } else if (on && !stageRef.current?.hasModel) {
        void window.vmaid.getLastModel().then((f) => f && loadModel(f))
      }
    })
    void window.vmaid.getMods().then((v) => {
      mmdOn ??= v.features.some((f) => f.id === 'mmd' && f.enabled)
    })

    return () => {
      offDisplay()
      offModel()
      offMmd()
      offAdjust()
      offAdjustReset()
      offAdjustAll()
      offMotions()
      offPreview()
      offStop()
      offSeek()
      offPause()
      clearInterval(reportTimer)
      offAudio()
      stageRef.current?.dispose()
      stageRef.current = null
    }
  }, [loadModel, ensureStage, syncIgnore])

  // 部位の判定・長押し・なでる、は、公式の機能 Mod「高度な触れ合い」(touch-advanced)が ON のときだけ。OFF なら、部位なしの単純なクリックだけ
  const touchAdvancedRef = useRef(false)
  useEffect(() => {
    const pick = (v: ModsView): void => {
      touchAdvancedRef.current = v.features.some((f) => f.id === 'touch-advanced' && f.enabled)
    }
    void window.vmaid.getMods().then(pick)
    return window.vmaid.onModsChanged(pick)
  }, [])

  // --- ポインタ操作 ---
  useEffect(() => {
    let start: { x: number; y: number; time: number } | null = null
    let lastClick: ClickPoint | null = null
    // Shift+ドラッグ中は、ウィンドウを動かさず、キャラの向きを変える
    let rotating: { x: number; y: number; yaw: number; pitch: number } | null = null

    // 長押し・なでる(触れ合い)の認識。部位の判定は重いので、ボタンを押していない間の移動では、50msおきまで
    const gesture = new GestureRecognizer()
    let lastHover = 0
    let hoverTouch: { part: string; side: string } | null = null
    const emit = (events: GestureEvent[]): void => {
      if (!touchAdvancedRef.current) return
      for (const ev of events) {
        fireRef.current({ type: 'activity' }) // なでている間は、放置ではない
        fireRef.current({ type: ev.type, part: ev.part, side: ev.side, sec: ev.sec, session: ev.session })
      }
    }
    const touchAtThrottled = (x: number, y: number, force: boolean): { part: string; side: string } | null => {
      if (!touchAdvancedRef.current) return null
      const now = performance.now()
      if (force || now - lastHover >= 50) {
        lastHover = now
        const t = stageRef.current?.touchAt(x, y)
        hoverTouch = t ? { part: t.part, side: t.side } : null
      }
      return hoverTouch
    }
    const gestureTimer = setInterval(() => emit(gesture.tick(performance.now())), 150)

    const isUi = (el: EventTarget | Element | null): boolean => el instanceof Element && el.closest('[data-ui]') !== null

    const onMove = (e: PointerEvent): void => {
      stageRef.current?.setPointer(e.clientX, e.clientY)
      // 吹き出しの上にいるか(クリック透過中でも、転送されるマウス移動で判定できる)
      const over = isUi(document.elementFromPoint(e.clientX, e.clientY))
      if (over !== overUiRef.current) {
        overUiRef.current = over
        syncIgnore()
      }
      if (rotating) {
        // 横方向 = 左右の向き、縦方向 = 上下の傾き
        stageRef.current?.setOrientation(
          { yaw: dragToYaw(rotating.yaw, e.clientX - rotating.x), pitch: dragToPitch(rotating.pitch, e.clientY - rotating.y) },
          true
        )
      } else if (start) {
        window.vmaid.dragMove(e.screenX - start.x, e.screenY - start.y)
        gesture.dragMove({ t: performance.now(), x: e.screenX, y: e.screenY, part: null, side: null }) // 動かしたら、長押しではない
      } else if (e.buttons === 0 && stageRef.current?.hasModel) {
        // ボタンを押さずに動かしている: なでる動きかを見る(吹き出しの上・体の外は、部位なし)
        const touch = over ? null : touchAtThrottled(e.clientX, e.clientY, false)
        emit(gesture.hover({ t: performance.now(), x: e.clientX, y: e.clientY, part: touch?.part ?? null, side: touch?.side ?? null }))
      }
    }
    const onDown = (e: PointerEvent): void => {
      fireRef.current({ type: 'activity' }) // 操作があれば、放置時間をリセットする
      const stage = stageRef.current
      if (isUi(e.target)) return // 吹き出し(入力欄・スクロール)の操作ではキャラを動かさない
      if (e.button !== 0 || !stage?.hasModel) return
      stage.setPointer(e.clientX, e.clientY)
      if (e.shiftKey) {
        emit(gesture.cancel(performance.now()))
        const o = stage.getOrientation()
        rotating = { x: e.clientX, y: e.clientY, yaw: o.yaw, pitch: o.pitch }
        draggingRef.current = true
        return
      }
      start = { x: e.screenX, y: e.screenY, time: performance.now() }
      draggingRef.current = true
      window.vmaid.dragStart()
      // 長押しの判定を始める(押した位置の部位。体の外なら、長押しにならない)
      emit(gesture.cancel(performance.now()))
      const t = touchAtThrottled(e.clientX, e.clientY, true)
      gesture.down({ t: performance.now(), x: e.screenX, y: e.screenY, part: t?.part ?? null, side: t?.side ?? null })
    }
    const onUp = (e: PointerEvent): void => {
      gesture.up()
      if (rotating) {
        // 離したら、45°刻みの近くなら吸着して、モデルごとに保存する(なめらかに追従して止まる)
        rotating = null
        draggingRef.current = false
        const stage = stageRef.current
        if (stage) {
          const o = stage.getOrientation()
          const next = { yaw: snapYaw(o.yaw), pitch: snapPitch(o.pitch) }
          stage.setOrientation(next)
          window.vmaid.saveOrientation(next.yaw, next.pitch)
        }
        syncIgnore()
        return
      }
      if (!start) return
      // ほとんど動かさず短時間で離した場合はドラッグではなくクリック
      const moved = Math.hypot(e.screenX - start.x, e.screenY - start.y)
      const isClick = e.type === 'pointerup' && moved < CLICK_MAX_MOVE_PX && performance.now() - start.time < CLICK_MAX_MS
      start = null
      draggingRef.current = false
      window.vmaid.dragEnd()
      syncIgnore()
      if (isClick) {
        const now: ClickPoint = { x: e.screenX, y: e.screenY, time: performance.now() }
        if (isDoubleClick(lastClick, now)) {
          // ダブルクリック → 会話(入力欄を開く)
          lastClick = null
          openInputRef.current()
        } else {
          // クリック → ふれあい。何をするかはルール(click)で決まる。ダブルクリックの1回目でも即座に反応する(待たせない)
          lastClick = now
          // 触った部位(頭・手・脚など)を判定して渡す。ルールで、部位ごとに反応を変えられる
          const touch = touchAdvancedRef.current ? stageRef.current?.touchAt(e.clientX, e.clientY) : undefined
          fireRef.current({ type: 'click', part: touch?.part, side: touch?.side })
        }
      } else {
        lastClick = null
      }
    }
    const onWheel = (e: WheelEvent): void => {
      if (isUi(e.target)) return // 吹き出し内のスクロールを優先
      e.preventDefault()
      scaleRef.current *= Math.exp(-e.deltaY * WHEEL_SENSITIVITY)
      window.vmaid.setScale(scaleRef.current)
    }
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      window.vmaid.showContextMenu()
    }
    const onResize = (): void => setUiScale(uiScaleForWidth(window.innerWidth))
    const onLeave = (): void => {
      stageRef.current?.setPointer(null, null)
      emit(gesture.cancel(performance.now())) // 窓から出たら、なで終わり
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('resize', onResize)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('mouseleave', onLeave)
      clearInterval(gestureTimer)
    }
  }, [syncIgnore])

  return (
    <div
      className="stage"
      data-head={headTop !== null ? '' : undefined}
      style={{ ['--ui-scale' as string]: uiScale, ...(headTop !== null ? { ['--head-top' as string]: `${headTop}px` } : {}) }}
    >
      <canvas ref={canvasRef} className="canvas" />
      <ChatBubble uiScale={uiScale} state={chat.state} bubble={bubble} characterId={activeCharacterId} onSubmit={chat.submit} onCloseInput={chat.closeInput} onAbort={chat.abort} />
      {!hasModel && !message && (
        <p className="hint">
          右クリック →「設定を開く」→
          <br />
          「キャラクター」で、モデルを登録してください
        </p>
      )}
      {message && (
        <p className={message.error ? 'hint error' : 'hint'} data-ui={message.action ? '' : undefined}>
          {message.text}
          {message.action && (
            <button className="hint-action" onClick={message.action.run}>
              {message.action.label}
            </button>
          )}
        </p>
      )}
      {rules.errors.length > 0 && (
        <p className="hint error rules-error">
          ルールファイルにエラーがあります(前のルールで動いています):
          <br />
          {rules.errors.slice(0, 3).join(' / ')}
        </p>
      )}
    </div>
  )
}
