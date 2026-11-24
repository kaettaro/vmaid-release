// LLMバックエンドの抽象(SPEC 4章)。実装は OpenAICompatBackend(M3)と BuiltinBackend(M4)

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatOptions {
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
}

export interface LlmBackend {
  /** 応答テキストを断片(デルタ)で順に返す。中断は signal か abort() */
  chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string>
  abort(): void
}
