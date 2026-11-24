import { z } from 'zod'
import type { NodeDef, ParamDef } from '../rules/definitions'

// スクリプト Mod(Tier 2。ADR 0002)の宣言。mod.yaml の `script:` に書く。Electron に依存しない純粋ロジック。
// スクリプトは、サンドボックスの中で動き、ホスト API だけを使える。使える API は、ここで宣言して、利用者が承認した権限だけ。

/** ルールの拡張ノードで使える、パラメータの種類(コアの ParamKind のうち、Mod が自由に使えても安全なもの) */
const ParamKindSchema = z.enum(['number', 'string', 'boolean', 'enum', 'stringList', 'time'])

const ContribParamSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,30}$/, 'パラメータ名は、英数字(先頭は英字)で書いてください'),
  label: z.string().min(1).max(60),
  kind: ParamKindSchema,
  min: z.number().optional(),
  max: z.number().optional(),
  default: z.union([z.number(), z.string(), z.boolean()]).optional(),
  options: z.array(z.object({ value: z.string().max(60), label: z.string().max(60) })).max(20).optional(),
  required: z.boolean().optional(),
  hint: z.string().max(200).optional(),
  /** `{{message}}` / `{{rest}}` を使えるか(入力文のトリガーのとき) */
  template: z.boolean().optional()
})

const ContribNodeSchema = z.object({
  type: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,40}$/, '種類名は、英数字・ハイフン・アンダースコアで書いてください'),
  label: z.string().min(1).max(60),
  description: z.string().max(400).optional(),
  params: z.array(ContribParamSchema).max(12).default([])
})

/** 通信先: オリジン(スキーム + ホスト + ポート)だけ。パスは書けない。完全一致で使う */
const OriginSchema = z
  .string()
  .max(200)
  .refine((s) => {
    try {
      const u = new URL(s)
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === s
    } catch {
      return false
    }
  }, '通信先は、http(s)://ホスト:ポート の形(パスなし・末尾の / なし)で書いてください')

const SettingSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,30}$/, '設定名は、英数字(先頭は英字)で書いてください'),
  label: z.string().min(1).max(60),
  /** secret は、暗号化して保存する(トークンなど)。画面にも、値を出さない */
  /** file は、利用者が「選ぶ…」ボタンで選んだ実行ファイルのパス(launcher の pathSetting 専用。手入力・Mod からの変更はできない) */
  kind: z.enum(['string', 'secret', 'number', 'boolean', 'urls', 'enum', 'file']),
  /** kind が enum のときの選択肢 */
  options: z.array(z.object({ value: z.string().max(40), label: z.string().max(60) })).max(10).optional(),
  default: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
  hint: z.string().max(200).optional()
})

/**
 * 外部ツールの起動(launcher)。Mod が使うローカルのツール(text-to-vrma など)を、利用者が選んだ実行ファイルで起動する。
 * Mod は「何を起動するか」を決められない(実行ファイルは、利用者が設定画面で選ぶ)。Mod が頼めるのは、healthUrl への通信の前に「起動済みにしておく」ことだけ。
 */
const LauncherSchema = z.object({
  /** 画面に出す、ツールの名前 */
  label: z.string().min(1).max(60),
  /** 実行ファイルのパスを入れる設定項目(kind: file) */
  pathSetting: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,30}$/),
  /** 「使うときに、自動で起動する」の設定項目(kind: boolean。省略なら、自動起動は無く、ボタンだけ) */
  autoSetting: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,30}$/).optional(),
  /** 起動できたかを確かめる URL(GET が 200 を返せば、起動済み)。自分の PC(ループバック)で、permissions.network のオリジンの中のものだけ */
  healthUrl: z.string().max(300),
  /** 起動を待つ上限(秒)。重いモデルの読み込みを待つため、長めにできる */
  startupSec: z.number().int().min(5).max(600).default(120)
})

export const ScriptSchema = z.object({
  /** スクリプトのファイル(Mod のフォルダからの相対パス。.js) */
  entry: z
    .string()
    .max(200)
    .refine((p) => /^[^\\:]+\.js$/i.test(p) && !p.startsWith('/') && !p.split('/').some((s) => s === '' || s === '.' || s === '..'), 'Mod のフォルダの中の .js ファイルを、/ 区切りの相対パスで指定してください')
    .default('main.js'),
  apiVersion: z.literal(1),
  /** 利用者が、「Mod」タブで入力する設定項目(接続先・トークンなど)。スクリプトは host.settings.get(名前) で読む */
  settings: z.array(SettingSchema).max(10).default([]),
  launcher: LauncherSchema.optional(),
  permissions: z
    .object({
      /** 通信してよい先(オリジン)。ここに無い先へは、通信できない */
      network: z.array(OriginSchema).max(5).default([]),
      /** motion.add(モーションを足す) / motion.play(再生する) */
      motion: z.array(z.enum(['add', 'play'])).max(2).default([]),
      /** say(吹き出しにセリフを出す) */
      say: z.boolean().default(false),
      /** storage(この Mod 専用の小さな保存領域) */
      storage: z.boolean().default(false),
      /** rules.emit(ルールのトリガーを発火する) */
      emit: z.boolean().default(false),
      /** ai(host.ai.say: 設定している AI に、指示を送り、返答をキャラに言わせる) */
      ai: z.boolean().default(false),
      /** 設定の種類 urls の項目の名前。利用者が、その欄に書いた(https の外部の)サイトへ、承認のうえで、通信できる(RSS など) */
      networkFrom: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,30}$/)).max(2).default([]),
      /** context(host.context.set: 会話に「最近の話題」を足す) */
      context: z.boolean().default(false),
      /** ui(host.ui.list: 見出しの一覧の窓。list = 窓を出す / openLink = 利用者がクリックしたときだけ、項目の https の link を、ふだんのブラウザで開く) */
      ui: z.object({ list: z.boolean().default(false), openLink: z.boolean().default(false) }).default({ list: false, openLink: false })
    })
    .default({ network: [], motion: [], say: false, storage: false, emit: false, ai: false, networkFrom: [], context: false, ui: { list: false, openLink: false } }),
  contributes: z
    .object({
      /** ルールのトリガー(スクリプトが rules.emit で起こす) */
      triggers: z.array(ContribNodeSchema).max(10).default([]),
      /** ルールのアクション(ルールが実行すると、スクリプトの onAction に届く) */
      actions: z.array(ContribNodeSchema).max(10).default([])
    })
    .default({ triggers: [], actions: [] })
}).superRefine((s, ctx) => {
  // networkFrom は、設定の種類 urls の項目を指す。enum の設定は、選択肢を持つ
  for (const name of s.permissions.networkFrom) {
    if (!s.settings.some((x) => x.name === name && x.kind === 'urls')) ctx.addIssue({ code: 'custom', message: `networkFrom の「${name}」は、設定の種類 urls の項目ではありません`, path: ['permissions', 'networkFrom'] })
  }
  for (const x of s.settings) if (x.kind === 'enum' && (x.options ?? []).length === 0) ctx.addIssue({ code: 'custom', message: `設定「${x.name}」(enum)には、options が要ります`, path: ['settings'] })
  // kind: file は、launcher の pathSetting にだけ使える(任意のファイルのパスを、Mod が受け取る道を作らない)
  const l = s.launcher
  for (const x of s.settings) if (x.kind === 'file' && x.name !== l?.pathSetting) ctx.addIssue({ code: 'custom', message: `設定「${x.name}」(file)は、launcher の pathSetting にだけ使えます`, path: ['settings'] })
  if (l) {
    if (!s.settings.some((x) => x.name === l.pathSetting && x.kind === 'file')) ctx.addIssue({ code: 'custom', message: `launcher の pathSetting「${l.pathSetting}」は、設定の種類 file の項目ではありません`, path: ['launcher', 'pathSetting'] })
    if (l.autoSetting && !s.settings.some((x) => x.name === l.autoSetting && x.kind === 'boolean')) ctx.addIssue({ code: 'custom', message: `launcher の autoSetting「${l.autoSetting}」は、設定の種類 boolean の項目ではありません`, path: ['launcher', 'autoSetting'] })
    const origin = launcherOrigin(l.healthUrl)
    if (!origin || !isLoopbackOrigin(origin)) ctx.addIssue({ code: 'custom', message: 'launcher の healthUrl は、自分の PC(127.0.0.1 / localhost)の http(s) URL にしてください', path: ['launcher', 'healthUrl'] })
    else if (!s.permissions.network.includes(origin)) ctx.addIssue({ code: 'custom', message: `launcher の healthUrl のオリジン(${origin})が、permissions.network にありません`, path: ['launcher', 'healthUrl'] })
  }
})

/** healthUrl のオリジン(http(s) 以外・解釈できないものは null) */
export function launcherOrigin(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

export type ScriptSpec = z.infer<typeof ScriptSchema>
export type ContribNode = z.infer<typeof ContribNodeSchema>

/** 拡張のノードの種類名: `<Mod の id>/<種類>` */
export const qualifiedType = (modId: string, type: string): string => `${modId}/${type}`

function toParamDef(p: z.infer<typeof ContribParamSchema>): ParamDef {
  return {
    name: p.name,
    label: p.label,
    kind: p.kind,
    ...(p.min !== undefined ? { min: p.min } : {}),
    ...(p.max !== undefined ? { max: p.max } : {}),
    ...(p.default !== undefined ? { default: p.default } : {}),
    ...(p.options ? { options: p.options } : {}),
    ...(p.required ? { required: true } : {}),
    ...(p.hint ? { hint: p.hint } : {}),
    ...(p.template ? { template: true } : {})
  }
}

/** Mod が宣言したノードを、ルールの定義(NodeDef。GUI のフォームは、ここから自動で作られる)にする */
export function toNodeDefs(modId: string, modName: string, nodes: readonly ContribNode[]): NodeDef[] {
  return nodes.map((n) => ({
    type: qualifiedType(modId, n.type),
    label: `${n.label}(${modName})`,
    ...(n.description ? { description: n.description } : {}),
    params: n.params.map(toParamDef)
  }))
}

// ------------------------------------------------------------ 権限の表示
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** 通信先が、自分のPCの中(ループバック)か */
export const isLoopbackOrigin = (origin: string): boolean => {
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

export interface PermissionLine {
  text: string
  /** 注意(赤い警告)が必要な項目 */
  danger: boolean
}

/** 権限を、日本語で列挙する(確認ダイアログ・Mod の画面に出す) */
export function describePermissions(spec: ScriptSpec): PermissionLine[] {
  const p = spec.permissions
  const lines: PermissionLine[] = []
  for (const name of p.networkFrom) {
    const label = spec.settings.find((s) => s.name === name)?.label ?? name
    lines.push({ text: `通信: あなたが設定「${label}」に書いた、https の外部のサイトへ、データを送受信する(自分の PC・内部ネットワークは不可)。サイトを足すたびに、確認が出ます。あなたの IP アドレスが、そのサイトから見えます`, danger: true })
  }
  for (const o of p.network) {
    lines.push(
      isLoopbackOrigin(o)
        ? { text: `通信: ${o}(自分のPCの中)へ、データを送受信する`, danger: false }
        : { text: `通信: ${o}(外部)へ、データを送受信する。会話や入力が外部に送られる可能性があります`, danger: true }
    )
  }
  if (spec.launcher) lines.push({ text: `外部ツール「${spec.launcher.label}」を、あなたが設定で選んだ実行ファイルから、起動する(あなたが選んだものしか起動できません。VMaid が起動したものは、VMaid の終了時に止めます)`, danger: true })
  if (p.motion.includes('add')) lines.push({ text: 'モーションを、あなたの一覧に追加する(検査済みの VRMA だけ)', danger: false })
  if (p.motion.includes('play')) lines.push({ text: 'モーションを、キャラで再生する', danger: false })
  if (p.say) lines.push({ text: '吹き出しに、セリフを出す', danger: false })
  if (p.emit) lines.push({ text: 'ルールのトリガーを、スクリプトから起こす', danger: false })
  if (p.storage) lines.push({ text: 'この Mod 専用の、小さな保存領域を使う', danger: false })
  if (p.ai) lines.push({ text: 'AI(あなたが設定している LLM)に、指示を送り、返答を、キャラのセリフとして出す(指示の内容が、あなたの LLM に送られます)', danger: false })
  if (p.context) lines.push({ text: '会話に、「最近の話題」(Mod が持つ短い文章)を足す(キャラが、その話題を知っている状態になります)', danger: false })
  if (p.ui.list) lines.push({ text: '見出しの一覧の窓を出す(Mod が渡した、文字と小さなアイコンを並べるだけ。窓の表示は、Mod タブで ON/OFF できます)', danger: false })
  if (p.ui.openLink) lines.push({ text: '一覧の項目を選んだとき、あなたがボタンを押した場合だけ、その記事(https)を、ふだんのブラウザで開く', danger: false })
  if (lines.length === 0) lines.push({ text: '特別な権限は、必要ありません(ルールのアクションを受け取るだけ)', danger: false })
  return lines
}
