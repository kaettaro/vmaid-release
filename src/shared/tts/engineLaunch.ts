import { isLoopbackEndpoint } from './voicevox'

// VOICEVOX 互換エンジンの「自動起動」の判断(純粋ロジック)。実際の起動は main(ttsEngine.ts)。
// 守ること: 自動で起動するのは、利用者が選んだ実行ファイルだけ / 接続先が自分のPC(ループバック)のときだけ /
// 音声合成 Mod が ON で、方式が VOICEVOX のときだけ / 利用者が自動起動を ON にしたときだけ。

export interface LaunchInput {
  /** 公式の機能 Mod「音声合成」が ON か */
  modOn: boolean
  backend: 'system' | 'voicevox'
  autoStart: boolean
  /** 利用者が選んだ、エンジンの実行ファイル(Windows の .exe、macOS の .app など) */
  enginePath: string | null
  endpoint: string
  platform: NodeJS.Platform
  /** enginePath の実体: file / dir / none(無い) */
  pathKind: 'file' | 'dir' | 'none'
}

export type LaunchPlan =
  | { action: 'none' }
  | { action: 'spawn' }
  /** macOS の .app: `open -g -a` で起動する(終了は、アプリに任せる) */
  | { action: 'open-app' }
  | { action: 'blocked'; reason: string }

export function planEngineLaunch(i: LaunchInput): LaunchPlan {
  if (!i.modOn || i.backend !== 'voicevox' || !i.autoStart) return { action: 'none' }
  if (!isLoopbackEndpoint(i.endpoint)) return { action: 'blocked', reason: '自動起動は、接続先が、自分のPC(127.0.0.1 / localhost)のときだけ使えます' }
  if (!i.enginePath) return { action: 'blocked', reason: '起動するエンジン(VOICEVOX の実行ファイル)が選ばれていません' }
  if (i.pathKind === 'none') return { action: 'blocked', reason: `エンジンの実行ファイルが見つかりません: ${i.enginePath}` }
  if (i.platform === 'darwin' && /\.app\/?$/i.test(i.enginePath)) return i.pathKind === 'dir' ? { action: 'open-app' } : { action: 'blocked', reason: '.app が見つかりません' }
  if (i.pathKind === 'dir') return { action: 'blocked', reason: 'フォルダではなく、実行ファイルを選んでください' }
  if (i.platform === 'win32' && !/\.(exe|bat|cmd)$/i.test(i.enginePath)) return { action: 'blocked', reason: 'Windows では、.exe の実行ファイルを選んでください' }
  return { action: 'spawn' }
}
