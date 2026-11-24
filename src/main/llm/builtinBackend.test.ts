import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../shared/llm/types'
import { BuiltinBackend, isRecoverable } from './builtinBackend'
import type { WorkerHost } from './workerHost'

const msgs: ChatMessage[] = [{ role: 'user', content: 'やあ' }]

/** 偽のホスト: chat を、順に、設定した振る舞いで返す */
function fakeHost(plans: Array<{ pieces: string[]; failAt?: number; error?: string }>) {
  const calls = { ensure: 0, forget: 0, chat: 0 }
  const host = {
    ensureLoaded: async () => void calls.ensure++,
    forgetLoaded: () => void calls.forget++,
    chat: async function* () {
      const plan = plans[calls.chat++]
      for (let i = 0; i < plan.pieces.length; i++) {
        if (plan.failAt === i) throw new Error(plan.error ?? 'x')
        yield plan.pieces[i]
      }
      if (plan.failAt === plan.pieces.length) throw new Error(plan.error ?? 'x')
    }
  } as unknown as WorkerHost
  return { host, calls }
}
const collect = async (it: AsyncIterable<string>): Promise<string[]> => {
  const out: string[] = []
  for await (const v of it) out.push(v)
  return out
}

describe('BuiltinBackend: モデルが降ろされていたときの、やり直し', () => {
  it('最初のチャンクの前に「解放されていた」で失敗したら、読み込み直して 1 回だけ、やり直す', async () => {
    const { host, calls } = fakeHost([{ pieces: [], failAt: 0, error: 'AI モデルが一時的に解放されていました。' }, { pieces: ['こん', 'にちは'] }])
    const out = await collect(new BuiltinBackend(host, '/m.gguf').chat(msgs))
    expect(out).toEqual(['こん', 'にちは'])
    expect(calls).toEqual({ ensure: 2, forget: 1, chat: 2 })
  })

  it('やり直しても失敗するなら、そのエラーを返す(無限にやり直さない)', async () => {
    const { host, calls } = fakeHost([{ pieces: [], failAt: 0, error: 'モデルが読み込まれていません' }, { pieces: [], failAt: 0, error: 'モデルが読み込まれていません' }])
    await expect(collect(new BuiltinBackend(host, '/m.gguf').chat(msgs))).rejects.toThrow('モデルが読み込まれていません')
    expect(calls.chat).toBe(2)
  })

  it('本文が出たあとの失敗は、やり直さない(二重に返答しない)。関係のない失敗も、やり直さない', async () => {
    const a = fakeHost([{ pieces: ['こん'], failAt: 1, error: '推論プロセスが終了しました' }])
    await expect(collect(new BuiltinBackend(a.host, '/m.gguf').chat(msgs))).rejects.toThrow('推論プロセス')
    expect(a.calls.chat).toBe(1)
    const b = fakeHost([{ pieces: [], failAt: 0, error: 'メモリが足りません' }])
    await expect(collect(new BuiltinBackend(b.host, '/m.gguf').chat(msgs))).rejects.toThrow('メモリ')
    expect(b.calls.chat).toBe(1)
  })

  it('やり直す失敗の判定', () => {
    expect(isRecoverable(new Error('AI モデルが一時的に解放されていました'))).toBe(true)
    expect(isRecoverable(new Error('モデルが読み込まれていません'))).toBe(true)
    expect(isRecoverable(new Error('推論プロセスが終了しました(コード 137)'))).toBe(true)
    expect(isRecoverable(new Error('out of memory'))).toBe(false)
    expect(isRecoverable('x')).toBe(false)
  })
})
