import { AsyncQueue } from '../../shared/llm/asyncQueue'
import type { ChatMessage, ChatOptions } from '../../shared/llm/types'
import type { WorkerEvent, WorkerRequest } from '../../shared/llm/workerProtocol'

/** ワーカープロセスとの通信路。Electron の utilityProcess と、テスト用の偽物を同じ形で扱う */
export interface WorkerChannel {
  postMessage(message: WorkerRequest): void
  onMessage(cb: (event: WorkerEvent) => void): void
  onExit(cb: (code: number | null) => void): void
  kill(): void
}

export class WorkerError extends Error {}

export interface LoadedInfo {
  gpu: string | false
  contextSize: number
  loadMs: number
}

/**
 * 内蔵LLMの推論ワーカーの管理。プロセスは最初に必要になったときに起動し、落ちたら次の要求で再起動する。
 * 読み込みと会話の要求を、idで対応づけて結果を返す。
 */
export class WorkerHost {
  private channel: WorkerChannel | null = null
  private nextId = 1
  private loaded: string | null = null
  private pendingLoads = new Map<number, { resolve: (i: LoadedInfo) => void; reject: (e: Error) => void }>()
  private chats = new Map<number, AsyncQueue<string>>()
  private activeChatId: number | null = null
  private ready: Promise<void> | null = null

  constructor(private readonly spawn: () => WorkerChannel) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready
    const channel = this.spawn()
    this.channel = channel
    this.ready = new Promise<void>((resolve) => {
      channel.onMessage((e) => {
        if (e.type === 'ready') resolve()
        else this.route(e)
      })
    })
    channel.onExit((code) => this.handleExit(channel, code))
    return this.ready
  }

  private handleExit(channel: WorkerChannel, code: number | null): void {
    if (this.channel !== channel) return
    const err = new WorkerError(`推論プロセスが終了しました(コード ${code ?? '不明'})。メモリ不足の可能性があります。`)
    this.channel = null
    this.ready = null
    this.loaded = null
    this.activeChatId = null
    for (const p of this.pendingLoads.values()) p.reject(err)
    this.pendingLoads.clear()
    for (const q of this.chats.values()) q.fail(err)
    this.chats.clear()
  }

  private route(e: WorkerEvent): void {
    switch (e.type) {
      case 'unloaded':
        this.loaded = null // ワーカーが、アイドルなどで、モデルを降ろした
        break
      case 'loaded':
        this.pendingLoads.get(e.id)?.resolve({ gpu: e.gpu, contextSize: e.contextSize, loadMs: e.loadMs })
        this.pendingLoads.delete(e.id)
        break
      case 'chunk':
        this.chats.get(e.id)?.push(e.text)
        break
      case 'done':
        this.chats.get(e.id)?.end()
        this.chats.delete(e.id)
        if (this.activeChatId === e.id) this.activeChatId = null
        break
      case 'error': {
        const err = new WorkerError(e.message)
        const load = this.pendingLoads.get(e.id)
        if (load) {
          load.reject(err)
          this.pendingLoads.delete(e.id)
        }
        this.chats.get(e.id)?.fail(err)
        this.chats.delete(e.id)
        if (this.activeChatId === e.id) this.activeChatId = null
        break
      }
    }
  }

  /** モデルを読み込む(読み込み済みなら何もしない)。会話の前に呼ぶ。入力中に先に呼んでおくと待ち時間を隠せる */
  async ensureLoaded(modelPath: string): Promise<LoadedInfo | null> {
    await this.start()
    if (this.loaded === modelPath) return null
    const id = this.nextId++
    const done = new Promise<LoadedInfo>((resolve, reject) => this.pendingLoads.set(id, { resolve, reject }))
    this.channel!.postMessage({ type: 'load', id, modelPath })
    const info = await done
    this.loaded = modelPath
    return info
  }

  /** 会話。応答のテキストを断片で返す。signal で中断すると、そこまでの返答で正常終了する */
  async *chat(messages: ChatMessage[], opts: ChatOptions & { modelPath?: string } = {}): AsyncIterable<string> {
    await this.start()
    const id = this.nextId++
    const queue = new AsyncQueue<string>()
    this.chats.set(id, queue)
    this.activeChatId = id
    const abort = (): void => this.channel?.postMessage({ type: 'abort', id })
    opts.signal?.addEventListener('abort', abort, { once: true })
    this.channel!.postMessage({ type: 'chat', id, messages, temperature: opts.temperature, maxTokens: opts.maxTokens, modelPath: opts.modelPath })
    try {
      yield* queue
    } finally {
      opts.signal?.removeEventListener('abort', abort)
      // 呼び出し側が途中で読むのをやめた場合も、ワーカーの生成を止める
      if (this.chats.has(id)) {
        abort()
        this.chats.delete(id)
      }
    }
  }

  /** 「読み込み済み」の記録を捨てる(次の ensureLoaded で、読み込み直す)。ワーカーとの食い違いが分かったとき用 */
  forgetLoaded(): void {
    this.loaded = null
  }

  abortActive(): void {
    if (this.activeChatId !== null) this.channel?.postMessage({ type: 'abort', id: this.activeChatId })
  }

  /** メモリを空ける(モデルを降ろす)。プロセスは残す */
  unload(): void {
    this.channel?.postMessage({ type: 'unload' })
    this.loaded = null
  }

  dispose(): void {
    const ch = this.channel
    this.channel = null
    this.ready = null
    this.loaded = null
    ch?.kill()
  }
}
