import { SseDeltaParser, ThinkTagFilter } from '../../shared/llm/sse'
import type { ChatMessage, ChatOptions, LlmBackend } from '../../shared/llm/types'

export interface OpenAICompatConfig {
  /** 正規化済みのベースURL(例: http://localhost:11434/v1) */
  baseUrl: string
  model: string
  apiKey?: string | null
}

/** 接続できない・モデルが無い等を、画面に出せる日本語の説明つきで投げるためのエラー */
export class LlmError extends Error {}

function headers(apiKey?: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) h['Authorization'] = `Bearer ${apiKey}`
  return h
}

/** 通信できなかったとき(fetch の例外)の説明。Ollama が起動していないケースが最多 */
export function describeNetworkError(e: unknown, baseUrl: string): string {
  const cause = (e as { cause?: { code?: string } })?.cause?.code
  if (cause === 'ECONNREFUSED' || cause === 'ENOTFOUND' || cause === 'ECONNRESET' || cause === 'UND_ERR_CONNECT_TIMEOUT') {
    return `LLMに接続できません(${baseUrl})。Ollama などが起動しているか、URLが正しいか確認してください。`
  }
  return `LLMとの通信に失敗しました: ${e instanceof Error ? e.message : String(e)}`
}

export async function describeHttpError(res: Response, model: string): Promise<string> {
  const body = (await res.text().catch(() => '')).slice(0, 300)
  if (res.status === 404) return `モデル「${model}」が見つかりません。Ollama なら \`ollama pull ${model}\` で取得してください。(${body})`
  if (res.status === 401 || res.status === 403) return 'APIキーが正しくないか、権限がありません。設定の LLM タブで確認してください。'
  return `LLMがエラーを返しました(HTTP ${res.status}): ${body}`
}

/** OpenAI互換の /chat/completions をストリーミングで呼ぶ。通信先は設定されたエンドポイントのみ */
export class OpenAICompatBackend implements LlmBackend {
  private controller: AbortController | null = null

  constructor(private readonly cfg: OpenAICompatConfig) {}

  abort(): void {
    this.controller?.abort()
  }

  async *chat(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<string> {
    const controller = new AbortController()
    this.controller = controller
    opts.signal?.addEventListener('abort', () => controller.abort(), { once: true })

    let res: Response
    try {
      res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: headers(this.cfg.apiKey),
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          stream: true,
          temperature: opts.temperature ?? 0.8,
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {})
        }),
        signal: controller.signal
      })
    } catch (e) {
      if (controller.signal.aborted) return
      throw new LlmError(describeNetworkError(e, this.cfg.baseUrl))
    }
    if (!res.ok) throw new LlmError(await describeHttpError(res, this.cfg.model))
    if (!res.body) throw new LlmError('LLMの応答が空でした')

    const parser = new SseDeltaParser()
    const think = new ThinkTagFilter()
    const decoder = new TextDecoder()
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const r = parser.push(decoder.decode(value, { stream: true }))
        for (const d of r.deltas) {
          const text = think.push(d)
          if (text) yield text
        }
        if (r.done) break
      }
      for (const d of parser.flush().deltas) {
        const text = think.push(d)
        if (text) yield text
      }
      const rest = think.flush()
      if (rest) yield rest
    } catch (e) {
      if (controller.signal.aborted) return // 中断は正常終了として扱う
      if (e instanceof LlmError) throw e
      // 通信そのものの失敗(切断など)は fetch/undici の TypeError。それ以外は、サーバーが返したエラー(SSE内の error など)
      throw new LlmError(
        e instanceof TypeError ? describeNetworkError(e, this.cfg.baseUrl) : `LLMがエラーを返しました: ${e instanceof Error ? e.message : String(e)}`
      )
    } finally {
      void reader.cancel().catch(() => {})
      if (this.controller === controller) this.controller = null
    }
  }
}
