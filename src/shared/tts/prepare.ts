// 読み上げ用に、文を整える純粋関数。吹き出しの表示には使わない(表示は元の文のまま)。

const URL_RE = /https?:\/\/[^\s)\uFF09\u300D\u300F\u3011]+/g
const CODE_RE = /`[^`]*`/g
/** 括弧書きの補足(ト書き・顔文字・「(笑)」など)。読み上げると不自然なので除く */
const PAREN_RE = /[(\uFF08][^()\uFF08\uFF09]{0,30}[)\uFF09]/g
/** 読み上げに向かない記号(Markdown・装飾) */
const SYMBOL_RE = /[*_#>|~\uFF5E\u2605\u2606\u266A\u266B\u266C\u203B\u25C6\u25C7\u25A0\u25A1\u25B2\u25B3\u25BC\u25BD\u25CF\u25CB\u25CE]+/g
const EMOJI_RE = /\p{Extended_Pictographic}|\u200D|\uFE0F|\u20E3/gu

/**
 * 読み上げる文字列にする。読み上げるものが残らなければ(記号だけなど)空文字を返す。
 * 声の長さの上限(`maxLength`)を超える分は切り捨てる(合成が長くなりすぎないように)。
 */
export function prepareForSpeech(text: string, maxLength = 200): string {
  let t = text
    .replace(CODE_RE, '')
    .replace(URL_RE, '')
    .replace(PAREN_RE, '')
    .replace(EMOJI_RE, '')
    .replace(SYMBOL_RE, '')
    .replace(/[…]{2,}/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
  // 読める文字(日本語・英数)が1つもなければ、何も言わない
  if (!/[\p{L}\p{N}]/u.test(t)) return ''
  if (t.length > maxLength) t = t.slice(0, maxLength)
  return t
}
