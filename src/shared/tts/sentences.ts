// 返答のストリーム(小さな断片が届く)を、読み上げ用の「文」に区切る純粋ロジック。
// 文が完成するたびに取り出して、合成・再生のキューへ積む(全文を待たない)。

/** 文の終わり(この文字の直後で区切る)。「…」は含めない(「えっと…」で止めると不自然) */
const TERMINATORS = new Set(['\u3002', '\uFF01', '\uFF1F', '!', '?', '\n', '.'])
/** 終わりの直後に付いていたら、一緒に含める閉じ括弧・記号 */
const TRAILERS = new Set(['\u300D', '\u300F', ')', '\uFF09', ']', '\u3011', '\u201D', '"', '\u301C', '~', '\uFF5E', '!', '?', '\uFF01', '\uFF1F', '\u3002'])
/** 区切りがないまま、この長さを超えたら、読点で区切る(長い文で、再生の開始が遅れないように) */
export const SOFT_LIMIT = 60
/** それでも区切れなければ、この長さで強制的に区切る */
export const HARD_LIMIT = 120

export class SentenceSplitter {
  private buf = ''

  /** 断片を足して、完成した文を(あれば)返す */
  push(delta: string): string[] {
    this.buf += delta
    const out: string[] = []
    for (;;) {
      const cut = this.findCut()
      if (cut === -1) break
      out.push(this.buf.slice(0, cut))
      this.buf = this.buf.slice(cut)
    }
    return out.map((s) => s.trim()).filter((s) => s !== '')
  }

  /** 残りを取り出す(返答の終わり) */
  flush(): string[] {
    const rest = this.buf.trim()
    this.buf = ''
    return rest === '' ? [] : [rest]
  }

  reset(): void {
    this.buf = ''
  }

  /** バッファの先頭から、最初の区切り位置(その位置までが1文)。区切れなければ -1 */
  private findCut(): number {
    const s = this.buf
    for (let i = 0; i < s.length; i++) {
      if (!TERMINATORS.has(s[i])) continue
      // 小数点・「3.5」のような半角のピリオドは、直後が数字なら区切らない
      if (s[i] === '.' && /\d/.test(s[i + 1] ?? '') && /\d/.test(s[i - 1] ?? '')) continue
      let j = i + 1
      // 終わりの記号が続く間は含める。まだ続くか分からない末尾(バッファの終わり)では、待つ
      while (j < s.length && TRAILERS.has(s[j])) j++
      if (j >= s.length && s[i] !== '\n') return -1 // 直後に「」」などが来るかもしれない。次の断片を待つ
      return j
    }
    if (s.length >= SOFT_LIMIT) {
      const comma = Math.max(s.lastIndexOf('\u3001'), s.lastIndexOf(','), s.lastIndexOf('\uFF0C'))
      if (comma > 0) return comma + 1
    }
    if (s.length >= HARD_LIMIT) return HARD_LIMIT
    return -1
  }
}
