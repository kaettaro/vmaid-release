import { existsSync, readFileSync } from 'node:fs'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import type { DownloadStatus, ModelsActionResult, ModelsView, ModelView } from '../../shared/modelsApi'
import { formatBytes, parseRegistry, pickDefaultModel, type ModelEntry } from '../../shared/models/registry'
import type { SettingsStore } from '../settingsStore'
import { ChecksumError, DiskSpaceError, DownloadAbortedError, ModelDownloader, type DownloadProgress } from './downloader'

/** 既定にしたいモデルの優先順(動かせるなら先頭を優先)。メモリが足りなければ軽量なものになる */
const PREFERRED = ['gemma-4-e4b-it-q4km', 'qwen3-4b-instruct-2507-q4km']

/** 内蔵モデルの解決結果 */
export type ResolvedModel = { kind: 'installed'; path: string; name: string } | { kind: 'missing'; entry: ModelEntry }

/**
 * 内蔵LLMのモデル管理: 登録表・インストール状況・ダウンロード(同意つき)・選択。
 * ダウンロードは同時に1つだけ。通信するのはモデルのダウンロード時だけで、以後は完全オフラインで動く。
 */
export class ModelManager {
  readonly registry: ModelEntry[]
  readonly totalRamGB: number
  private readonly downloader: ModelDownloader
  private readonly modelsDir = join(app.getPath('userData'), 'models')
  private active: { entry: ModelEntry; controller: AbortController; promise: Promise<string> } | null = null
  private status: DownloadStatus | null = null
  private readonly listeners = new Set<(s: DownloadStatus | null) => void>()

  constructor(
    private readonly store: SettingsStore,
    registryPath: string,
    totalRamBytes = totalmem()
  ) {
    this.registry = parseRegistry(JSON.parse(readFileSync(registryPath, 'utf-8')))
    this.totalRamGB = Math.round((totalRamBytes / 1024 ** 3) * 10) / 10
    this.downloader = new ModelDownloader({ dir: this.modelsDir })
  }

  onDownloadStatus(cb: (s: DownloadStatus | null) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(s: DownloadStatus | null): void {
    this.status = s
    this.listeners.forEach((cb) => cb(s))
  }

  recommended(): ModelEntry {
    return pickDefaultModel(this.registry, this.totalRamGB, PREFERRED)
  }

  /** 現在使う内蔵モデル(設定で選んだもの、なければおすすめ) */
  selected(): ModelEntry {
    const id = this.store.get().llm.builtin.modelId
    return this.registry.find((m) => m.id === id) ?? this.recommended()
  }

  /** 使うモデルのファイルを探す。任意のGGUFの指定があればそれを優先。無ければダウンロードが必要 */
  async resolve(): Promise<ResolvedModel> {
    const custom = this.store.get().llm.builtin.customPath
    if (custom && existsSync(custom)) return { kind: 'installed', path: custom, name: custom.split(/[\\/]/).pop() ?? custom }
    const entry = this.selected()
    if (await this.downloader.isInstalled(entry)) return { kind: 'installed', path: this.downloader.pathFor(entry), name: entry.name }
    return { kind: 'missing', entry }
  }

  // --- ダウンロード ---
  /** 同意ダイアログ(何を・どこから・何GB・以後は通信しない)。同期ダイアログ(M1で、非同期だと完了が遅れる問題があったため) */
  confirmDownload(entry: ModelEntry): boolean {
    app.focus({ steal: true })
    const host = new URL(entry.url).hostname
    const warn =
      entry.minRamGB > this.totalRamGB
        ? `\n\n注意: このPCのメモリ(${this.totalRamGB}GB)では重い可能性があります(目安 ${entry.minRamGB}GB 以上)。`
        : ''
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      title: 'AIモデルのダウンロード',
      message: `会話用のAIモデル「${entry.name}」をダウンロードします(約 ${formatBytes(entry.sizeBytes)})。`,
      detail:
        `ダウンロード元: ${host}\n保存先: ${this.modelsDir}\nライセンス: ${entry.license}\n\n` +
        `ダウンロードするのは、この1回だけです。完了後は、会話はすべてこのPCの中で動き、外部と通信しません。` +
        `(通信は中断しても、続きから再開できます)${warn}`,
      buttons: ['ダウンロードする', 'キャンセル'],
      defaultId: 0,
      cancelId: 1
    })
    return choice === 0
  }

  /**
   * 同意を取ってダウンロードし、完成したファイルのパスを返す。既に進行中なら、その完了を待つ。
   * 同意されなければ null。
   */
  async download(entry: ModelEntry): Promise<{ path: string } | { error: string } | null> {
    if (this.active) {
      if (this.active.entry.id !== entry.id) return { error: '別のモデルをダウンロード中です。完了または中止してからお試しください。' }
      return this.wait(this.active.promise)
    }
    if (await this.downloader.isInstalled(entry)) return { path: this.downloader.pathFor(entry) }
    if (!this.confirmDownload(entry)) return null

    const controller = new AbortController()
    const promise = this.downloader.download(entry, (p) => this.emit(toStatus(entry.id, p)), controller.signal)
    this.active = { entry, controller, promise }
    this.emit({ modelId: entry.id, phase: 'downloading', fraction: 0, bytesPerSec: 0, etaSec: null })
    const result = await this.wait(promise)
    this.active = null
    this.emit(null)
    return result
  }

  private async wait(p: Promise<string>): Promise<{ path: string } | { error: string }> {
    try {
      return { path: await p }
    } catch (e) {
      if (e instanceof DownloadAbortedError) return { error: 'ダウンロードを中止しました(続きから再開できます)。' }
      if (e instanceof ChecksumError || e instanceof DiskSpaceError) return { error: e.message }
      return { error: `ダウンロードに失敗しました: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  cancelDownload(): void {
    this.active?.controller.abort()
  }

  get downloading(): boolean {
    return this.active !== null
  }

  // --- 設定画面向け ---
  async view(): Promise<ModelsView> {
    const selectedId = this.selected().id
    const recommendedId = this.recommended().id
    const custom = this.store.get().llm.builtin.customPath
    const models: ModelView[] = await Promise.all(
      this.registry.map(async (m) => ({
        id: m.id,
        name: m.name,
        family: m.family,
        license: m.license,
        sizeBytes: m.sizeBytes,
        minRamGB: m.minRamGB,
        notes: m.notes,
        installed: await this.downloader.isInstalled(m),
        partialBytes: await this.downloader.partialBytes(m),
        recommended: m.id === recommendedId,
        selected: m.id === selectedId && !custom,
        heavy: m.minRamGB > this.totalRamGB
      }))
    )
    return { models, totalRamGB: this.totalRamGB, customPath: custom, download: this.status, modelsDir: this.modelsDir }
  }

  select(id: string): void {
    if (!this.registry.some((m) => m.id === id)) return
    this.store.update((s) => {
      s.llm.builtin.modelId = id
      s.llm.builtin.customPath = null
    })
  }

  async remove(id: string): Promise<ModelsActionResult> {
    const entry = this.registry.find((m) => m.id === id)
    if (!entry) return { ok: false, message: 'モデルが見つかりません' }
    if (this.active?.entry.id === id) return { ok: false, message: 'ダウンロード中のモデルは削除できません。先に中止してください。' }
    await this.downloader.remove(entry)
    return { ok: true, message: `「${entry.name}」を削除しました` }
  }

  /** 任意のGGUFを選ぶ(上級者向け)。同期ダイアログ */
  pickCustom(): ModelsActionResult {
    app.focus({ steal: true })
    const paths = dialog.showOpenDialogSync({
      title: 'GGUFモデルファイルを選択',
      properties: ['openFile'],
      filters: [{ name: 'GGUF', extensions: ['gguf'] }]
    })
    if (!paths || paths.length === 0) return { ok: false, message: '' }
    this.store.update((s) => (s.llm.builtin.customPath = paths[0]))
    return { ok: true, message: 'ファイルを指定しました。モデルのライセンス・利用条件は、あなた自身の責任で確認してください。' }
  }

  clearCustom(): void {
    this.store.update((s) => (s.llm.builtin.customPath = null))
  }
}

function toStatus(modelId: string, p: DownloadProgress): DownloadStatus {
  return {
    modelId,
    phase: p.phase,
    fraction: p.snapshot.fraction,
    bytesPerSec: p.snapshot.bytesPerSec,
    etaSec: p.snapshot.etaSec
  }
}
