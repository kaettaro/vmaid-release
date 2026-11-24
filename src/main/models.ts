import { createHash } from 'node:crypto'
import { app, dialog } from 'electron'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { ModelFile } from '../shared/ipc'
import { modelUrlFor } from './modelProtocol'

/**
 * PMX(MMD のモデル)を読んでよいか。公式の機能 Mod「MMD 対応」(mmd)が ON のときだけ true にする(main が設定する)。
 * OFF の間は、PMX は読み込まず、選択ダイアログにも出さない
 */
let pmxEnabled: () => boolean = () => false
export function setPmxGate(fn: () => boolean): void {
  pmxEnabled = fn
}
export const isPmxEnabled = (): boolean => pmxEnabled()

type ModelKind = 'vrm' | 'pmx'

function kindOf(path: unknown): ModelKind | null {
  if (typeof path !== 'string') return null
  const ext = extname(path).toLowerCase()
  if (ext === '.vrm') return 'vrm'
  if (ext === '.pmx' && pmxEnabled()) return 'pmx'
  return null
}

function toModelFile(path: string, kind: ModelKind, buf: Buffer): ModelFile {
  const hash = createHash('sha256').update(buf).digest('hex')
  // PMX は、テクスチャが別ファイルなので、中身は送らず、専用プロトコルの URL で、レンダラーに読ませる
  if (kind === 'pmx') return { kind, path, name: basename(path), hash, data: new Uint8Array(0), url: modelUrlFor(path) }
  return { kind, path, name: basename(path), hash, data: new Uint8Array(buf) }
}

/** モデルファイル(VRM、MMD 対応 Mod が ON なら PMX)を読む。保存済みパスを読むため、拡張子で絞る */
export async function readModelFile(path: string): Promise<ModelFile | null> {
  const kind = kindOf(path)
  if (!kind) return null
  try {
    return toModelFile(path, kind, await readFile(path))
  } catch {
    return null
  }
}

/** 同期版。ダイアログ直後はmainのイベントループの起床が遅れることがあるため、非同期完了に頼らない */
export function readModelFileSync(path: string): ModelFile | null {
  const kind = kindOf(path)
  if (!kind) return null
  try {
    return toModelFile(path, kind, readFileSync(path))
  } catch {
    return null
  }
}

/**
 * モデルファイルの選択ダイアログ(同期版)。MMD 対応 Mod が ON のときは、PMX も選べる。
 * 常駐キャラは showInactive で出していてアプリが非アクティブのことがある。その状態だとmacOSで非同期ダイアログの完了が、
 * 次のユーザー操作まで届かないことがあった(IMKCFRunLoopWakeUpReliable の警告とともに発生)。前面化し、同期版で待つ。
 */
export function pickVrmPathSync(): string | null {
  app.focus({ steal: true })
  const t0 = Date.now()
  const pmx = pmxEnabled()
  const paths = dialog.showOpenDialogSync({
    title: pmx ? 'モデル(VRM / PMX)を選択' : 'VRMモデルを選択',
    properties: ['openFile'],
    filters: pmx ? [{ name: 'VRM / PMX', extensions: ['vrm', 'pmx'] }] : [{ name: 'VRM', extensions: ['vrm'] }]
  })
  console.info(`[pickModel] ダイアログ終了 ${Date.now() - t0}ms`, paths)
  return paths && paths.length > 0 ? paths[0] : null
}
