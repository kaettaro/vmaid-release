import { useCallback, useEffect, useRef, useState } from 'react'
import { mergePackRules } from '@shared/packs/manifest'
import { overrideForCharacter } from '@shared/packs/slots'
import { RuleEngine } from '@shared/rules/engine'
import type { RuleValues } from '@shared/rules/effective'
import { createRegistry, registryFromView } from '@shared/rules/registry'
import { formatIssue, parseRuleSetYaml } from '@shared/rules/yaml'
import type { ActionRequest, FireResult, HandleResult, RuleEvent, RuleSet } from '@shared/rules/types'
import { changeAffection, defaultCharState, parseCharState, setMood, tickCharState, type CharState } from '@shared/touch/charState'
import { diffEnded, type StateLooks } from '@shared/state/looks'
import { EMPTY_LOG, DEFAULT_TALK, parseTalkLog, recordTalk, talkBlock, type TalkLog, type TalkSettings } from '@shared/talk/gate'
import { activeModes, changeEmotion, emotionValue, endMode, releaseModes, setEmotion, startMode, type Modes } from '@shared/state/runtime'

/** モーションの再生オプション(ルールの playMotion から) */
export interface PlayOptions {
  /** ループするモーションを、この秒数だけ再生する */
  durationSec?: number
  /** 再生中のモーションが終わってから続ける */
  queue?: boolean
  /** 一緒に流す BGM(ダンスの楽曲の表から) */
  bgm?: { path: string; offsetSec: number; volume: number }
  /** このアクションを出したルールの Mod の id(自分のルールなら無い)。Mod を OFF にしたとき、BGM を止めるのに使う */
  source?: string
}

/** ルールを実行する側(キャラウィンドウ)が提供する操作 */
export interface RuleActionHandlers {
  /** 話しかけてはいけない状況か(会話中・ゲーム中・キャラ非表示)。話しかけ控え(条件 canTalk)に使う */
  talkBusy: () => boolean
  /** 登録済みのモーションか */
  hasMotion: (name: string) => boolean
  /** そのタグが付いたモーションの名前(playMotion の tag を解決する) */
  motionsWithTag: (tag: string) => string[]
  playMotion: (name: string, opts?: PlayOptions) => void
  /** 再生中のモーションを止めて、待機に戻す(bgm なら、BGM も止める) */
  stopMotion: (bgm: boolean) => void
  /** ゲーム(機能 Mod)を始める・やめる */
  startGame: (opts: { game?: string; first?: string; level?: string }) => void
  stopGame: () => void
  /** 効果音を鳴らす(機能 Mod「効果音」) */
  playSound: (name: string) => void
  setExpression: (name: string, value: number, durationSec: number, source?: string | null) => void
  say: (text: string) => void
  /** 裏で AI に頼んで、返答だけを、セリフとして出す(会話中などで始められなければ、何もしない) */
  askAi: (instruction: string, save: boolean) => void
  /** Mod の小道具を出す・消す。id は `<Mod の id>/<id>`(自分のルールなら、そのまま) */
  showProp: (id: string, source: string | null, durationSec: number) => void
  hideProp: (id: string) => void
  /** 画面効果を出す・消す。source は、出した Mod の id(自分のルールなら null) */
  showOverlay: (req: { effect: string; scope: string; intensity: number; color: string; durationSec: number }, source: string | null) => void
  hideOverlay: () => void
  /** 移動する(機能 Mod「より自由な移動」)・やめる */
  moveTo: (target: 'random' | 'left' | 'right' | 'center' | 'cursor', mode: 'walk' | 'warp') => void
  stopMove: () => void
  /** keep に含まれない Mod の効果(小道具・表情の上書き)を解除する。all なら、自分のルールの分も解除する */
  releaseSources: (keep: ReadonlySet<string>, all?: boolean) => void
  /** 出している小道具を、すべて消す */
  clearProps: () => void
  /** 表情・衣装パネルで保存したセットを適用する(ルールでの適用は、基準値を変えない一時的なレイヤー。mode: 重ねる / 置き換える) */
  applyPreset: (name: string, revertAfterSec: number, source: string | null, mode: 'overlay' | 'replace') => void
  /** ルールで重ねた表情・衣装セットを外す(name が空ならすべて) */
  revertPreset: (name: string) => void
  /** 標準の表情・衣装に戻す(重ねたセットを外し、標準のセットがあれば、それに戻す) */
  resetLook: () => void
}

const TICK_MS = 1000

const TALK_LOG_KEY = 'vmaid.talkLog'

/** 話しかけの記録(1 日の回数・最後の時刻)。再起動をまたいで、上限を守るため、localStorage に残す(使えなくても、動く) */
function loadTalkLog(): TalkLog {
  try {
    return parseTalkLog(JSON.parse(localStorage.getItem(TALK_LOG_KEY) ?? 'null'))
  } catch {
    return EMPTY_LOG
  }
}
function saveTalkLog(log: TalkLog): void {
  try {
    localStorage.setItem(TALK_LOG_KEY, JSON.stringify(log))
  } catch {
    // 保存できなくても、このまま動く
  }
}

const NOTHING: HandleResult = { fired: [], consumed: false }

/**
 * ルールエンジンをキャラウィンドウに接続する。
 * ルールは main から YAML で受け取って検証・適用し、イベント(クリック・起動・入力など)を渡し、
 * 発火したアクションを handlers で実行する。時間のイベント(放置・時刻)は1秒おきの tick で判定する。
 * - wait で遅らせたアクション(delaySec)は、タイマーで実行する。新しい触れ合いのアクションが来たら、待っている分は取り消す。
 * - キャラの気分・親密度は、ここで持ち(main に保存)、条件(affection / mood)の判定と、アクション(changeAffection / setMood)に使う。
 */
export function useRules(handlers: RuleActionHandlers): {
  fire: (event: RuleEvent) => HandleResult
  errors: string[]
  /** Mod の効果を、すべて解除する(状態・感情値・小道具・表情の上書き・待っているアクション)。ホットキー・メニューの「効果を解除」から */
  releaseAll: () => void
  /** いま続いている状態の名前(会話の指示文を、状態に合わせて足すために main へ渡す) */
  activeStates: () => string[]
} {
  const [errors, setErrors] = useState<string[]>([])
  // 最新のハンドラーを、コールバックの中から参照するための入れ物
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })
  // エンジンは、レンダラーとは別に(effect の中で)作る。作る前に来たイベントは何もしない
  const engineRef = useRef<RuleEngine | null>(null)
  // いま使っているキャラのid(ルールの「対象キャラ」の判定用)。キャラが切り替わるたびに更新する
  const characterIdRef = useRef('')
  // キャラの気分・親密度(使用中のキャラの分)
  const stateRef = useRef<CharState>(defaultCharState(0))
  // 状態(自由な名前のモード)。実行中だけ持つ(再起動で消える)
  const modesRef = useRef<Modes>(new Map())
  // 状態を始めたときに重ねた見た目のセット(状態が終わったら外す)と、前回の tick で続いていた状態
  const looksRef = useRef<StateLooks>(new Map())
  const prevModesRef = useRef<Set<string>>(new Set())
  const fireRef = useRef<((e: RuleEvent) => HandleResult) | null>(null)
  // 話しかけ控えの設定と記録
  const talkRef = useRef<TalkSettings>(DEFAULT_TALK)
  const talkLogRef = useRef<TalkLog>(loadTalkLog())
  // wait で遅らせたアクションのタイマー
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const cancelPending = useCallback((): void => {
    for (const t of timers.current) clearTimeout(t)
    timers.current.clear()
  }, [])

  /**
   * 終わった状態を見つけて、その状態が重ねた見た目を外し、「状態が終わったとき」のルールを動かす。
   * 状態の終わり方(終了のアクション・時間切れ・リセット・Mod の OFF)は問わない。
   */
  const syncModes = useCallback((): void => {
    const now = activeModes(modesRef.current, Date.now())
    const ended = diffEnded(prevModesRef.current, now)
    prevModesRef.current = now
    for (const name of ended) {
      const look = looksRef.current.get(name)
      if (look) {
        handlersRef.current.revertPreset(look.preset)
        looksRef.current.delete(name)
      }
      // ルールの実行の途中から、続けてルールを動かさないよう、次のターンで
      setTimeout(() => fireRef.current?.({ type: 'stateEnd', name }), 0)
    }
  }, [])

  const persistState = useCallback((s: CharState): void => {
    stateRef.current = s
    window.vmaid.saveCharState(s)
  }, [])

  /** 1つのアクションを、いますぐ実行する */
  const runOne = useCallback(
    (a: ActionRequest): void => {
      const h = handlersRef.current
      switch (a.kind) {
        case 'playMotion':
          h.playMotion(a.motion, { durationSec: a.durationSec, queue: a.queue, bgm: a.bgm, source: a.source })
          break
        case 'stopMotion':
          h.stopMotion(a.bgm)
          break
        case 'startGame':
          h.startGame({ game: a.game, ...(a.first !== 'default' ? { first: a.first } : {}), ...(a.level !== 'default' ? { level: a.level } : {}) })
          break
        case 'stopGame':
          h.stopGame()
          break
        case 'playSound':
          h.playSound(a.name)
          break
        case 'setExpression':
          h.setExpression(a.name, a.value, a.durationSec, a.source ?? null)
          break
        case 'startState':
          startMode(modesRef.current, a.name, a.durationSec, a.source ?? null, Date.now())
          if (modesRef.current.has(a.name)) {
            prevModesRef.current.add(a.name)
            if (a.preset) {
              const old = looksRef.current.get(a.name)
              if (old && old.preset !== a.preset) h.revertPreset(old.preset)
              looksRef.current.set(a.name, { preset: a.preset })
              h.applyPreset(a.preset, 0, a.source ?? null, a.presetMode ?? 'overlay')
            }
          }
          break
        case 'endState':
          endMode(modesRef.current, a.name)
          syncModes()
          break
        case 'resetLook':
          h.resetLook()
          break
        case 'setEmotion':
          persistState({ ...stateRef.current, emotions: setEmotion(stateRef.current.emotions, a.name, a.value, Date.now()) })
          break
        case 'changeEmotion':
          persistState({ ...stateRef.current, emotions: changeEmotion(stateRef.current.emotions, a.name, a.delta, Date.now()) })
          break
        case 'showProp':
          h.showProp(a.prop, a.source ?? null, a.durationSec)
          break
        case 'hideProp':
          h.hideProp(a.prop)
          break
        case 'showOverlay':
          h.showOverlay({ effect: a.effect, scope: a.scope, intensity: a.intensity, color: a.color, durationSec: a.durationSec }, a.source ?? null)
          break
        case 'hideOverlay':
          h.hideOverlay()
          break
        case 'moveTo':
          h.moveTo(a.target, a.mode)
          break
        case 'stopMove':
          h.stopMove()
          break
        case 'extension':
          // スクリプト Mod のアクション: main が、その Mod のスクリプトに渡す(完了は待たない)
          window.vmaid.runScriptAction(a.modId, a.action, a.params)
          break
        case 'applyPreset':
          h.applyPreset(a.name, a.revertAfterSec, a.source ?? null, a.mode)
          break
        case 'revertPreset':
          h.revertPreset(a.name)
          break
        case 'say':
          h.say(a.text)
          break
        case 'askAi':
          h.askAi(a.instruction, a.save)
          break
        case 'changeAffection':
          persistState(changeAffection(tickCharState(stateRef.current, Date.now()), a.delta, Date.now()))
          break
        case 'setMood':
          persistState(setMood(tickCharState(stateRef.current, Date.now()), a.mood, a.durationSec, Date.now()))
          break
      }
    },
    [persistState, syncModes]
  )

  /** 発火したアクションを実行する。delaySec のあるものは、タイマーで遅らせる */
  const runActions = useCallback(
    (actions: readonly ActionRequest[]): void => {
      if (actions.length === 0) return
      cancelPending() // 新しい反応が来たら、前の反応の待っている分は取り消す
      for (const a of actions) {
        if (a.delaySec && a.delaySec > 0) {
          const t = setTimeout(() => {
            timers.current.delete(t)
            runOne(a)
          }, a.delaySec * 1000)
          timers.current.add(t)
        } else runOne(a)
      }
    },
    [cancelPending, runOne]
  )

  const fire = useCallback(
    (event: RuleEvent): HandleResult => {
      const engine = engineRef.current
      if (!engine) return NOTHING
      const result = engine.handle(event)
      for (const f of result.fired as FireResult[]) runActions(f.actions)
      return result
    },
    [runActions]
  )

  // エンジンの作成と、ルールの読み込み・差し替え(不正なYAMLは適用せず、いまのルールを使い続ける)
  useEffect(() => {
    // Mod のスロットの値(利用者が選んだモーション名など)。Mod のルールの `{{slot:名前}}` に使う
    let slots: Record<string, Record<string, string>> = {}
    // キャラごとの値(使っているキャラの分が、全キャラ共通の値に優先する)
    let characterSlots: Record<string, Record<string, Record<string, string>>> = {}
    // ルールの値の上書き(Mod の「詳しい設定」)。全キャラ共通と、キャラごと(使っているキャラの分が優先)
    let ruleValues: Record<string, Record<string, RuleValues>> = {}
    let characterRuleValues: Record<string, Record<string, Record<string, RuleValues>>> = {}
    const engine = new RuleEngine({
      now: () => Date.now(),
      random: Math.random,
      hasMotion: (n) => handlersRef.current.hasMotion(n),
      motionsWithTag: (t) => handlersRef.current.motionsWithTag(t),
      characterId: () => characterIdRef.current,
      // 話しかけ控え: 設定(静かにして・間隔・上限・夜間)と、記録(回数・最後の時刻)と、いまの状況(会話中など)から決める
      talk: {
        allowed: () => talkBlock(talkRef.current, talkLogRef.current, Date.now(), handlersRef.current.talkBusy()) === null,
        spoke: () => {
          talkLogRef.current = recordTalk(talkLogRef.current, Date.now())
          saveTalkLog(talkLogRef.current)
        }
      },
      // Mod の状態が分かるまでは、すべて OFF(Mod の機能を使うルールを、誤って動かさない)
      registry: createRegistry([]),
      slots: (modId) => overrideForCharacter(slots[modId] ?? {}, characterSlots[modId]?.[characterIdRef.current]),
      ruleValues: (modId) => {
        const common = ruleValues[modId] ?? {}
        const mine = characterRuleValues[modId]?.[characterIdRef.current]
        if (!mine) return common
        const out: Record<string, RuleValues> = { ...common }
        for (const [rid, vals] of Object.entries(mine)) out[rid] = { ...(common[rid] ?? {}), ...vals }
        return out
      },
      state: () => {
        const s = tickCharState(stateRef.current, Date.now())
        return { affection: s.affection, mood: s.mood }
      },
      runtime: () => ({
        modes: activeModes(modesRef.current, Date.now()),
        emotion: (name) => emotionValue(stateRef.current.emotions, name, Date.now())
      })
    })
    engineRef.current = engine
    const loadState = (): void => {
      void window.vmaid.getCharState().then((raw) => {
        stateRef.current = parseCharState(raw, Date.now())
      })
    }
    loadState()
    // ユーザーのルール(rules.yaml)と、有効なパックのルールを、別々に持ち、合成してエンジンに渡す(ユーザーのルールが先)
    let userSet: RuleSet = { version: 1, rules: [] }
    let packSet: RuleSet = { version: 1, rules: [] }
    const applyMerged = (): void => engine.setRuleSet(mergePackRules(userSet, [{ ruleSet: packSet }]))
    const apply = (text: string): void => {
      const r = parseRuleSetYaml(text)
      if (r.ruleSet) {
        userSet = r.ruleSet
        applyMerged()
        setErrors([])
      } else {
        setErrors(r.issues.map(formatIssue))
      }
    }
    const loadPacks = (): void => {
      void window.vmaid.getPackRuleSet().then((rs) => {
        packSet = rs
        applyMerged()
        // OFF にした(または、外した)Mod の効果を、すぐ解除する。有効な Mod = いまのルールを持つ Mod(id は `<Mod の id>/…`)
        const enabled = new Set(rs.rules.map((r) => r.id.split('/')[0]))
        releaseModes(modesRef.current, enabled)
        syncModes()
        handlersRef.current.releaseSources(enabled)
      })
    }
    let alive = true
    // 機能 Mod の ON/OFF を先に反映してから、ルールを読み込む(起動時のルールが、OFF の Mod の機能を使って動かないように)
    void window.vmaid
      .getMods()
      .then((v) => {
        if (alive) {
          engine.setRegistry(registryFromView(v))
          slots = v.slots
          characterSlots = v.characterSlots
          ruleValues = v.ruleValues
          characterRuleValues = v.characterRuleValues
        }
        return window.vmaid.getRules()
      })
      .then((f) => alive && apply(f.text))
    void window.vmaid.getTalk().then((t) => (talkRef.current = t))
    const offTalk = window.vmaid.onTalkChanged((t) => (talkRef.current = t))
    const offMods = window.vmaid.onModsChanged((v) => {
      engine.setRegistry(registryFromView(v))
      slots = v.slots
      characterSlots = v.characterSlots
      ruleValues = v.ruleValues
      characterRuleValues = v.characterRuleValues
      // 機能 Mod を OFF にしたら、その機能の効果(状態・小道具)も、すぐ止める
      const on = (id: string): boolean => v.features.some((f) => f.id === id && f.enabled)
      if (!on('emotion-state')) {
        modesRef.current.clear()
        syncModes()
      }
      if (!on('props')) handlersRef.current.clearProps()
      if (!on('overlay')) handlersRef.current.hideOverlay()
    })
    loadPacks()
    const offPacks = window.vmaid.onPacksChanged(loadPacks)
    void window.vmaid.getCharacterChange().then((c) => (characterIdRef.current = c.activeId))
    const offCharacter = window.vmaid.onCharacterChanged((c) => {
      characterIdRef.current = c.activeId
      cancelPending()
      loadState() // キャラが変わったら、そのキャラの気分・親密度を読み直す
    })
    const off = window.vmaid.onRulesChanged((f) => apply(f.text))
    // 設定画面の「テスト発火」: 条件を無視して、そのルールのアクションを今すぐ1回実行する
    const offTest = window.vmaid.onRulesTestFire((id) => {
      const r = engine.testFire(id)
      if (r) runActions(r.actions)
    })
    return () => {
      alive = false
      off()
      offPacks()
      offMods()
      offTalk()
      offCharacter()
      offTest()
      cancelPending()
      engineRef.current = null
    }
  }, [runActions, cancelPending, syncModes])

  // 時間の経過(放置・時刻のトリガー)
  useEffect(() => {
    fireRef.current = fire
    const id = setInterval(() => {
      syncModes() // 時間切れで終わった状態を見つける
      fire({ type: 'tick' })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [fire, syncModes])

  /** すべて解除: 状態・感情値・小道具・表情の上書き・待っているアクション。Mod の ON/OFF は変えない(それは、main 側で) */
  const releaseAll = useCallback((): void => {
    cancelPending()
    modesRef.current.clear()
    looksRef.current.clear() // 見た目は、下の revertPreset('') ですべて外れる
    prevModesRef.current = new Set()
    persistState({ ...stateRef.current, emotions: {} })
    handlersRef.current.releaseSources(new Set(), true)
    handlersRef.current.clearProps()
    handlersRef.current.hideOverlay()
    handlersRef.current.revertPreset('')
  }, [cancelPending, persistState])

  const activeStates = useCallback((): string[] => [...activeModes(modesRef.current, Date.now()).keys()], [])

  return { fire, errors, releaseAll, activeStates }
}
