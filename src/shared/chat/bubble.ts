// 吹き出しの表示まわりの純粋ロジック

/** 返答の吹き出しを残す時間(ms)。短文はすぐ消えすぎず、長文は読み終わるまで残る */
export function bubbleDisplayMs(text: string): number {
  return Math.min(30000, Math.max(6000, 3000 + text.length * 150))
}

/** 小さいウィンドウでも吹き出しが見切れないよう、UI全体の縮小率(基準幅400px)。小さくしすぎると読めないので下限を設ける */
export function uiScaleForWidth(windowWidth: number, baseWidth = 400, min = 0.6): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return 1
  return Math.min(1, Math.max(min, windowWidth / baseWidth))
}

/** 入力欄を、空のまま何もしなかったら閉じるまでの時間(ms)。送ったあとも入力欄を開いたままにするので、放置で片付ける */
export const INPUT_IDLE_CLOSE_MS = 30000

/** 入力欄を、放置で閉じてよいか。入力が空で、返答待ち・返答中でないとき */
export function shouldAutoCloseInput(text: string, status: 'idle' | 'waiting' | 'streaming' | 'error'): boolean {
  return text.trim() === '' && (status === 'idle' || status === 'error')
}
