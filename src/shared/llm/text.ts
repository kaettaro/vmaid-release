/**
 * 吹き出し(と将来の音声読み上げ)に出したくない絵文字・顔文字用の記号を取り除く。
 * プロンプトで禁止しても小型モデルは守りきれないため、表示側でも保証する。
 * ZWJ(‍)・異体字セレクタ(️)・囲み文字(⃣)は絵文字の部品なので一緒に除く。
 */
const PICTOGRAPH = new RegExp('(?![★♪♫♬])\\p{Extended_Pictographic}|\\u200D|\\uFE0F|\\u20E3', 'gu')

export function stripPictographs(text: string): string {
  return text.replace(PICTOGRAPH, '')
}
