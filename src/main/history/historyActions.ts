import { writeFile } from 'node:fs/promises'
import { app, dialog } from 'electron'
import { newestKeys, toExportJson, toExportText } from '../../shared/history/format'
import type { HistoryActionResult, HistoryExportFormat } from '../../shared/historyApi'
import type { HistoryStore } from './historyStore'

const DAY_MS = 24 * 60 * 60 * 1000

function confirm(message: string, detail: string, okLabel: string): boolean {
  app.focus({ steal: true })
  // 同期ダイアログ(M1 で、非同期だと完了が遅れる問題があったため)
  return dialog.showMessageBoxSync({ type: 'warning', message, detail, buttons: [okLabel, 'キャンセル'], defaultId: 1, cancelId: 1 }) === 0
}

/** すべて削除(確認ダイアログつき) */
export async function clearAll(store: HistoryStore): Promise<HistoryActionResult & { cleared: boolean }> {
  const s = await store.summary()
  if (s.messages === 0) return { ok: true, cleared: false, message: '削除する履歴はありません' }
  if (!confirm('会話履歴をすべて削除します', `${s.messages}件のメッセージが削除され、元に戻せません。`, 'すべて削除')) {
    return { ok: false, cleared: false, message: '' }
  }
  await store.clear()
  return { ok: true, cleared: true, message: '会話履歴をすべて削除しました' }
}

/** 指定日数より古い履歴を削除(確認ダイアログつき) */
export async function deleteOlderThan(store: HistoryStore, days: number): Promise<HistoryActionResult & { cleared: boolean }> {
  if (!Number.isFinite(days) || days < 1) return { ok: false, cleared: false, message: '日数の指定が正しくありません' }
  const cutoff = Date.now() - days * DAY_MS
  const all = await store.readAll()
  const count = all.filter((e) => e.ts < cutoff).length
  if (count === 0) return { ok: true, cleared: false, message: `${days}日より古い履歴はありません` }
  if (!confirm(`${days}日より古い会話履歴を削除します`, `${count}件のメッセージが削除され、元に戻せません。`, '削除')) {
    return { ok: false, cleared: false, message: '' }
  }
  const removed = await store.deleteBefore(cutoff)
  return { ok: true, cleared: true, message: `${removed}件の古い履歴を削除しました` }
}

/** 選んだ記録を削除(確認ダイアログつき) */
export async function deleteSelected(store: HistoryStore, keys: string[]): Promise<HistoryActionResult & { cleared: boolean }> {
  if (keys.length === 0) return { ok: false, cleared: false, message: '削除する履歴が選ばれていません' }
  if (!confirm(`選んだ ${keys.length} 件の会話履歴を削除します`, '元に戻せません。', '削除')) return { ok: false, cleared: false, message: '' }
  const removed = await store.deleteKeys(keys)
  return { ok: true, cleared: removed > 0, message: `${removed}件の履歴を削除しました` }
}

/** 新しいほうから n 件を削除(characterId を渡すと、そのキャラの分だけ。確認ダイアログつき) */
export async function deleteLatest(store: HistoryStore, n: number, characterId?: string): Promise<HistoryActionResult & { cleared: boolean }> {
  if (!Number.isFinite(n) || n < 1) return { ok: false, cleared: false, message: '件数の指定が正しくありません' }
  const keys = newestKeys(await store.readAll(), Math.floor(n), characterId === undefined ? {} : { characterId })
  if (keys.length === 0) return { ok: true, cleared: false, message: '削除する履歴はありません' }
  if (!confirm(`直近 ${keys.length} 件の会話履歴を削除します`, '元に戻せません。', '削除')) return { ok: false, cleared: false, message: '' }
  const removed = await store.deleteKeys(keys)
  return { ok: true, cleared: removed > 0, message: `直近の ${removed} 件を削除しました` }
}

/** 履歴を書き出す(保存先は保存ダイアログで選ぶ) */
export async function exportHistory(
  store: HistoryStore,
  format: HistoryExportFormat,
  names: { character: string; user: string; characterOf?: (id: string | undefined) => string }
): Promise<HistoryActionResult> {
  const entries = await store.readAll()
  if (entries.length === 0) return { ok: false, message: '書き出す履歴がありません' }
  app.focus({ steal: true })
  const ext = format === 'json' ? 'json' : 'txt'
  const path = dialog.showSaveDialogSync({
    title: '会話履歴を書き出す',
    defaultPath: `vmaid-history.${ext}`,
    filters: [format === 'json' ? { name: 'JSON', extensions: ['json'] } : { name: 'テキスト', extensions: ['txt'] }]
  })
  if (!path) return { ok: false, message: '' }
  await writeFile(path, format === 'json' ? toExportJson(entries, names.characterOf) : toExportText(entries, names), 'utf-8')
  return { ok: true, message: `${entries.length}件を書き出しました: ${path}` }
}
