import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../shared/llm/types'
import type { WorkerEvent, WorkerRequest } from '../../shared/llm/workerProtocol'
import { WorkerError, WorkerHost, type WorkerChannel } from './workerHost'

/** 偽のワーカー: 受け取った要求に、設定した振る舞いで応答する */
class FakeWorker implements WorkerChannel {
  requests: WorkerRequest[] = []
  killed = false
  private onMsg: (e: WorkerEvent) => void = () => {}
  private onExitCb: (c: number | null) => void = () => {}
  behavior: { replies: string[]; crashAfterChunks?: number; errorOnLoad?: string; hang?: boolean } = { replies: ['こん', 'にちは'] }

  constructor() {
    setTimeout(() => this.onMsg({ type: 'ready' }), 0)
  }
  postMessage(m: WorkerRequest): void {
    this.requests.push(m)
    if (m.type === 'load') {
      setTimeout(() => {
        if (this.behavior.errorOnLoad) this.onMsg({ type: 'error', id: m.id, message: this.behavior.errorOnLoad })
        else this.onMsg({ type: 'loaded', id: m.id, gpu: 'metal', contextSize: 4096, loadMs: 5 })
      }, 1)
    } else if (m.type === 'chat') {
      if (this.behavior.hang) return
      let n = 0
      const tick = (): void => {
        if (this.aborted.has(m.id)) return this.onMsg({ type: 'done', id: m.id, aborted: true })
        const next = this.behavior.replies[n++]
        if (next === undefined) return this.onMsg({ type: 'done', id: m.id, aborted: false })
        this.onMsg({ type: 'chunk', id: m.id, text: next })
        if (this.behavior.crashAfterChunks === n) return this.onExitCb(137)
        setTimeout(tick, 3)
      }
      setTimeout(tick, 1)
    } else if (m.type === 'abort') this.aborted.add(m.id)
  }
  aborted = new Set<number>()
  onMessage(cb: (e: WorkerEvent) => void): void {
    this.onMsg = cb
  }
  onExit(cb: (c: number | null) => void): void {
    this.onExitCb = cb
  }
  kill(): void {
    this.killed = true
  }
}

const msgs: ChatMessage[] = [{ role: 'user', content: 'やあ' }]
const collect = async (it: AsyncIterable<string>): Promise<string[]> => {
  const out: string[] = []
  for await (const v of it) out.push(v)
  return out
}

describe('WorkerHost', () => {
  it('モデルを読み込んで会話を断片で受け取れる。同じモデルの再読み込みはしない', async () => {
    const w = new FakeWorker()
    const host = new WorkerHost(() => w)
    expect((await host.ensureLoaded('/m.gguf'))?.gpu).toBe('metal')
    expect(await host.ensureLoaded('/m.gguf')).toBeNull()
    expect(w.requests.filter((r) => r.type === 'load')).toHaveLength(1)
    expect(await collect(host.chat(msgs))).toEqual(['こん', 'にちは'])
  })

  it('別のモデルを指定すると読み込み直す', async () => {
    const w = new FakeWorker()
    const host = new WorkerHost(() => w)
    await host.ensureLoaded('/a.gguf')
    await host.ensureLoaded('/b.gguf')
    expect(w.requests.filter((r) => r.type === 'load')).toHaveLength(2)
  })

  it('読み込みの失敗は例外として返る', async () => {
    const w = new FakeWorker()
    w.behavior.errorOnLoad = 'out of memory'
    const host = new WorkerHost(() => w)
    await expect(host.ensureLoaded('/m.gguf')).rejects.toThrow('out of memory')
  })

  it('signal で中断すると、abort が送られ、そこまでの返答で正常終了する', async () => {
    const w = new FakeWorker()
    w.behavior.replies = Array.from({ length: 50 }, (_, i) => `${i},`)
    const host = new WorkerHost(() => w)
    await host.ensureLoaded('/m.gguf')
    const ac = new AbortController()
    const got: string[] = []
    for await (const t of host.chat(msgs, { signal: ac.signal })) {
      got.push(t)
      if (got.length === 3) ac.abort()
    }
    expect(got.length).toBeLessThan(50)
    expect(w.requests.some((r) => r.type === 'abort')).toBe(true)
  })

  it('読み手が途中でやめても、ワーカーの生成を止める', async () => {
    const w = new FakeWorker()
    w.behavior.replies = Array.from({ length: 50 }, (_, i) => `${i},`)
    const host = new WorkerHost(() => w)
    await host.ensureLoaded('/m.gguf')
    for await (const t of host.chat(msgs)) {
      void t
      break
    }
    expect(w.requests.some((r) => r.type === 'abort')).toBe(true)
  })

  it('ワーカーが落ちたら、会話は説明つきの例外になり、次の要求で再起動する', async () => {
    const workers: FakeWorker[] = []
    const host = new WorkerHost(() => {
      const w = new FakeWorker()
      if (workers.length === 0) w.behavior = { replies: ['a', 'b', 'c'], crashAfterChunks: 1 }
      workers.push(w)
      return w
    })
    await host.ensureLoaded('/m.gguf')
    await expect(collect(host.chat(msgs))).rejects.toBeInstanceOf(WorkerError)
    // 次の要求では新しいプロセスで読み込み直す
    await host.ensureLoaded('/m.gguf')
    expect(workers).toHaveLength(2)
    expect(await collect(host.chat(msgs))).toEqual(['こん', 'にちは']) // 再起動後の新しいワーカーは正常に応答する
  })

  it('dispose はプロセスを終了する', async () => {
    const w = new FakeWorker()
    const host = new WorkerHost(() => w)
    await host.ensureLoaded('/m.gguf')
    host.dispose()
    expect(w.killed).toBe(true)
  })
})

describe('ワーカーがモデルを降ろしたとき(アイドル解放)', () => {
  it('「unloaded」を受けると、読み込み済みの記録が消え、次の ensureLoaded で読み込み直す', async () => {
    const w = new FakeWorker()
    const host = new WorkerHost(() => w)
    await host.ensureLoaded('/m.gguf')
    expect(await host.ensureLoaded('/m.gguf')).toBeNull() // 読み込み済み
    ;(w as unknown as { onMsg: (e: WorkerEvent) => void }).onMsg({ type: 'unloaded' })
    expect((await host.ensureLoaded('/m.gguf'))?.gpu).toBe('metal')
    expect(w.requests.filter((r) => r.type === 'load')).toHaveLength(2)
  })

  it('会話の要求に、モデルのパスが載る(ワーカーが、降ろされていても、読み込み直せるように)', async () => {
    const w = new FakeWorker()
    const host = new WorkerHost(() => w)
    await collect(host.chat(msgs, { modelPath: '/m.gguf' }))
    expect(w.requests.find((r) => r.type === 'chat')).toMatchObject({ modelPath: '/m.gguf' })
  })

  it('forgetLoaded で、記録を捨てると、読み込み直す', async () => {
    const w = new FakeWorker()
    const host = new WorkerHost(() => w)
    await host.ensureLoaded('/m.gguf')
    host.forgetLoaded()
    await host.ensureLoaded('/m.gguf')
    expect(w.requests.filter((r) => r.type === 'load')).toHaveLength(2)
  })
})
