// 状態(モード)と、見た目(表情・衣装セット)の連動の純粋ロジック。Electron/DOM に依存しない。
// 状態を始めるときに重ねた見た目のセットを覚えておき、状態が終わったら(終了・時間切れ・リセット・Mod の OFF のどれでも)外す。

export interface StateLook {
  /** その状態が始めたときに重ねた、表情・衣装セットの名前 */
  preset: string
}

/** 状態の名前 → その状態が重ねた見た目 */
export type StateLooks = Map<string, StateLook>

/** 前回あって、いまは無い状態の名前(=終わった状態) */
export function diffEnded(prev: ReadonlySet<string>, now: ReadonlySet<string>): string[] {
  return [...prev].filter((name) => !now.has(name))
}
