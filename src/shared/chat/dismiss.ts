// Esc で吹き出しを閉じる、の判定と、閉じたあとの状態。Electron / DOM に依存しない純粋ロジック。
// 閉じるものは、入力欄・送った自分の文・キャラの返答(エラー・準備中の表示も)の、すべて。

/** 吹き出しの表示に関わる、会話の状態(useChat の ChatState の一部) */
export interface BubbleVisibility {
  inputOpen: boolean
  lastUser: string | null
  reply: string
  status: 'idle' | 'waiting' | 'streaming' | 'error'
  error: string | null
  prep: unknown
  emotion: string | null
}

/** 返答の待ち・返答中か(Esc で、中断が要る) */
export const isBusy = (s: Pick<BubbleVisibility, 'status'>): boolean => s.status === 'waiting' || s.status === 'streaming'

/** 画面に、閉じられる吹き出しが、ひとつでもあるか */
export const hasVisibleBubble = (s: BubbleVisibility): boolean => s.inputOpen || s.lastUser !== null || s.reply !== '' || s.status !== 'idle' || s.error !== null

/**
 * Esc を押したときの動き: 吹き出しが無ければ、何もしない(Esc を他へ譲る)。
 * あれば、返答中なら中断して(abort)、**すべての吹き出しを閉じる**(次の状態 next)。
 */
export function escAction(s: BubbleVisibility): { handled: boolean; abort: boolean } {
  if (!hasVisibleBubble(s)) return { handled: false, abort: false }
  return { handled: true, abort: isBusy(s) }
}

/** Esc で閉じたあとの状態(返答中の status は、main からの完了の通知で idle に戻るので、ここでは触らない) */
export function dismissed<T extends BubbleVisibility>(s: T): T {
  return { ...s, inputOpen: false, lastUser: null, reply: '', error: null, prep: null, emotion: null, status: isBusy(s) ? s.status : 'idle' }
}

/**
 * キーイベントが、Esc か。IME の変換中は、IME の取り消しなので、Esc として扱わない。
 * IME が ON のとき、key が Escape にならず keyCode 27 / code だけが届くことがあるので、どれでも受ける
 */
export function isEscapeKey(e: { key?: string; code?: string; keyCode?: number; isComposing?: boolean }): boolean {
  if (e.isComposing) return false
  return e.key === 'Escape' || e.code === 'Escape' || e.keyCode === 27
}
