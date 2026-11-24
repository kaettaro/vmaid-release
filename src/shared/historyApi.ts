import type { HistorySummary } from './history/format'

// 履歴の管理: 設定ウィンドウ ↔ main のやり取りの型

export type HistoryExportFormat = 'json' | 'text'

export interface HistoryView {
  enabled: boolean
  summary: HistorySummary
  /** 保存先フォルダ(表示用) */
  dir: string
}

export interface HistoryActionResult {
  ok: boolean
  message: string
}

/** 履歴の一覧の要求(新しい順。offset 件目から limit 件) */
export interface HistoryListRequest {
  characterId?: string
  query?: string
  offset: number
  limit: number
}

export interface HistoryListItem {
  /** 削除の指定に使う印 */
  key: string
  ts: number
  role: 'user' | 'assistant'
  text: string
  characterId?: string
}

export interface HistoryList {
  items: HistoryListItem[]
  /** 条件に合った全件数 */
  total: number
}
