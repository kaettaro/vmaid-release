// 基本設定(本体の基本項目。Mod ではない): 倍率・クリック透過・最前面・起動時の表示・緊急リセットのショートカット。
// Electron に依存しない型と検証。

import { z } from 'zod'
import { clampScale } from './geometry'

/** 緊急リセットのショートカットの既定(キャラが消えて、設定を開けなくなったときに、初期の表示へ戻す) */
export const DEFAULT_RESET_SHORTCUT = 'CommandOrControl+Alt+Shift+R'

/** ショートカットの文字列の形(Electron の accelerator: 修飾キー + キー。例 `CommandOrControl+Alt+Shift+R`)。登録できるかは、main が試す */
const ACCELERATOR_RE = /^(?:(?:CommandOrControl|CmdOrCtrl|Command|Cmd|Control|Ctrl|Alt|Option|AltGr|Shift|Super|Meta)\+)+[A-Za-z0-9]$|^(?:(?:CommandOrControl|CmdOrCtrl|Command|Cmd|Control|Ctrl|Alt|Option|AltGr|Shift|Super|Meta)\+)+(?:F(?:[1-9]|1\d|2[0-4])|Space|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Escape)$/

/** 修飾キーを 1 つも含まないもの(単独のキー)は、ふだんの入力を奪うので、許さない */
export function isValidAccelerator(text: string): boolean {
  return ACCELERATOR_RE.test(text)
}

export interface BasicView {
  scale: number
  clickThrough: boolean
  alwaysOnTop: boolean
  showOnStartup: boolean
  resetShortcut: string
  /** モーション再生ウィンドウの中にも、キャラを出すか(出すなら、そちらで再生する) */
  previewInWindow: boolean
  /** 緊急リセットの前に、確認ダイアログを出すか */
  confirmReset: boolean
  /** 直前のリセットを、取り消せるか */
  canUndoReset: boolean
  /** いま、リセットのショートカットを登録できているか(ほかのアプリが使っていると、登録できない) */
  resetShortcutOk: boolean
}

/** 基本設定の更新(変えた項目だけ)。不正な値は、検証で弾く */
export const BasicPatchSchema = z.object({
  scale: z.number().finite().transform(clampScale).optional(),
  clickThrough: z.boolean().optional(),
  alwaysOnTop: z.boolean().optional(),
  showOnStartup: z.boolean().optional(),
  previewInWindow: z.boolean().optional(),
  confirmReset: z.boolean().optional(),
  resetShortcut: z.string().trim().refine(isValidAccelerator, '修飾キー(Ctrl・Alt・Shift など)を組み合わせた形で書いてください(例: CommandOrControl+Alt+Shift+R)').optional()
})
export type BasicPatch = z.input<typeof BasicPatchSchema>

export interface BasicResult {
  view: BasicView
  /** 更新できなかった理由(なければ空) */
  error: string
}
