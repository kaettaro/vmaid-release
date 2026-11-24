// AI の返答に付く感情タグ `[emotion:名前]` を、画面に出す文字から取り除き、タグだけ取り出す(Mod「状態と感情」)。
// 返答はストリーム(断片)で届くので、タグが断片をまたいでも、取り逃がさない(途中まで届いた `[emo` は、次の断片まで持ち越す)。
// モデルは、頼んだ形(`[emotion:joy]`)を守らず、`[joy]` `[shy]` `[emotion: joy]` `【joy】` などで出すことがあるので、これらも取り除く。
// 接頭辞のない形(`[joy]`)は、よく使われる感情名のときだけ取り除く(`[メモ]` のような、ふつうの括弧は残す)。
// 同じ仕組みで、動きの指定タグ `[pose:両手を上げて喜ぶ]` も取り除いて、取り出す(Mod「会話中に自動でポーズ」が、AI に頼む)。
// 純粋ロジック(Electron 非依存)。

/** AI へのお願い(Mod「状態と感情」が ON のときだけ、指示文に足す) */
export const EMOTION_TAG_PROMPT =
  '返答の一番最初に、そのときの感情を [emotion:名前] の形で1つだけ付けてもよい(名前は joy / sad / angry / shy / surprised のいずれか。例: [emotion:joy]やったね!)。必ずこの形だけを使い、[joy] のような短い形や、ほかの書き方は使わない。タグは、ユーザーには表示されない。感情がはっきりしないときは、付けない。'

const MAX_NAME = 24
/** 動きの指定(`[pose:…]`)の説明の長さの上限 */
const MAX_POSE = 100
/** 接頭辞なし(`[joy]`)でも、感情タグとして取り除く名前(小文字) */
const KNOWN_NAMES = ['joy', 'sad', 'angry', 'shy', 'surprised', 'happy', 'love', 'embarrassed', 'excited', 'calm', 'neutral', 'fear', 'sleepy', 'proud'] as const
const KNOWN = new Set<string>(KNOWN_NAMES)

const OPEN = /^[[【]/
/** `[emotion:名前]` `[emotion: 名前]` `[emotion=名前]`(全角の括弧・コロンも可)。名前は何でもよい */
const FULL_PREFIXED = /^[[【]\s*emotion\s*[:：=]\s*([^\]】\n]{1,24}?)\s*[\]】]/i
/** `[joy]` `【shy】`(既知の感情名のときだけ) */
const FULL_BARE = /^[[【]\s*([A-Za-z]{2,12})\s*[\]】]/
/** `[pose:両手を上げて喜ぶ]`(全角の括弧・コロンも可)。説明は、日本語などの自由な文 */
const FULL_POSE = /^[[【]\s*pose\s*[:：=]\s*([^\]】\n]{1,100}?)\s*[\]】]/i

export interface EmotionFilterResult {
  /** 画面に出す文字(タグを除いたもの) */
  text: string
  /** 取り出した感情の名前(届いた順。小文字にはしない) */
  tags: string[]
  /** 取り出した動きの説明(`[pose:…]`。届いた順) */
  poses: string[]
}

/** 先頭が括弧で、まだ、タグになり得る途中の形か(`[`, `[emo`, `[emotion: jo`, `[sh` など)。閉じ括弧が来ていれば、途中ではない */
function couldBecomeTag(rest: string): boolean {
  const body = rest.slice(1)
  if (/[\]】\n]/.test(body)) return false
  const lower = body.trimStart().toLowerCase()
  if (lower === '') return true
  if ('emotion'.startsWith(lower.trimEnd()) || 'pose'.startsWith(lower.trimEnd())) return true
  if (/^pose\s*([:：=].{0,105})?$/.test(lower)) return true
  if (/^emotion\s*([:：=].{0,25})?$/.test(lower)) return true
  const bare = lower.trimEnd()
  return KNOWN_NAMES.some((k) => k.startsWith(bare))
}

/** 先頭がタグなら、その長さ・名前(動きなら説明)・種類。タグでなければ null */
function matchTag(rest: string): { length: number; name: string; kind: 'emotion' | 'pose' } | null {
  const q = FULL_POSE.exec(rest)
  if (q) return { length: q[0].length, name: q[1].trim(), kind: 'pose' }
  const p = FULL_PREFIXED.exec(rest)
  if (p) return { length: p[0].length, name: p[1].trim(), kind: 'emotion' }
  const b = FULL_BARE.exec(rest)
  if (b && KNOWN.has(b[1].toLowerCase())) return { length: b[0].length, name: b[1], kind: 'emotion' }
  return null
}

export class EmotionTagFilter {
  private pending = ''

  push(delta: string): EmotionFilterResult {
    let s = this.pending + delta
    this.pending = ''
    let text = ''
    const tags: string[] = []
    const poses: string[] = []
    for (;;) {
      const i = s.search(/[[【]/)
      if (i < 0) {
        text += s
        break
      }
      text += s.slice(0, i)
      const rest = s.slice(i)
      const m = matchTag(rest)
      if (m) {
        if (m.kind === 'pose') {
          if (m.name !== '' && [...m.name].length <= MAX_POSE) poses.push(m.name)
        } else if (m.name !== '' && [...m.name].length <= MAX_NAME) tags.push(m.name)
        s = rest.slice(m.length)
        continue
      }
      if (OPEN.test(rest) && couldBecomeTag(rest)) {
        this.pending = rest // 続きの断片で、タグかどうか決まる
        break
      }
      text += rest[0]
      s = rest.slice(1)
    }
    return { text, tags, poses }
  }

  /** 返答の終わり。持ち越していた途中の文字は、ただの文字として返す */
  flush(): EmotionFilterResult {
    const text = this.pending
    this.pending = ''
    return { text, tags: [], poses: [] }
  }
}

/** 保存済みの返答など、まとまった文字から、感情タグを取り除く(履歴を LLM に渡す前に使う。真似して増えるのを防ぐ) */
export function stripEmotionTags(text: string): string {
  if (!/[[【]/.test(text)) return text
  const f = new EmotionTagFilter()
  return (f.push(text).text + f.flush().text).replace(/[ \t]+$/gm, '')
}
