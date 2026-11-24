// 内蔵LLMのモデル管理: 設定ウィンドウ ↔ main のやり取りの型(Electron非依存)

export interface ModelView {
  id: string
  name: string
  family: string
  license: string
  sizeBytes: number
  minRamGB: number
  notes: string
  /** ダウンロード済み(使える状態) */
  installed: boolean
  /** 途中まで落とした分(再開できる) */
  partialBytes: number
  /** このPCのメモリから見ておすすめ */
  recommended: boolean
  /** 現在使うモデル */
  selected: boolean
  /** このPCのメモリでは重い可能性 */
  heavy: boolean
}

export type DownloadPhaseView = 'downloading' | 'verifying'

export interface DownloadStatus {
  modelId: string
  phase: DownloadPhaseView
  /** 0〜1 */
  fraction: number
  bytesPerSec: number
  etaSec: number | null
}

export interface ModelsView {
  models: ModelView[]
  totalRamGB: number
  /** ユーザーが指定した任意のGGUF(上級者向け)。使っているときだけパス */
  customPath: string | null
  download: DownloadStatus | null
  /** 保存先フォルダ(表示用) */
  modelsDir: string
}

export interface ModelsActionResult {
  ok: boolean
  message: string
}

/** 会話の準備状況(キャラウィンドウへ送る)。ダウンロードや読み込み中の吹き出し表示に使う */
export type ChatPrep =
  | { phase: 'downloading'; fraction: number }
  | { phase: 'verifying' }
  | { phase: 'loading' }
