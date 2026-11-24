import { safeStorage } from 'electron'
import { normalizeBaseUrl, pickDefaultModel } from '../shared/llm/endpoint'
import { EMOTION_TAG_PROMPT, EmotionTagFilter, stripEmotionTags } from '../shared/llm/emotionTag'
import { buildMessages, buildSystemPrompt, HIDDEN_NOTE, hiddenPrompt } from '../shared/llm/prompt'
import { stripPictographs } from '../shared/llm/text'
import { isLoopbackEndpoint, normalizeTtsEndpoint } from '../shared/tts/voicevox'
import type { ChatMessage } from '../shared/llm/types'
import { IPC } from '../shared/ipc'
import type { LlmTestResult, SettingsPatch, SettingsUpdateResult, SettingsView } from '../shared/settingsApi'
import type { LlmBackend } from '../shared/llm/types'
import { BuiltinBackend } from './llm/builtinBackend'
import { describeHttpError, describeNetworkError, LlmError, OpenAICompatBackend } from './llm/openAICompatBackend'
import type { WorkerHost } from './llm/workerHost'
import type { CharacterBook } from './characterBook'
import type { HistoryStore } from './history/historyStore'
import type { ModelManager } from './models/modelManager'
import type { SettingsStore } from './settingsStore'

/** 文脈(システムプロンプト+履歴)の概算トークン上限。小型モデルの既定コンテキストに余裕をもって収める */
const TOKEN_BUDGET = 3000
const TEST_TIMEOUT_MS = 8000

type Send = (channel: string, payload?: unknown) => void

const llmEnabled = (store: SettingsStore): boolean => store.get().history.enabled

/** 準備の途中でユーザーが中断した(エラーではない) */
const ABORTED = Symbol('aborted')

/**
 * 会話の実行役。設定を読んでバックエンドを作り、ストリームをキャラウィンドウへ中継する。
 * 履歴はいまはメモリ上のみ(M5で履歴ストアに置き換える。ここが境界)。
 */
export class ChatService {
  private history: ChatMessage[] = []
  /** ディスクの履歴を文脈へ取り込み済みか(最初の会話の前に1回だけ読む) */
  private historyLoaded = false
  /** いまメモリ上の文脈が、どのキャラとの会話か(キャラを切り替えたら作り直す) */
  private historyCharacterId: string | null = null
  private backend: LlmBackend | null = null
  /** 内蔵モデルのダウンロード待ちを中断するための印 */
  private preparing = 0
  /** 会話の通し番号。abort のたびに進む(履歴の読み込み中などに中断されたかを、あとで確かめるため) */
  private chatSeq = 0

  constructor(
    private readonly store: SettingsStore,
    private readonly send: Send,
    private readonly models: ModelManager,
    private readonly worker: WorkerHost,
    private readonly historyStore: HistoryStore,
    private readonly book: CharacterBook,
    /** 有効な Mod の、会話の指示文の断片(性格 → 状態の順) */
    private readonly modPrompts: (activeStates: ReadonlySet<string>) => string[] = () => []
  ) {}

  // --- APIキー(safeStorage。平文は保存しない) ---
  private readApiKey(): string | null {
    const enc = this.store.get().llm.apiKeyEnc
    if (!enc || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  // --- 会話 ---
  /** 会話(または裏の指示)を実行中の数。裏の指示は、ユーザーの会話を邪魔しないよう、何かが実行中なら始めない */
  private running = 0

  /**
   * @param hidden 裏の指示(ルールの「AI に頼んで言う」)。ユーザーの発話ではなく、指示を、AI へ渡す。
   *   ユーザーの吹き出しは出さず、指示は履歴に残さず、返答だけを、通常と同じ経路で出す(save なら、返答を文脈に残す)。
   *   他の会話が実行中なら、何もしない。準備ができていない・失敗したときは、黙って終わる(ダウンロード・同意の確認は出さない)
   */
  async chat(text: string, activeStates: ReadonlySet<string> = new Set(), hidden?: { save: boolean }): Promise<void> {
    if (hidden && this.running > 0) return
    this.running++
    try {
      await this.run(text, activeStates, hidden)
    } finally {
      this.running--
    }
  }

  private async run(text: string, activeStates: ReadonlySet<string>, hidden?: { save: boolean }): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    this.abort()
    const seq = this.chatSeq

    const { llm } = this.store.get()
    const character = this.book.active() // この会話のキャラ(話し方・履歴はキャラごと)
    let backend: LlmBackend
    try {
      const prepared = llm.backend === 'builtin' ? await this.prepareBuiltin(hidden !== undefined) : await this.prepareOpenAI()
      if (prepared === ABORTED) {
        this.send(IPC.chatDone, { text: '', aborted: true }) // 準備中に中断された: 「考え中」の表示を終わらせる
        return
      }
      if (!prepared) return // エラーは表示済み(同意されなかった等)
      backend = prepared
    } catch (e) {
      this.send(IPC.chatError, e instanceof LlmError ? e.message : `会話の準備に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
      return
    }

    await this.loadHistory(character.id)
    if (this.chatSeq !== seq) {
      this.send(IPC.chatDone, { text: '', aborted: true }) // 履歴を読んでいる間に、中断された(Esc など)
      return
    }
    const startedAt = Date.now()
    if (!hidden) this.history.push({ role: 'user', content: trimmed })
    // Mod「状態と感情」が ON のときだけ、AI に感情タグ([emotion:名前])を頼み、返答から取り除いて、ルール(トリガー「AI が感情を表したとき」)へ渡す
    // 「吹き出し拡張」で感情による変化を使うときも、AI に感情タグを頼む(取り除いて、吹き出しへ渡す)
    const features = this.store.get().mods.features
    const emotionOn = features.includes('emotion-state') || (features.includes('bubble-style') && this.store.get().bubble.emotion.enabled)
    const modLayers = this.modPrompts(activeStates)
    const layers = emotionOn ? [...modLayers, EMOTION_TAG_PROMPT] : modLayers
    const messages = buildMessages(buildSystemPrompt(character, layers), hidden ? [...this.history, { role: 'user', content: hiddenPrompt(trimmed) }] : this.history, {
      maxTurns: llm.maxTurns,
      tokenBudget: TOKEN_BUDGET
    })
    this.backend = backend

    let reply = ''
    const emit = (raw: string): void => {
      // 返答の最初にある感情タグを取り除いたあとの、先頭の空白・改行は出さない
      const piece = reply === '' ? raw.trimStart() : raw
      if (!piece) return
      if (reply === '') this.send(IPC.chatPrep, null) // 最初の文字が来たら、準備中の表示を消す
      reply += piece
      this.send(IPC.chatChunk, piece)
    }
    // Mod が OFF でも、感情タグ(`[joy]` など)は画面・履歴に出さず取り除く(ルールへは、ON のときだけ渡す)
    const tagFilter = new EmotionTagFilter()
    try {
      for await (const raw of backend.chat(messages)) {
        let delta = stripPictographs(raw) // 絵文字は吹き出しに出さない(どの方式でも保証する)
        const r = tagFilter.push(delta)
        delta = r.text
        if (emotionOn) for (const tag of r.tags) this.send(IPC.chatEmotion, tag)
        for (const pose of r.poses) this.send(IPC.chatPose, pose) // 動きの指定は、ルールが受ける(受けるルールが無ければ、何も起きない)
        emit(delta)
      }
      emit(tagFilter.flush().text)
      if (reply && hidden) {
        // 裏の指示: 指示は残さない。返答は、save なら、目印のユーザー側の 1 行と一緒に文脈へ、ディスクの履歴には返答だけを残す
        if (hidden.save) {
          this.history.push({ role: 'user', content: HIDDEN_NOTE }, { role: 'assistant', content: reply })
          if (llmEnabled(this.store)) void this.historyStore.append([{ ts: Date.now(), role: 'assistant', text: reply, characterId: character.id }])
        }
      } else if (reply) {
        this.history.push({ role: 'assistant', content: reply })
        // 成功した(返答が1文字以上ある)やりとりだけを保存する。失敗や空の返答は残さない
        if (llmEnabled(this.store)) {
          void this.historyStore.append([
            { ts: startedAt, role: 'user', text: trimmed, characterId: character.id },
            { ts: Date.now(), role: 'assistant', text: reply, characterId: character.id }
          ])
        }
      }
      this.send(IPC.chatDone, { text: reply, aborted: this.backend !== backend })
    } catch (e) {
      this.send(IPC.chatPrep, null)
      // 失敗した発話は履歴から外す(再送で二重にならないように)。裏の指示は、履歴に積んでいない
      if (!hidden) this.history.pop()
      this.send(IPC.chatError, e instanceof LlmError ? e.message : `会話に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (this.backend === backend) this.backend = null
    }
  }

  /** サーバーのモデル一覧から使うものを選ぶ。選べなければ、次の行動が分かる説明つきで LlmError */
  private async autoSelectModel(baseUrl: string): Promise<string> {
    let res: Response
    try {
      const key = this.readApiKey()
      res = await fetch(`${baseUrl}/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS)
      })
    } catch (e) {
      throw new LlmError(describeNetworkError(e, baseUrl))
    }
    if (!res.ok) throw new LlmError(await describeHttpError(res, '(自動選択)'))
    const body = (await res.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null
    const ids = (body?.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string')
    const picked = pickDefaultModel(ids)
    if (!picked) {
      throw new LlmError('LLMにチャットできるモデルがありません。Ollama なら `ollama pull qwen3:4b-instruct` などで取得してください。')
    }
    return picked
  }

  abort(): void {
    this.chatSeq++
    this.preparing++ // 準備中(ダウンロード待ち)の会話は、続きを実行しない
    this.models.cancelDownload()
    const b = this.backend
    this.backend = null // 中断済みの印(chat() 側の aborted 判定に使う)
    b?.abort()
    this.send(IPC.chatPrep, null)
  }

  /** OpenAI互換(Ollama等)のバックエンドを作る。モデル名が空ならサーバーから自動で選ぶ */
  private async prepareOpenAI(): Promise<LlmBackend | null | typeof ABORTED> {
    const { llm } = this.store.get()
    const baseUrl = normalizeBaseUrl(llm.baseUrl)
    if (!baseUrl) {
      this.send(IPC.chatError, 'LLMのURLが正しくありません。右クリック →「設定を開く」→ LLM タブで確認してください。')
      return null
    }
    const model = llm.model.trim() || (await this.autoSelectModel(baseUrl))
    return new OpenAICompatBackend({ baseUrl, model, apiKey: this.readApiKey() })
  }

  /** 内蔵LLMのバックエンドを作る。モデルが無ければ、同意を取ってダウンロードしてから進む */
  private async prepareBuiltin(silent = false): Promise<LlmBackend | null | typeof ABORTED> {
    const token = ++this.preparing
    let resolved = await this.models.resolve()
    if (resolved.kind === 'missing' && silent) return null // 裏の指示では、ダウンロード・同意の確認は出さない
    if (resolved.kind === 'missing') {
      this.send(IPC.chatPrep, { phase: 'downloading', fraction: 0 })
      const unsubscribe = this.models.onDownloadStatus((s) => {
        if (s) this.send(IPC.chatPrep, s.phase === 'verifying' ? { phase: 'verifying' } : { phase: 'downloading', fraction: s.fraction })
      })
      const result = await this.models.download(resolved.entry)
      unsubscribe()
      this.send(IPC.chatPrep, null)
      if (token !== this.preparing) return ABORTED // ダウンロード中にユーザーが中断した(Esc など)
      if (result === null) {
        this.send(IPC.chatError, 'AIモデルのダウンロードがキャンセルされました。もう一度話しかけると、ダウンロードの確認を出します。')
        return null
      }
      if ('error' in result) {
        this.send(IPC.chatError, result.error)
        return null
      }
      resolved = await this.models.resolve()
    }
    if (resolved.kind !== 'installed') return null
    if (token !== this.preparing) return ABORTED
    this.send(IPC.chatPrep, { phase: 'loading' })
    return new BuiltinBackend(this.worker, resolved.path)
  }

  /** 入力欄を開いたとき: 内蔵モデルが入っていれば、入力している間に先に読み込んでおく(ダウンロードはしない) */
  async prepare(): Promise<void> {
    if (this.store.get().llm.backend !== 'builtin') return
    try {
      const resolved = await this.models.resolve()
      if (resolved.kind === 'installed') await this.worker.ensureLoaded(resolved.path)
    } catch (e) {
      // 先読みの失敗は、画面には出さない(実際の会話のときにエラーとして表示する)。原因調べのため、ログには残す
      console.warn('[llm] モデルの先読みに失敗しました', e)
    }
  }

  /** 起動後の最初の会話の前に、保存済みの直近の会話を文脈に取り込む(再起動しても話の続きができる) */
  private async loadHistory(characterId: string): Promise<void> {
    // キャラが変わったら、メモリ上の文脈は、そのキャラとの会話で作り直す(別のキャラの会話を引きずらない)
    if (this.historyCharacterId !== characterId) {
      this.history = []
      this.historyLoaded = false
      this.historyCharacterId = characterId
    }
    if (this.historyLoaded) return
    this.historyLoaded = true
    try {
      const recent = await this.historyStore.readRecentTurns(this.store.get().llm.maxTurns, characterId)
      this.history = [...recent.map((e): ChatMessage => ({ role: e.role, content: e.role === 'assistant' ? stripEmotionTags(e.text) : e.text })), ...this.history]
    } catch {
      // 履歴が読めなくても会話は始められる
    }
  }

  /**
   * メモリ上の文脈を捨てる(保存済みの履歴を削除したとき)。
   * 次の会話の前に、ディスクに残っている履歴から文脈を作り直す(全削除なら空、古い分だけの削除なら直近の会話が残る)。
   * ※ 履歴の保存をオフにしている間のやりとりは、ディスクに無いので、ここで文脈から消える。
   */
  resetContext(): void {
    this.history = []
    this.historyLoaded = false
  }

  // --- 接続テスト: GET /models で到達性とモデルの有無を確認 ---
  async test(): Promise<LlmTestResult> {
    const { llm } = this.store.get()
    const baseUrl = normalizeBaseUrl(llm.baseUrl)
    if (!baseUrl) return { ok: false, message: 'URLの形式が正しくありません(例: http://localhost:11434/v1)' }
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: this.readApiKey() ? { Authorization: `Bearer ${this.readApiKey()}` } : {},
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS)
      })
      if (!res.ok) return { ok: false, message: await describeHttpError(res, llm.model) }
      const body = (await res.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null
      const ids = (body?.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string')
      if (!llm.model.trim()) {
        return { ok: true, message: `接続できました。使えるモデル: ${ids.join(', ') || '(なし)'}。モデル名を入力してください。` }
      }
      // Ollama は "qwen3:4b" と "qwen3:4b:latest" のように表記が揺れるため、前方一致で見る
      const found = ids.some((id) => id === llm.model || id.startsWith(`${llm.model}:`))
      return found
        ? { ok: true, message: `接続できました。モデル「${llm.model}」が使えます。` }
        : { ok: false, message: `接続できましたが、モデル「${llm.model}」がありません。使えるモデル: ${ids.join(', ') || '(なし)'}` }
    } catch (e) {
      return { ok: false, message: describeNetworkError(e, baseUrl) }
    }
  }

  // --- 設定ウィンドウ向け ---
  view(): SettingsView {
    const { llm, activeCharacterId } = this.store.get()
    return {
      llm: { backend: llm.backend, baseUrl: llm.baseUrl, model: llm.model, maxTurns: llm.maxTurns, hasApiKey: llm.apiKeyEnc !== null },
      characters: this.book.views(),
      activeCharacterId,
      history: { enabled: this.store.get().history.enabled },
      tts: { ...this.store.get().tts, endpointIsLoopback: isLoopbackEndpoint(this.store.get().tts.endpoint) },
      secureStorageAvailable: safeStorage.isEncryptionAvailable()
    }
  }

  update(patch: SettingsPatch): SettingsUpdateResult {
    const errors: string[] = []
    this.store.update((s) => {
      if (patch.llm) {
        const { baseUrl, ...rest } = patch.llm
        Object.assign(s.llm, rest)
        if (baseUrl !== undefined) {
          const normalized = normalizeBaseUrl(baseUrl)
          if (normalized) s.llm.baseUrl = normalized
          else errors.push('URLの形式が正しくありません。(例: http://localhost:11434/v1)')
        }
      }
      if (patch.history) Object.assign(s.history, patch.history)
      if (patch.tts) {
        const { endpoint, ...rest } = patch.tts
        Object.assign(s.tts, rest)
        if (endpoint !== undefined) {
          const normalized = normalizeTtsEndpoint(endpoint)
          if (normalized) s.tts.endpoint = normalized
          else errors.push('音声合成エンジンのURLの形式が正しくありません。(例: http://127.0.0.1:50021)')
        }
      }
      if (patch.apiKey !== undefined) {
        if (!patch.apiKey) s.llm.apiKeyEnc = null
        else if (safeStorage.isEncryptionAvailable()) s.llm.apiKeyEnc = safeStorage.encryptString(patch.apiKey).toString('base64')
        else errors.push('この環境ではOSの安全な保管庫が使えないため、APIキーは保存できません。')
      }
    })
    return { view: this.view(), errors }
  }
}
