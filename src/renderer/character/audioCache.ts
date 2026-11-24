/**
 * 音ファイルを、main から受け取ってデコードし、使った順に覚えておく(長い曲は大きいので、数を絞る)。
 * 読み出しは、main が、登録したファイルだけに限る。
 */
export class AudioCache {
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>()

  constructor(
    private readonly context: () => AudioContext,
    private readonly limit: number
  ) {}

  /** 覚えているものを返す(無ければ null)。使った順を更新する */
  peek(path: string): AudioBuffer | null {
    const b = this.buffers.get(path)
    if (!b) return null
    this.buffers.delete(path)
    this.buffers.set(path, b)
    return b
  }

  /** 読み込んでデコードする。読めない・デコードできないときは null */
  load(path: string): Promise<AudioBuffer | null> {
    const hit = this.peek(path)
    if (hit) return Promise.resolve(hit)
    const pending = this.loading.get(path)
    if (pending) return pending
    const task = (async (): Promise<AudioBuffer | null> => {
      try {
        const data = await window.vmaid.readAudio(path)
        if (!data) return null
        const buffer = await this.context().decodeAudioData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
        this.buffers.set(path, buffer)
        while (this.buffers.size > this.limit) this.buffers.delete(this.buffers.keys().next().value as string)
        return buffer
      } catch (e) {
        console.warn('[audio] 音ファイルを読み込めませんでした', path, e)
        return null
      } finally {
        this.loading.delete(path)
      }
    })()
    this.loading.set(path, task)
    return task
  }

  clear(): void {
    this.buffers.clear()
  }
}
