import { DEFAULT_AFFECTION } from '../touch/charState'
import { findDance, parseDances } from '../dance'
import { findDef } from './definitions'
import { effectiveRule, hasSlotRefs, type RuleValues } from './effective'
import { analyzeRuleSet, FULL_REGISTRY, type RuleRegistry } from './registry'
import { EMPTY_VARS, expandTemplate, normalizeText, restAfterKeyword, subjectOf, type TemplateVars } from './template'
import type { ActionRequest, FireResult, HandleResult, Rule, RuleEvent, RuleSet } from './types'

export { normalizeText }

// ルールエンジン(SPEC 6)。Electron/DOM に依存しない純粋なクラス。時刻と乱数は外から渡し、テストで決定的に動かす。
// 流れ: イベント → トリガーが一致するルール → 条件(すべて満たす) → アクションを具体化して返す。
// 実際にモーションを再生する・表情を変える・セリフを出す処理は、呼び出し側(キャラウィンドウ)が行う。

export interface EngineEnv {
  /** 現在時刻(エポックミリ秒) */
  now: () => number
  /** 0以上1未満の乱数 */
  random: () => number
  /** 登録済みのモーションか(グループから、存在しないモーションを選ばないため)。省略すると、すべて存在するとみなす */
  hasMotion?: (name: string) => boolean
  /** そのタグが付いた、再生できるモーション名(playMotion の tag を解決する)。登録順 */
  motionsWithTag?: (tag: string) => string[]
  /** いま使っているキャラのid。省略すると、キャラの指定(characters)は見ない(すべてのルールが対象) */
  characterId?: () => string
  /** キャラの気分・親密度(条件 affection / mood の判定に使う)。省略すると、既定の値(親密度30・ふつう)として扱う */
  state?: () => { affection: number; mood: string }
  /** 使える種類の定義(機能 Mod の ON/OFF)。省略すると、すべて使える。OFF の Mod の種類を使うルールは、実行しない */
  registry?: RuleRegistry
  /** Mod のスロットの値(modId → スロットid → 値)。Mod のルール(id が `<modId>/…`)の `{{slot:名前}}` に使う */
  slots?: (modId: string) => Record<string, string> | undefined
  /** 状態(続いているものの名前)と感情値(条件 state / emotion の判定用)。省略すると、状態なし・感情値 0 */
  runtime?: () => { modes: ReadonlySet<string>; emotion: (name: string) => number }
  /** 話しかけ控え(条件 canTalk)。allowed = いま話しかけてよいか / spoke = 話しかけが 1 回あったことの記録(canTalk つきのルールが発火したとき)。省略すると、いつでもよい */
  talk?: { allowed: () => boolean; spoke: () => void }
  /** Mod のルールの値の上書き(層 A): modId → ルールのローカル id → 場所 → 値。使っているキャラの分を、重ねたもの。省略なら、上書きなし */
  ruleValues?: (modId: string) => Record<string, RuleValues> | undefined
}

/** 触った履歴(recentTouches 用)を残す時間 */
const TOUCH_LOG_MS = 10 * 60 * 1000

const pad = (n: number): string => String(n).padStart(2, '0')
const dateKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export class RuleEngine {
  private ruleSet: RuleSet = { version: 1, rules: [] }
  private registry: RuleRegistry
  /** 使えない(未解決の)ノードを含むルールのid。実行しない */
  private blocked = new Set<string>()
  private lastFired = new Map<string, number>()
  private lastActivity: number
  /** この放置期間で、すでに発火した idle ルール */
  private idleFired = new Set<string>()
  /** timeOfDay ルールが、最後に発火した日(1日1回) */
  private dayFired = new Map<string, string>()
  /** interval ルールが、最後に動いた時刻(まだ動いていないものは、見つけた時刻。起動した直後には動かない) */
  private intervalAt = new Map<string, number>()
  /** hold / stroke ルールが、最後に発火した長押し・なでの通し番号(同じ通し番号では、1度だけ発火する) */
  private sessionFired = new Map<string, string>()
  /** 直近のクリックの履歴(条件 recentTouches 用) */
  private touchLog: Array<{ t: number; part: string }> = []

  constructor(
    private readonly env: EngineEnv,
    ruleSet?: RuleSet
  ) {
    this.lastActivity = env.now()
    this.registry = env.registry ?? FULL_REGISTRY
    if (ruleSet) this.setRuleSet(ruleSet)
  }

  /**
   * ルールの実効の値(ADR 0005 §22): Mod のスロットの `{{slot:id}}` と、利用者が Mod タブで上書きした値を、差し込んだルール。
   * どちらも無いルールは、そのまま返す(複製しない)
   */
  private eff(rule: Rule): Rule {
    const i = rule.id.indexOf('/')
    const modId = i < 0 ? undefined : rule.id.slice(0, i)
    const values = modId ? this.env.ruleValues?.(modId)?.[rule.id.slice(i + 1)] : undefined
    if (!values && !hasSlotRefs(rule)) return rule
    return effectiveRule(rule, (k, t) => this.registry.find(k, t), modId ? (this.env.slots?.(modId) ?? {}) : undefined, values)
  }

  /** 機能 Mod の ON/OFF が変わったとき。未解決のルールを、判定し直す */
  setRegistry(registry: RuleRegistry): void {
    this.registry = registry
    this.blocked = new Set(analyzeRuleSet(this.ruleSet, registry).keys())
  }

  /** このルールは、使えないノードを含むため実行されないか */
  isBlocked(ruleId: string): boolean {
    return this.blocked.has(ruleId)
  }

  /** ルールを差し替える。クールダウンの履歴は、同じidのルールなら引き継ぐ(編集のたびにリセットされないように) */
  setRuleSet(ruleSet: RuleSet): void {
    this.ruleSet = ruleSet
    this.blocked = new Set(analyzeRuleSet(ruleSet, this.registry).keys())
    const ids = new Set(ruleSet.rules.map((r) => r.id))
    for (const map of [this.lastFired, this.dayFired, this.sessionFired, this.intervalAt]) for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id)
    for (const id of [...this.idleFired]) if (!ids.has(id)) this.idleFired.delete(id)
  }

  get rules(): readonly Rule[] {
    return this.ruleSet.rules
  }

  handle(event: RuleEvent): HandleResult {
    if (event.type === 'activity') {
      this.lastActivity = this.env.now()
      this.idleFired.clear() // 操作があれば、放置期間はリセットされ、また発火できる
      return { fired: [], consumed: false }
    }
    const fired: FireResult[] = []
    let consumed = false
    const rules = this.ruleSet.rules.map((r) => this.eff(r))

    /** 発火の条件(トリガー・条件)を満たしていれば、確定して結果に加える */
    const tryFire = (rule: Rule): boolean => {
      if (!rule.enabled || this.blocked.has(rule.id) || !this.appliesToCharacter(rule) || !this.triggerMatches(rule, event) || !this.conditionsPass(rule)) return false
      this.commit(rule, event)
      fired.push({ ruleId: rule.id, actions: this.resolveActions(rule, this.varsOf(rule, event)) })
      if (rule.when.trigger === 'userMessage' && rule.when.passToLlm !== true) consumed = true
      return true
    }

    if (event.type === 'click') {
      // 触った履歴(条件 recentTouches 用)。今回のクリックも数えるので、ルールの判定より先に記録する
      const now = this.env.now()
      this.touchLog.push({ t: now, part: event.part ?? 'any' })
      this.touchLog = this.touchLog.filter((e) => now - e.t <= TOUCH_LOG_MS).slice(-100)
    }

    if (event.type === 'click' || event.type === 'hold' || event.type === 'stroke') {
      // 触れ合いのトリガーは2段階: 部位を指定したルール(頭・手など)を先に調べ、1つでも動いたら、部位を指定しない汎用の
      // 同じ種類のルールは動かさない(「頭をなでたとき」に、汎用のリアクションまで重ならないように)
      let specificFired = false
      for (const rule of rules) if (this.isPartSpecific(rule) && tryFire(rule)) specificFired = true
      if (!specificFired) for (const rule of rules) if (this.isTouchTrigger(rule) && !this.isPartSpecific(rule)) tryFire(rule)
      // 触れ合い以外のトリガーは、ここでは発火しない
      return { fired, consumed }
    }
    for (const rule of rules) tryFire(rule)
    return { fired, consumed }
  }

  /** テスト発火(M7のボタン): トリガーと条件を無視して、アクションだけを具体化する。クールダウンは更新しない */
  testFire(ruleId: string, sample?: string): FireResult | null {
    const found = this.ruleSet.rules.find((r) => r.id === ruleId)
    if (!found || this.blocked.has(found.id)) return null
    const rule = this.eff(found)
    // sample = トリガーワードのルールに、入力例を与える(`{{message}}` / `{{rest}}` の確認用)
    const vars = this.varsOf(rule, sample === undefined ? { type: 'tick' } : { type: 'userMessage', text: sample })
    return { ruleId, actions: this.resolveActions(rule, vars) }
  }

  /** `{{message}}` / `{{rest}}` の値。トリガーワードのルールで、入力が一致したときだけ値が入る */
  private varsOf(rule: Rule, event: RuleEvent): TemplateVars {
    const slots = this.slotsOf(rule)
    if (event.type === 'replyStart' && rule.when.trigger === 'replyStart') return { ...EMPTY_VARS, message: event.text, ...(slots ? { slots } : {}) }
    if (event.type === 'replyDone' && rule.when.trigger === 'replyDone') return { ...EMPTY_VARS, reply: event.text ?? '', ...(slots ? { slots } : {}) }
    if (event.type === 'llmPose' && rule.when.trigger === 'poseTag') return { ...EMPTY_VARS, pose: event.pose, ...(slots ? { slots } : {}) }
    if (event.type !== 'userMessage' || rule.when.trigger !== 'userMessage') return slots ? { ...EMPTY_VARS, slots } : EMPTY_VARS
    const input = normalizeText(event.text)
    const keyword = this.keywordsOf(rule).find((k) => {
      const kw = normalizeText(k)
      return kw !== '' && (rule.when.match === 'equals' ? input === kw : input.includes(kw))
    })
    const contains = keyword !== undefined && rule.when.match !== 'equals'
    return {
      message: event.text,
      rest: contains ? restAfterKeyword(event.text, keyword) : '',
      subject: contains ? subjectOf(event.text, keyword) : '',
      ...(slots ? { slots } : {})
    }
  }

  /** このルールが、どの Mod のものか(id が `<modId>/…`)。自分のルールなら undefined */
  private sourceOf(rule: Rule): string | undefined {
    const i = rule.id.indexOf('/')
    return i < 0 ? undefined : rule.id.slice(0, i)
  }

  /** Mod のルール(id が `<modId>/…`)のスロットの値。自分のルールには、スロットは無い */
  private slotsOf(rule: Rule): Record<string, string> | undefined {
    const i = rule.id.indexOf('/')
    return i < 0 ? undefined : (this.env.slots?.(rule.id.slice(0, i)) ?? {})
  }

  /** このルールが、いま使っているキャラで動くか(characters が無い・空なら、すべてのキャラ) */
  private appliesToCharacter(rule: Rule): boolean {
    if (!rule.characters || rule.characters.length === 0 || !this.env.characterId) return true
    return rule.characters.includes(this.env.characterId())
  }

  /** クリック・長押し・なでる(触れ合いのトリガー) */
  private isTouchTrigger(rule: Rule): boolean {
    return rule.when.trigger === 'click' || rule.when.trigger === 'hold' || rule.when.trigger === 'stroke'
  }

  /**
   * 触れ合いのルールで、「より具体的」か: 触った部位を指定している(部位・左右のどちらかが「どこでも」以外)、
   * または、続けて触られたとき(recentTouches)の条件がある。具体的なルールが動いたら、汎用の同じ種類のルールは動かさない
   */
  private isPartSpecific(rule: Rule): boolean {
    return this.isTouchTrigger(rule) && (rule.when.part !== 'any' || rule.when.side !== 'any' || rule.if.some((c) => c.condition === 'recentTouches'))
  }

  /**
   * 触った部位が、ルールの指定に合うか。部位が判定できなかったとき(体の外など)は、部位指定のルールは動かない。
   * 左右(side)は、左右のある部位(腕・手・脚・足)にだけ意味がある:
   * - part を指定していて、その部位に左右がない(頭・胸・お腹・腰)なら、side は無視して部位だけで判定する
   * - part が「どこでも」で side だけ指定したなら、左右のある部位の、その側のときだけ動く(中央の部位では動かない)
   */
  private touchMatches(rule: Rule, event: { part?: string; side?: string }): boolean {
    const { part, side } = rule.when
    if (part !== 'any' && event.part !== part) return false
    if (side === 'any') return true
    if (part !== 'any' && event.side === 'center') return true // 中央の部位に side を書いても、無視する
    return event.side === side // 左右のない部位・判定できないとき(undefined / center)は、一致しない
  }

  // --- トリガー ---
  private triggerMatches(rule: Rule, event: RuleEvent): boolean {
    const w = rule.when
    switch (w.trigger) {
      case 'click':
        return event.type === 'click' && this.touchMatches(rule, event)
      case 'hold':
      case 'stroke': {
        if (event.type !== w.trigger || !this.touchMatches(rule, event)) return false
        if (event.sec < (w.minSec as number)) return false
        return this.sessionFired.get(rule.id) !== `${event.type}:${event.session}` // 同じ長押し・なでの間に、1度だけ
      }
      case 'strokeEnd':
        return event.type === 'strokeEnd' && this.touchMatches(rule, event) && event.sec >= (w.minSec as number)
      case 'startup':
      case 'replyStart':
      case 'replyDone':
        return event.type === w.trigger
      case 'moveEnd':
        return event.type === 'moveEnd' && (w.mode === 'any' || w.mode === undefined || w.mode === event.mode)
      case 'stateEnd':
        return event.type === 'stateEnd' && (w.name === '' || w.name === undefined || w.name === event.name)
      case 'gameMove':
        return event.type === 'gameMove' && (w.who === 'any' || w.who === event.who) && (w.game === 'any' || w.game === undefined || w.game === event.game)
      case 'gameResult':
        return event.type === 'gameResult' && (w.result === 'any' || w.result === event.result) && (w.game === 'any' || w.game === undefined || w.game === event.game)
      case 'emotionTag':
        return event.type === 'llmEmotion' && event.emotion.trim().toLowerCase() === String(w.emotion).trim().toLowerCase()
      case 'poseTag':
        return event.type === 'llmPose'
      case 'userMessage':
        return event.type === 'userMessage' && this.keywordMatches(rule, event.text)
      case 'idle':
        if (event.type !== 'tick' || this.idleFired.has(rule.id)) return false
        return this.env.now() - this.lastActivity >= (w.afterSec as number) * 1000
      case 'timeOfDay':
        return event.type === 'tick' && this.timeMatches(rule)
      case 'interval': {
        if (event.type !== 'tick') return false
        const now = this.env.now()
        const since = this.intervalAt.get(rule.id)
        if (since === undefined) {
          this.intervalAt.set(rule.id, now) // 見つけた時刻から数える(起動した直後・ルールを足した直後には、動かない)
          return false
        }
        return now - since >= (w.everyMin as number) * 60_000
      }
      default:
        // スクリプト Mod のトリガー(`<modId>/<name>`)は、その Mod が rules.emit で起こしたイベントに反応する
        return event.type === 'modEvent' && `${event.modId}/${event.name}` === w.trigger
    }
  }

  /** トリガーワードの言葉。Mod のルールの `{{slot:…}}` は、スロットの値(カンマ・読点・改行で区切って、複数)に展開する */
  private keywordsOf(rule: Rule): string[] {
    const slots = this.slotsOf(rule)
    return (rule.when.keywords as string[]).flatMap((k) => {
      if (!slots || !k.includes('{{')) return [k]
      return expandTemplate(k, { ...EMPTY_VARS, slots })
        .split(/[,、，\n]/)
        .map((s) => s.trim())
        .filter((s) => s !== '')
    })
  }

  private keywordMatches(rule: Rule, text: string): boolean {
    const input = normalizeText(text)
    if (input === '') return false
    return this.keywordsOf(rule).some((k) => {
      const kw = normalizeText(k)
      if (kw === '') return false
      return rule.when.match === 'equals' ? input === kw : input.includes(kw)
    })
  }

  /** 指定の時刻(または時間帯)に入っていて、今日まだ発火していないか。日をまたぐ時間帯(22:00〜02:00)にも対応 */
  private timeMatches(rule: Rule): boolean {
    const now = new Date(this.env.now())
    const key = dateKey(now)
    const cur = now.getHours() * 60 + now.getMinutes()
    const from = minutesOf(rule.when.at as string)
    const until = rule.when.until === undefined ? undefined : minutesOf(rule.when.until as string)
    let inWindow: boolean
    let day = key
    if (until === undefined) inWindow = cur >= from // その時刻以降(1日1回。起動が遅れても取りこぼさない)
    else if (from <= until) inWindow = cur >= from && cur <= until
    else {
      // 日をまたぐ: 開始の日の夜〜翌日の明け方。明け方側は「前日の分」として数える
      inWindow = cur >= from || cur <= until
      if (cur <= until) {
        const y = new Date(now)
        y.setDate(y.getDate() - 1)
        day = dateKey(y)
      }
    }
    return inWindow && this.dayFired.get(rule.id) !== day
  }

  // --- 条件(すべて満たすとき) ---
  private conditionsPass(rule: Rule): boolean {
    for (const c of rule.if) {
      if (c.condition === 'probability') {
        if (!(this.env.random() < (c.value as number))) return false
      } else if (c.condition === 'canTalk') {
        if (this.env.talk && !this.env.talk.allowed()) return false
      } else if (c.condition === 'cooldown') {
        const last = this.lastFired.get(rule.id)
        if (last !== undefined && this.env.now() - last < (c.sec as number) * 1000) return false
      } else if (c.condition === 'recentTouches') {
        const now = this.env.now()
        const part = c.part as string
        const n = this.touchLog.filter((e) => now - e.t <= (c.withinSec as number) * 1000 && (part === 'any' || e.part === part)).length
        if (n < (c.count as number)) return false
      } else if (c.condition === 'affection') {
        const a = this.env.state?.().affection ?? DEFAULT_AFFECTION
        if (a < (c.min as number) || a > (c.max as number)) return false
      } else if (c.condition === 'mood') {
        if ((this.env.state?.().mood ?? 'normal') !== c.is) return false
      } else if (c.condition === 'state') {
        const on = this.env.runtime?.().modes.has(c.is as string) ?? false
        if (on !== (c.active !== false)) return false
      } else if (c.condition === 'emotion') {
        const v = this.env.runtime?.().emotion(c.name as string) ?? 0
        if (v < (c.min as number) || v > (c.max as number)) return false
      }
    }
    return true
  }

  /** 発火が確定したときの記録(クールダウン・1回だけ発火する種類の管理) */
  private commit(rule: Rule, event: RuleEvent): void {
    const now = this.env.now()
    this.lastFired.set(rule.id, now)
    if (rule.when.trigger === 'idle') this.idleFired.add(rule.id)
    if (rule.when.trigger === 'interval') this.intervalAt.set(rule.id, now)
    if (rule.if.some((c) => c.condition === 'canTalk')) this.env.talk?.spoke() // 話しかけとして数える
    if ((rule.when.trigger === 'hold' || rule.when.trigger === 'stroke') && (event.type === 'hold' || event.type === 'stroke')) {
      this.sessionFired.set(rule.id, `${event.type}:${event.session}`)
    }
    if (rule.when.trigger === 'timeOfDay') {
      const d = new Date(now)
      const until = rule.when.until === undefined ? undefined : minutesOf(rule.when.until as string)
      const from = minutesOf(rule.when.at as string)
      const cur = d.getHours() * 60 + d.getMinutes()
      if (until !== undefined && from > until && cur <= until) d.setDate(d.getDate() - 1) // 日をまたぐ時間帯の明け方側
      this.dayFired.set(rule.id, dateKey(d))
    }
  }

  // --- アクション ---
  private pick<T>(list: readonly T[]): T | undefined {
    return list.length === 0 ? undefined : list[Math.min(list.length - 1, Math.floor(this.env.random() * list.length))]
  }

  private resolveActions(rule: Rule, vars: TemplateVars): ActionRequest[] {
    const out: ActionRequest[] = []
    /** template: true のパラメータだけ展開する(定義に従う) */
    const expand = (action: string, param: string, text: string): string =>
      findDef('action', action)?.params.find((p) => p.name === param)?.template ? expandTemplate(text, vars) : text
    // wait アクションで、後ろのアクションを遅らせる(秒の累積)。wait 自体は、実行するものを出さない
    let delay = 0
    const source = this.sourceOf(rule)
    const push = (r: ActionRequest): void => {
      out.push({ ...r, ...(delay > 0 ? { delaySec: delay } : {}), ...(source ? { source } : {}) })
    }
    /** Mod のルールが書いた小道具の id は、その Mod の名前空間つきにする(`<modId>/<id>`) */
    const propId = (id: string): string => (id.includes('/') || !source ? id : `${source}/${id}`)
    for (const a of rule.do) {
      switch (a.action) {
        case 'wait':
          delay += a.sec as number
          break
        case 'playMotion': {
          let motion: string | undefined
          if (typeof a.motion === 'string') motion = expand('playMotion', 'motion', a.motion)
          else if (typeof a.tag === 'string') {
            const members = (this.env.motionsWithTag?.(a.tag) ?? []).filter((m) => this.env.hasMotion?.(m) ?? true)
            motion = a.pick === 'first' ? members[0] : this.pick(members)
          }
          if (motion && (this.env.hasMotion?.(motion) ?? true)) {
            push({
              kind: 'playMotion',
              motion,
              ...(typeof a.durationSec === 'number' ? { durationSec: a.durationSec } : {}),
              ...(a.queue === true ? { queue: true } : {})
            })
          }
          break
        }
        case 'playDance': {
          // 楽曲の表から探す。表に無い名前は、モーション名として、BGM なしで再生する(「踊って ワルツ」の従来の動き)
          const entry = findDance(parseDances(expand('playDance', 'songs', (a.songs as string | undefined) ?? '')), expand('playDance', 'name', a.name as string))
          const motion = entry ? entry.motion : expand('playDance', 'fallback', (a.fallback as string | undefined) ?? '').trim()
          if (motion && (this.env.hasMotion?.(motion) ?? true)) {
            push({ kind: 'playMotion', motion, ...(entry && entry.bgm !== '' ? { bgm: { path: entry.bgm, offsetSec: entry.offsetSec, volume: entry.volume } } : {}) })
          }
          break
        }
        case 'stopMotion':
          push({ kind: 'stopMotion', bgm: a.bgm !== false })
          break
        case 'startGame':
          push({
            kind: 'startGame',
            game: (a.game ?? 'tictactoe') as 'tictactoe' | 'connect4' | 'reversi' | 'chess',
            first: a.first as 'user' | 'char' | 'random' | 'default',
            level: a.level as 'easy' | 'normal' | 'hard' | 'default'
          })
          break
        case 'stopGame':
          push({ kind: 'stopGame' })
          break
        case 'playSound': {
          const name = expand('playSound', 'name', a.name as string).trim()
          if (name !== '') push({ kind: 'playSound', name })
          break
        }
        case 'setExpression': {
          // スロットが空なら(名前が決まっていないので)何もしない
          const name = expand('setExpression', 'name', a.name as string).trim()
          if (name !== '') push({ kind: 'setExpression', name, value: a.value as number, durationSec: a.durationSec as number })
          break
        }
        case 'applyPreset': {
          const name = expand('applyPreset', 'name', a.name as string).trim()
          if (name !== '') push({ kind: 'applyPreset', name, revertAfterSec: a.revertAfterSec as number, mode: a.mode === 'replace' ? 'replace' : 'overlay' })
          break
        }
        case 'revertPreset': {
          // 名前が空なら、ルールで重ねたセットすべて。スロットが空のときも、すべて外してしまわないよう、何もしない
          const raw = typeof a.name === 'string' ? a.name : ''
          const name = raw === '' ? '' : expand('revertPreset', 'name', raw).trim()
          if (raw === '' || name !== '') push({ kind: 'revertPreset', name })
          break
        }
        case 'resetLook':
          push({ kind: 'resetLook' })
          break
        case 'changeAffection':
          push({ kind: 'changeAffection', delta: a.delta as number })
          break
        case 'setMood':
          push({ kind: 'setMood', mood: a.mood as string, durationSec: a.durationSec as number })
          break
        case 'startState':
        {
          const preset = typeof a.preset === 'string' && a.preset !== '' ? expand('startState', 'preset', a.preset).trim() : ''
          push({
            kind: 'startState',
            name: a.name as string,
            durationSec: a.durationSec as number,
            ...(preset !== '' ? { preset, presetMode: a.presetMode === 'replace' ? ('replace' as const) : ('overlay' as const) } : {})
          })
        }
          break
        case 'endState':
          push({ kind: 'endState', name: a.name as string })
          break
        case 'setEmotion':
          push({ kind: 'setEmotion', name: a.name as string, value: a.value as number })
          break
        case 'changeEmotion':
          push({ kind: 'changeEmotion', name: a.name as string, delta: a.delta as number })
          break
        case 'showProp': {
          // 小道具の id・秒数は、スロットの値に展開する(id が空なら、何も出さない。秒数が数字でなければ、0=消すまで)
          const prop = expand('showProp', 'prop', a.prop as string).trim()
          if (prop === '') break
          const raw = typeof a.durationSec === 'string' ? Number(expandTemplate(a.durationSec, vars).trim()) : (a.durationSec as number)
          const durationSec = Number.isFinite(raw) ? Math.min(3600, Math.max(0, raw)) : 0
          push({ kind: 'showProp', prop: propId(prop), durationSec })
          break
        }
        case 'hideProp': {
          const prop = expand('hideProp', 'prop', a.prop as string).trim()
          if (prop !== '') push({ kind: 'hideProp', prop: propId(prop) })
          break
        }
        case 'showOverlay': {
          // 効果の名前が空(スロットを空にした)なら、何も出さない。範囲・色が空なら、既定(画面全体・効果の色)
          const effect = expand('showOverlay', 'effect', a.effect as string).trim()
          if (effect === '') break
          const scope = expand('showOverlay', 'scope', (a.scope as string | undefined) ?? 'screen').trim() || 'screen'
          const color = expand('showOverlay', 'color', (a.color as string | undefined) ?? '').trim()
          push({ kind: 'showOverlay', effect, scope, intensity: a.intensity as number, color, durationSec: a.durationSec as number })
          break
        }
        case 'hideOverlay':
          push({ kind: 'hideOverlay' })
          break
        case 'moveTo':
          push({ kind: 'moveTo', target: a.target as 'random' | 'left' | 'right' | 'center' | 'cursor', mode: a.mode === 'warp' ? 'warp' : 'walk' })
          break
        case 'stopMove':
          push({ kind: 'stopMove' })
          break
        default: {
          // スクリプト Mod のアクション: 宣言した定義に従って、パラメータの既定値を補い、変数(`{{message}}` など)を展開して、スクリプトへ渡す
          const type = a.action as string
          const def = this.registry.find('action', type)
          const slash = type.indexOf('/')
          if (!def || slash < 0) break
          const params: Record<string, unknown> = {}
          for (const p of def.params) {
            let v: unknown = a[p.name] ?? p.default
            if (v === undefined) continue
            if (p.template && typeof v === 'string') v = expandTemplate(v, vars)
            else if (p.template && Array.isArray(v)) v = v.map((x) => (typeof x === 'string' ? expandTemplate(x, vars) : x))
            params[p.name] = v
          }
          push({ kind: 'extension', modId: type.slice(0, slash), action: type.slice(slash + 1), params })
          break
        }
        case 'askAi': {
          const instruction = expand('askAi', 'instruction', String(a.instruction ?? '')).trim()
          if (instruction !== '') push({ kind: 'askAi', instruction: instruction.slice(0, 2000), save: a.save !== false })
          break
        }
        case 'say': {
          const text = this.pick(a.text as string[])
          const expanded = text === undefined ? '' : expand('say', 'text', text)
          if (expanded.trim() !== '') push({ kind: 'say', text: expanded })
          break
        }
      }
    }
    return out
  }
}
