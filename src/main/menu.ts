import type { MenuItemConstructorOptions } from 'electron'

export interface MenuState {
  visible: boolean
  clickThrough: boolean
  panelVisible: boolean
  /** 直前のリセットを取り消せるか */
  canUndoReset: boolean
  characters: Array<{ id: string; name: string }>
  activeCharacterId: string
  /** 「静かにして」(話しかけ控え)。Mod「話しかけ」が ON のときだけ、メニューに出す */
  talk: { available: boolean; muted: boolean }
  /** 一覧窓(host.ui.list)を持つ Mod。メニューから、窓を出し入れする */
  modWindows: Array<{ id: string; name: string; visible: boolean }>
}

export interface MenuActions {
  switchCharacter(id: string): void
  openSettings(): void
  toggleClickThrough(): void
  toggleVisible(): void
  resetCharacter(): void
  undoReset(): void
  togglePanel(): void
  reloadRules(): void
  revealRules(): void
  resetRules(): void
  addMotions(): void
  addMotionFolder(): void
  openMotionPreview(): void
  toggleTalkMuted(): void
  toggleModWindow(modId: string): void
  quit(): void
}

/**
 * トレイと右クリックメニューで共通の項目。
 * 詳しい操作(モデルの登録・待機モーション・登録を外す・Mod など)は、設定ウィンドウでする。ここには、すぐ使うものだけを置く。
 */
export function buildMenuTemplate(state: MenuState, a: MenuActions): MenuItemConstructorOptions[] {
  return [
    { label: '設定を開く', click: a.openSettings },
    {
      label: 'キャラを切り替え',
      submenu: state.characters.map(
        (c): MenuItemConstructorOptions => ({
          label: c.name,
          type: 'radio',
          checked: c.id === state.activeCharacterId,
          click: () => a.switchCharacter(c.id)
        })
      )
    },
    ...state.modWindows.map((w): MenuItemConstructorOptions => ({ label: `${w.name}の窓`, type: 'checkbox', checked: w.visible, click: () => a.toggleModWindow(w.id) })),
    { label: state.panelVisible ? '表情・衣装パネルを閉じる' : '表情・衣装パネルを開く', click: a.togglePanel },
    {
      label: 'モーション',
      submenu: [
        { label: '追加…(複数選択できます)', click: a.addMotions },
        { label: 'フォルダからまとめて追加…', click: a.addMotionFolder },
        { label: '再生ウィンドウを開く…', click: a.openMotionPreview }
      ]
    },
    {
      label: 'ルール',
      submenu: [
        { label: 'ルールファイルを開く(場所を表示)', click: a.revealRules },
        { label: 'ルールを再読み込み', click: a.reloadRules },
        { label: 'マイルールを空にする…', click: a.resetRules }
      ]
    },
    ...(state.talk.available ? [{ label: '静かにして(自分からは話しかけない)', type: 'checkbox', checked: state.talk.muted, click: a.toggleTalkMuted } satisfies MenuItemConstructorOptions] : []),
    { label: 'クリック透過', type: 'checkbox', checked: state.clickThrough, click: a.toggleClickThrough },
    { label: state.visible ? '非表示' : '表示', click: a.toggleVisible },
    { label: 'キャラを初期状態に戻す(緊急リセット)…', click: a.resetCharacter },
    ...(state.canUndoReset ? [{ label: 'リセットを取り消す(直前の状態に戻す)', click: a.undoReset } satisfies MenuItemConstructorOptions] : []),
    { type: 'separator' },
    { label: '終了', click: a.quit }
  ]
}
