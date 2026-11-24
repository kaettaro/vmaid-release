import type { UiListItem } from './scripts/uiList'

/** 一覧窓(host.ui.list)の中身と設定。窓のページが受け取る */
export interface ModListState {
  modName: string
  title: string
  empty: string
  icons: Record<string, string>
  items: UiListItem[]
  /** キャラに追従するか */
  follow: boolean
  /** 項目の記事をブラウザで開けるか(Mod の権限 openLink) */
  canOpen: boolean
}
