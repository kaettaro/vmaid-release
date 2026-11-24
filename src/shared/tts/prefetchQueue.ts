// 読み上げのキュー: 文を順番に再生しながら、次の文の合成を先に進める(再生の切れ目を短くする)。
// 合成・再生は注入された関数。キャンセル(cancel)で、待ち行列と、進行中の結果を捨てる。純粋なので、偽の関数でテストできる。

export interface PrefetchQueueOptions<T> {
  /** 文を音声にする(通信・合成)。失敗したら reject(その文は飛ばして続ける) */
  synth: (text: string, signal: AbortSignal) => Promise<T>
  /** 音声を再生して、終わったら resolve。signal が abort されたら、すぐ止めて resolve する */
  play: (audio: T, signal: AbortSignal) => Promise<void>
  /** 先読みする数(再生中の文を除く)。既定 2 */
  ahead?: number
  /** 待ち行列の上限。超えた分は、古い文から捨てる。既定 12 */
  maxPending?: number
  onError?: (error: unknown, text: string) => void
  /** 再生中の文があるか、待ち行列が空になったとき(true=忙しい / false=空) */
  onBusyChange?: (busy: boolean) => void
}

interface Item<T> {
  text: string
  result: Promise<T | null>
}

export class PrefetchQueue<T> {
  private items: Item<T>[] = []
  private running = false
  private ctl = new AbortController()
  private busy = false
  private readonly ahead: number
  private readonly maxPending: number

  constructor(private readonly o: PrefetchQueueOptions<T>) {
    this.ahead = o.ahead ?? 2
    this.maxPending = o.maxPending ?? 12
  }

  get isBusy(): boolean {
    return this.busy
  }

  enqueue(text: string): void {
    if (text.trim() === '') return
    const signal = this.ctl.signal
    const item: Item<T> = { text, result: Promise.resolve(null) }
    this.items.push(item)
    while (this.items.length > this.maxPending) this.items.shift() // 古い文を捨てる(追いつけないとき)
    this.prefetch(signal)
    this.setBusy(true)
    void this.run()
  }

  /** 待ち行列を空にして、進行中の合成・再生を止める */
  cancel(): void {
    this.ctl.abort()
    this.ctl = new AbortController()
    this.items = []
    this.running = false
    this.setBusy(false)
  }

  /** 合成を始めていない文を、先読みの数まで進める */
  private started = new WeakSet<Item<T>>()
  private prefetch(signal: AbortSignal): void {
    for (const item of this.items.slice(0, this.ahead + 1)) {
      if (this.started.has(item)) continue
      this.started.add(item)
      item.result = this.o.synth(item.text, signal).catch((e) => {
        if (!signal.aborted) this.o.onError?.(e, item.text)
        return null
      })
    }
  }

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    const signal = this.ctl.signal
    while (!signal.aborted && this.items.length > 0) {
      this.prefetch(signal)
      const item = this.items[0]
      const audio = await item.result
      if (signal.aborted) return // cancel 済み(running は cancel 側で戻っている)
      // 待っている間に、上限で捨てられた文は、再生しない
      const index = this.items.indexOf(item)
      if (index === -1) continue
      this.items.splice(index, 1)
      if (audio !== null) {
        try {
          await this.o.play(audio, signal)
        } catch (e) {
          if (!signal.aborted) this.o.onError?.(e, item.text)
        }
      }
    }
    if (!signal.aborted) {
      this.running = false
      this.setBusy(false)
    }
  }

  private setBusy(b: boolean): void {
    if (this.busy === b) return
    this.busy = b
    this.o.onBusyChange?.(b)
  }
}
