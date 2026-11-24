import { describe, expect, it } from 'vitest'
import { AsyncQueue } from './asyncQueue'

const collect = async <T>(q: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = []
  for await (const v of q) out.push(v)
  return out
}

describe('AsyncQueue', () => {
  it('push した順に取り出せ、end で終わる(先に積んでも後から積んでもよい)', async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    setTimeout(() => {
      q.push(2)
      q.push(3)
      q.end()
    }, 5)
    expect(await collect(q)).toEqual([1, 2, 3])
  })
  it('fail すると、積まれた分を返したあとに例外になる', async () => {
    const q = new AsyncQueue<string>()
    q.push('a')
    q.fail(new Error('boom'))
    const got: string[] = []
    await expect(
      (async () => {
        for await (const v of q) got.push(v)
      })()
    ).rejects.toThrow('boom')
    expect(got).toEqual(['a'])
  })
  it('end のあとの push は無視する', async () => {
    const q = new AsyncQueue<number>()
    q.end()
    q.push(1)
    expect(await collect(q)).toEqual([])
  })
})
