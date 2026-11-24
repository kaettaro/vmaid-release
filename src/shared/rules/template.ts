// チャット入力を使った変数展開(`{{message}}` = 入力した文そのまま / `{{rest}}` = 一致した言葉のあとに続く文)。
// 例: 「ダンスして: ワルツ」→ トリガーワード「ダンスして」に一致 → `{{rest}}` = 「ワルツ」。
// 展開は1回だけ(入力文の中の `{{message}}` は、再展開しない)。知らない `{{x}}` は、そのまま残す。

export interface TemplateVars {
  message: string
  rest: string
  /** 一致した言葉を除いた、残りの言葉(`{{subject}}`)。「踊って ワルツ」も「ワルツを踊って」も「ワルツ」。省略なら空 */
  subject?: string
  /** AI が指定した動きの説明(`{{pose}}`)。トリガー「AI が動き(ポーズ)を指定したとき」のルールだけ。それ以外は空 */
  pose?: string
  /** キャラの返答の本文(`{{reply}}`)。トリガー「返答が終わったとき」のルールだけ。それ以外は空 */
  reply?: string
  /** Mod のスロットの値(`{{slot:名前}}`)。Mod のルールだけに渡す。無ければ、`{{slot:…}}` は、そのまま残す。空のスロットは、空文字になる */
  slots?: Record<string, string>
}

export const EMPTY_VARS: TemplateVars = { message: '', rest: '' }

const VAR_RE = /\{\{(message|rest|subject|pose|reply|slot:[a-z0-9][a-z0-9-]{0,39})\}\}/g

export const hasTemplate = (text: string): boolean => text.includes('{{')

export function expandTemplate(text: string, vars: TemplateVars): string {
  return text.replace(VAR_RE, (whole, name: string) => {
    if (name === 'message' || name === 'rest') return vars[name]
    if (name === 'subject') return vars.subject ?? ''
    if (name === 'pose') return vars.pose ?? ''
    if (name === 'reply') return vars.reply ?? ''
    if (!vars.slots) return whole
    return vars.slots[name.slice('slot:'.length)] ?? ''
  })
}

/** 文字を比べるための正規化: 全角・半角をそろえ、小文字にし、空白と記号を除く(「ダンス して!」=「ダンスして」) */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

/** 入力が長いときの上限(位置の対応表を作る処理を、重くしない) */
const MAX_INPUT = 2000

/**
 * 正規化後の位置 → 元の文字列の位置、の対応表を作る。
 * `ends[k]` = 正規化後の先頭 k+1 文字を作るのに必要な、元の文字列の長さ(UTF-16)。
 * NFKC は前後の文字で結果が変わる(か+゛→が)ので、1文字ずつではなく、先頭からの部分文字列で正規化する。
 */
function endMap(original: string): { normalized: string; ends: number[] } {
  const ends: number[] = []
  let cut = 0
  let prevLen = 0
  for (const ch of original) {
    cut += ch.length
    const len = normalizeText(original.slice(0, cut)).length
    for (let k = prevLen; k < len; k++) ends.push(cut)
    if (len > prevLen) prevLen = len
  }
  return { normalized: normalizeText(original), ends }
}

/** 一致した言葉のあと(元の入力から切り出す)。先頭の区切り(`:` `：` 空白 `、` `,`)は除く */
export function restAfterKeyword(input: string, keyword: string): string {
  const text = input.length > MAX_INPUT ? input.slice(0, MAX_INPUT) : input
  const kw = normalizeText(keyword)
  if (kw === '') return ''
  const { normalized, ends } = endMap(text)
  const at = normalized.indexOf(kw)
  if (at < 0) return ''
  const cut = ends[at + kw.length - 1] ?? text.length
  return text.slice(cut).replace(/^[\s:：、,，]+/, '')
}

/**
 * 一致した言葉を除いた、残りの言葉。あとに続く文があればそれ(「踊って ワルツ」→「ワルツ」)、なければ前の文
 * (「ワルツを踊って」→「ワルツ」。言葉の直前の「を・に・で・の・は・も」と区切りは除く)
 */
export function subjectOf(input: string, keyword: string): string {
  const text = input.length > MAX_INPUT ? input.slice(0, MAX_INPUT) : input
  const kw = normalizeText(keyword)
  if (kw === '') return ''
  const after = tidySubject(restAfterKeyword(text, keyword))
  if (after !== '') return after
  const { normalized, ends } = endMap(text)
  const at = normalized.indexOf(kw)
  if (at < 0) return ''
  const start = at === 0 ? 0 : (ends[at - 1] ?? 0)
  return tidySubject(text.slice(0, start).replace(/[\s:：、,，]+$/, '').replace(/(?:を|に|で|の|は|も)$/, ''))
}

/** 前後の空白と、文末の記号(「!」「。」など)を除く。記号だけなら、空 */
function tidySubject(text: string): string {
  const t = text.trim().replace(/[\s!！?？。.、,，~〜…]+$/u, '')
  return normalizeText(t) === '' ? '' : t
}
