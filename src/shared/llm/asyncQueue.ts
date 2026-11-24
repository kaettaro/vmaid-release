/** push された値を for await で順に取り出せるキュー(コールバック型のストリームを AsyncIterable に変換する) */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiter: (() => void) | null = null
  private ended = false
  private error: unknown = null

  push(value: T): void {
    if (this.ended) return
    this.items.push(value)
    this.wake()
  }

  end(): void {
    this.ended = true
    this.wake()
  }

  fail(error: unknown): void {
    if (this.ended) return
    this.error = error
    this.ended = true
    this.wake()
  }

  private wake(): void {
    const w = this.waiter
    this.waiter = null
    w?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.items.length > 0) {
        yield this.items.shift() as T
        continue
      }
      if (this.ended) {
        if (this.error !== null) throw this.error
        return
      }
      await new Promise<void>((resolve) => (this.waiter = resolve))
    }
  }
}
