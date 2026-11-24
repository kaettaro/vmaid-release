// スクリプト Mod の「外部ツールの起動」の判断(純粋ロジック)。実際の起動は main(scriptLauncher.ts)。
// 守ること: 起動するのは、利用者が設定画面で選んだ実行ファイルだけ / 自動で起動するのは、利用者が自動起動を ON にしたときだけ /
// Windows は .exe / .bat / .cmd、macOS は .app・実行ファイル・.command だけ。フォルダは起動しない。

export interface LauncherInput {
  /** 利用者が選んだ実行ファイルのパス(未設定は null) */
  path: string | null
  /** path の実体: file / dir / none(無い) */
  pathKind: 'file' | 'dir' | 'none'
  platform: NodeJS.Platform
}

export type LauncherPlan =
  | { action: 'spawn' }
  /** macOS の .app: `open -g -a` で起動する(終了は、アプリに任せる) */
  | { action: 'open-app' }
  | { action: 'blocked'; reason: string }

export function planLauncher(i: LauncherInput): LauncherPlan {
  if (!i.path) return { action: 'blocked', reason: '起動する実行ファイルが選ばれていません(Mod の設定で「選ぶ…」を押してください)' }
  if (i.pathKind === 'none') return { action: 'blocked', reason: `実行ファイルが見つかりません: ${i.path}` }
  if (i.platform === 'darwin' && /\.app\/?$/i.test(i.path)) return i.pathKind === 'dir' ? { action: 'open-app' } : { action: 'blocked', reason: '.app が見つかりません' }
  if (i.pathKind === 'dir') return { action: 'blocked', reason: 'フォルダではなく、実行ファイルを選んでください' }
  if (i.platform === 'win32' && !/\.(exe|bat|cmd)$/i.test(i.path)) return { action: 'blocked', reason: 'Windows では、.exe / .bat / .cmd を選んでください' }
  return { action: 'spawn' }
}

/** 通信の前に、自動で起動するか。Mod が healthUrl と同じオリジンへ通信しようとしていて、自動起動が ON のときだけ */
export function shouldAutoStart(opts: { autoOn: boolean; requestOrigin: string | null; healthOrigin: string | null }): boolean {
  return opts.autoOn && opts.healthOrigin !== null && opts.requestOrigin === opts.healthOrigin
}
