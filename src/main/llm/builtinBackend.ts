import type { ChatMessage, ChatOptions, LlmBackend } from '../../shared/llm/types'
import type { WorkerHost } from './workerHost'

/** 内蔵LLM(node-llama-cpp)。モデルの読み込みと推論は WorkerHost(別プロセス)に任せる */
export class BuiltinBackend implements LlmBackend {
  private controller: AbortController | null = null

  constructor(
    private readonly host: WorkerHost,
    private readonly modelPath: string
  ) {}

  abort(): void {
    this.controller?.abort()
  }

  async *chat(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<string> {
    const controller = new AbortController()
    this.controller = controller
    opts.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    try {
      await this.host.ensureLoaded(this.modelPath)
      // 最初のチャンクが出る前に、「モデルが降ろされていた」「ワーカーが落ちた」で失敗したときだけ、読み込み直して 1 回やり直す
      // (本文が出たあとは、やり直さない。二重に返答しないため)
      for (let attempt = 0; ; attempt++) {
        let started = false
        try {
          for await (const piece of this.host.chat(messages, { ...opts, signal: controller.signal, modelPath: this.modelPath })) {
            started = true
            yield piece
          }
          return
        } catch (e) {
          if (started || attempt > 0 || controller.signal.aborted || !isRecoverable(e)) throw e
          this.host.forgetLoaded()
          await this.host.ensureLoaded(this.modelPath)
        }
      }
    } finally {
      if (this.controller === controller) this.controller = null
    }
  }
}

/** モデルが降ろされていた・推論プロセスが終了した、という失敗か(読み込み直せば、直る) */
export const isRecoverable = (e: unknown): boolean => e instanceof Error && /一時的に解放|読み込まれていません|推論プロセスが終了/.test(e.message)
