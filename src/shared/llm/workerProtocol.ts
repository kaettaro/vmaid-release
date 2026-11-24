import type { ChatMessage } from './types'

// 内蔵LLMの推論ワーカー(別プロセス)とのメッセージ。重い推論でUIを固めないため、node-llama-cpp は別プロセスで動かす。

export type WorkerRequest =
  | { type: 'load'; id: number; modelPath: string }
  /** modelPath: 会話の前に、モデルが降ろされていたら、このモデルを読み込み直す(ホストが読み込み済みと思っていても、動くように) */
  | { type: 'chat'; id: number; messages: ChatMessage[]; temperature?: number; maxTokens?: number; modelPath?: string }
  | { type: 'abort'; id: number }
  | { type: 'unload' }

export type WorkerEvent =
  | { type: 'ready' }
  /** ワーカーが、モデルを降ろした(アイドル・unload)。ホストの「読み込み済み」の記録を消すため */
  | { type: 'unloaded' }
  | { type: 'loaded'; id: number; gpu: string | false; contextSize: number; loadMs: number }
  | { type: 'chunk'; id: number; text: string }
  | { type: 'done'; id: number; aborted: boolean }
  | { type: 'error'; id: number; message: string }

/** 使っていないモデルをメモリから降ろすまでの時間(ms)。メモリ8GBのPCでも他のアプリを圧迫しないように */
export const IDLE_UNLOAD_MS = 10 * 60 * 1000
