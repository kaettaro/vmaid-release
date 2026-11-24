// 内蔵LLMの推論ワーカー。Electron の utilityProcess として動く(開発・テスト時は通常の Node の子プロセスでも動く)。
// node-llama-cpp(llama.cpp)で GGUF を読み込み、会話をストリーミングで返す。
import { getLlama, LlamaChatSession, type Llama, type LlamaContext, type LlamaModel } from 'node-llama-cpp'
import { IDLE_UNLOAD_MS, type WorkerEvent, type WorkerRequest } from '../../shared/llm/workerProtocol'
import type { ChatMessage } from '../../shared/llm/types'

// --- 通信路: utilityProcess は process.parentPort、Node の fork は process.send / process.on('message') ---
type ParentPort = { postMessage(m: unknown): void; on(ev: 'message', cb: (e: { data: unknown }) => void): void }
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
const send = (e: WorkerEvent): void => {
  if (parentPort) parentPort.postMessage(e)
  else process.send?.(e)
}
const onMessage = (cb: (m: WorkerRequest) => void): void => {
  if (parentPort) parentPort.on('message', (e) => cb(e.data as WorkerRequest))
  else process.on('message', (m) => cb(m as WorkerRequest))
}

// --- 状態 ---
let llama: Llama | null = null
let model: LlamaModel | null = null
let context: LlamaContext | null = null
let loadedPath: string | null = null
let idleTimer: NodeJS.Timeout | null = null
/** 会話は1つずつ。新しい会話が来たら前のものを中断する */
let current: { id: number; controller: AbortController } | null = null
let queue: Promise<void> = Promise.resolve()

function touchIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  // アイドルの解放も、読み込み・会話と同じ列に並べる(会話の途中で、モデルを降ろさないように)
  idleTimer = setTimeout(() => {
    queue = queue.then(unload).catch(() => undefined)
  }, IDLE_UNLOAD_MS)
}

async function unload(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const had = model !== null
  await context?.dispose()
  await model?.dispose()
  context = null
  model = null
  loadedPath = null
  if (had) send({ type: 'unloaded' }) // ホストの記録も消してもらう(でないと、次の会話で、読み込みを省いてしまう)
}

/** 初回の生成は GPU カーネルの準備で数秒遅れるため、読み込み直後に1トークンだけ生成して先に済ませる */
async function warmUp(ctx: LlamaContext): Promise<void> {
  const sequence = ctx.getSequence()
  const session = new LlamaChatSession({ contextSequence: sequence })
  try {
    await session.prompt('こんにちは', { maxTokens: 1 })
  } catch {
    // ウォームアップの失敗は無視(本番の会話で改めてエラーになる)
  } finally {
    session.dispose()
    sequence.dispose()
  }
}

/** モデルを読み込む(同じモデルが読み込み済みなら、何もしない) */
async function ensureModel(modelPath: string): Promise<LlamaContext> {
  if (loadedPath !== modelPath || !model || !context) {
    await unload()
    llama ??= await getLlama()
    model = await llama.loadModel({ modelPath })
    // 文脈長は、モデルの最大(数十万トークン)ではなく、会話に必要な分だけ。メモリに合わせて自動で縮む
    context = await model.createContext({ contextSize: { min: 1024, max: 6144 } })
    loadedPath = modelPath
    await warmUp(context)
  }
  return context
}

async function load(id: number, modelPath: string): Promise<void> {
  const t0 = Date.now()
  const ctx = await ensureModel(modelPath)
  touchIdle()
  send({ type: 'loaded', id, gpu: llama?.gpu ?? false, contextSize: ctx.contextSize, loadMs: Date.now() - t0 })
}

/** [system?, ...user/assistant の履歴, 最後は user] を、チャットセッションの履歴と今回の発話に分ける */
function splitMessages(messages: ChatMessage[]): { history: Parameters<LlamaChatSession['setChatHistory']>[0]; prompt: string } {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user') throw new Error('最後のメッセージはユーザーの発話である必要があります')
  const history: Parameters<LlamaChatSession['setChatHistory']>[0] = []
  for (const m of messages.slice(0, -1)) {
    if (m.role === 'system') history.push({ type: 'system', text: m.content })
    else if (m.role === 'user') history.push({ type: 'user', text: m.content })
    else history.push({ type: 'model', response: [m.content] })
  }
  return { history, prompt: last.content }
}

async function chat(id: number, messages: ChatMessage[], temperature: number, maxTokens: number, modelPath?: string): Promise<void> {
  // 生成の最中に、アイドルの解放が走らないように、タイマーを止める(終わったら、また張る)
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  // モデルが降ろされていたら、要求に載っているモデルを、その場で読み込み直す(ホストの記録に頼らない)
  const ctx = modelPath ? await ensureModel(modelPath) : context
  if (!ctx) throw new Error('AI モデルが一時的に解放されていました。もう一度話しかけてください。')
  const controller = new AbortController()
  current = { id, controller }
  const sequence = ctx.getSequence()
  const session = new LlamaChatSession({ contextSequence: sequence })
  try {
    const { history, prompt } = splitMessages(messages)
    session.setChatHistory(history)
    await session.prompt(prompt, {
      temperature,
      maxTokens,
      signal: controller.signal,
      stopOnAbortSignal: true, // 中断しても、そこまでの返答を返して正常終了にする
      // 思考過程(thought セグメント)は吹き出しに出さない。本文だけを流す
      onResponseChunk: (chunk) => {
        if (chunk.type === undefined && chunk.text) send({ type: 'chunk', id, text: chunk.text })
      }
    })
    send({ type: 'done', id, aborted: controller.signal.aborted })
  } finally {
    session.dispose()
    sequence.dispose()
    if (current?.id === id) current = null
    touchIdle()
  }
}

function handle(req: WorkerRequest): void {
  switch (req.type) {
    case 'load':
      queue = queue.then(() => load(req.id, req.modelPath)).catch((e) => send({ type: 'error', id: req.id, message: describe(e) }))
      break
    case 'chat':
      current?.controller.abort() // 前の会話を中断(その会話の後始末が終わってから次を始める)
      queue = queue
        .then(() => chat(req.id, req.messages, req.temperature ?? 0.8, req.maxTokens ?? 400, req.modelPath))
        .catch((e) => send({ type: 'error', id: req.id, message: describe(e) }))
      break
    case 'abort':
      if (current?.id === req.id) current.controller.abort()
      break
    case 'unload':
      queue = queue.then(unload)
      break
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

onMessage(handle)
send({ type: 'ready' })
