// OpenAI互換のストリーミング応答(Server-Sent Events)を、テキストのデルタ列に変換する純粋ロジック。
// ネットワークから届くチャンクは行の途中で切れるので、バッファして行単位で処理する。

export interface SseResult {
  deltas: string[]
  done: boolean
}

export class SseDeltaParser {
  private buffer = ''
  private finished = false

  /** 受信した文字列を渡す。完成した行からデルタを取り出す。[DONE] を受けたら以降は無視する */
  push(chunk: string): SseResult {
    const deltas: string[] = []
    if (this.finished) return { deltas, done: true }
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? '' // 最後の未完成行は次回へ
    for (const line of lines) {
      const delta = this.parseLine(line)
      if (delta === DONE) {
        this.finished = true
        break
      }
      if (delta) deltas.push(delta)
    }
    return { deltas, done: this.finished }
  }

  /** ストリーム終了時に、改行なしで終わった最後の行を処理する */
  flush(): SseResult {
    const deltas: string[] = []
    if (!this.finished && this.buffer.trim()) {
      const delta = this.parseLine(this.buffer)
      if (delta === DONE) this.finished = true
      else if (delta) deltas.push(delta)
    }
    this.buffer = ''
    return { deltas, done: this.finished }
  }

  private parseLine(line: string): string | typeof DONE | null {
    if (!line.startsWith('data:')) return null // 空行・コメント(:)・event: などは無視
    const payload = line.slice(5).trim()
    if (payload === '') return null
    if (payload === '[DONE]') return DONE
    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      return null // 壊れた1行で全体を止めない
    }
    const obj = json as {
      error?: { message?: string } | string
      choices?: Array<{ delta?: { content?: unknown } }>
    }
    if (obj.error) {
      const msg = typeof obj.error === 'string' ? obj.error : (obj.error.message ?? 'LLMがエラーを返しました')
      throw new Error(msg)
    }
    // reasoning / reasoning_content(思考過程)は読み捨て、content だけを使う
    const content = obj.choices?.[0]?.delta?.content
    return typeof content === 'string' && content !== '' ? content : null
  }
}

const DONE = Symbol('done')

/**
 * Qwen3 などの思考モデルが content に混ぜる <think>…</think> を取り除く(吹き出しに出さない)。
 * タグはチャンクの途中で切れて届くので、タグかもしれない末尾は次回まで保留する。
 */
export class ThinkTagFilter {
  private pending = ''
  private inThink = false
  /** 思考ブロックを閉じた直後の空白・改行を捨てる */
  private skipLeadingWhitespace = false

  push(text: string): string {
    this.pending += text
    let out = ''
    for (;;) {
      if (this.inThink) {
        const end = this.pending.indexOf(CLOSE)
        if (end === -1) {
          this.pending = this.keepPossibleTag(this.pending, CLOSE)
          return out
        }
        this.pending = this.pending.slice(end + CLOSE.length)
        this.inThink = false
        this.skipLeadingWhitespace = true
        continue
      }
      const start = this.pending.indexOf(OPEN)
      if (start === -1) {
        const keep = this.possibleTagLength(this.pending, OPEN)
        out += this.emit(this.pending.slice(0, this.pending.length - keep))
        this.pending = this.pending.slice(this.pending.length - keep)
        return out
      }
      out += this.emit(this.pending.slice(0, start))
      this.pending = this.pending.slice(start + OPEN.length)
      this.inThink = true
    }
  }

  /** ストリーム終了時。タグではなかった保留分を吐き出す(思考中のまま終わった場合は捨てる) */
  flush(): string {
    const rest = this.inThink ? '' : this.emit(this.pending)
    this.pending = ''
    return rest
  }

  private emit(text: string): string {
    if (this.skipLeadingWhitespace) {
      text = text.replace(/^\s+/, '')
      if (text !== '') this.skipLeadingWhitespace = false
    }
    return text
  }

  /** text の末尾が tag の先頭部分と一致する長さ(タグが途中で切れている可能性) */
  private possibleTagLength(text: string, tag: string): number {
    for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
      if (text.endsWith(tag.slice(0, n))) return n
    }
    return 0
  }

  private keepPossibleTag(text: string, tag: string): string {
    return text.slice(text.length - this.possibleTagLength(text, tag))
  }
}

const OPEN = '<think>'
const CLOSE = '</think>'
