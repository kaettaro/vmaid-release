#!/usr/bin/env node
// 友人配布(ベータ)用の Mod ファイルを作る(開発者が手動で実行する。アプリ本体は通信しない)。
//   beta/mods/beta-starter.vmaidmod … 友人限定の初期セット(--with-starter を付けたときだけ。モーション 17 本 + ルール)
//   beta/mods/news-rss.vmaidmod     … ニュース(RSS)(examples/mods/news-rss。スクリプト Mod)
// **出力(beta/)はリポジトリに入れない(.gitignore)。初期セットは再配布できない素材を含むので、公開の ZIP には入れない(2026-11-24)。**
//
// 素材の出どころ(開発者の手元):
//   1) userData/mods/individual/community-vrma/ … fetch-private-pack.mjs で取得した、VRoid 公式 VRMA 7 本・idle×5・talking
//   2) userData/motions-converted/*-v4/<名前>.vrma … 挨拶・感謝・なでる反応の 4 本(名前の完全一致で選ぶ。成人向けの混入防止)
// 権利: 友人限定の配布(2026-11-18 の判断)。VRoid 公式は規約上、二次配布が禁止のため、友人以外へ渡さないこと(docs/MOTION_SOURCES.md)。
// 使い方: node scripts/build-beta-set.mjs [--with-starter] [--out beta] [--user-data <vmaid の userData フォルダ>]
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const args = process.argv.slice(2)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)

function defaultUserData() {
  const home = homedir()
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'vmaid')
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'vmaid')
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'vmaid')
}
const userData = resolve(opt('--user-data', defaultUserData()))
const outDir = resolve(opt('--out', join(repo, 'beta')))
const modsOut = join(outDir, 'mods')
mkdirSync(modsOut, { recursive: true })

// ---- news-rss(スクリプト Mod。自作・公開してよい) ----
const newsDir = join(repo, 'examples', 'mods', 'news-rss')
const news = {
  'mod.yaml': new Uint8Array(readFileSync(join(newsDir, 'mod.yaml'))),
  'main.js': new Uint8Array(readFileSync(join(newsDir, 'main.js')))
}
writeFileSync(join(modsOut, 'news-rss.vmaidmod'), zipSync(news, { level: 1 }))
console.log('news-rss.vmaidmod: 2 ファイル')

// ---- 友人限定の初期セット(--with-starter を付けたときだけ。公開用の ZIP には入れない) ----
if (!args.includes('--with-starter')) {
  console.log(`出力先: ${modsOut}(初期セットは作っていません。友人限定版は --with-starter)`)
  process.exit(0)
}

const q = (s) => JSON.stringify(s)
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const isGlb = (buf) => buf.subarray(0, 4).toString('latin1') === 'glTF'

// ---- 1) 既存の私用パック(community-vrma)の 13 本 ----
const srcPack = join(userData, 'mods', 'individual', 'community-vrma')
const VRMA13 = [
  ['vroid-1', 'VRMA_01.vrma', 'VRoid公式 1(全身を見せる)'],
  ['vroid-2', 'VRMA_02.vrma', 'VRoid公式 2(挨拶)'],
  ['vroid-3', 'VRMA_03.vrma', 'VRoid公式 3(Vサイン)'],
  ['vroid-4', 'VRMA_04.vrma', 'VRoid公式 4(撃つ)'],
  ['vroid-5', 'VRMA_05.vrma', 'VRoid公式 5(回る)'],
  ['vroid-6', 'VRMA_06.vrma', 'VRoid公式 6(モデルポーズ)'],
  ['vroid-7', 'VRMA_07.vrma', 'VRoid公式 7(屈伸運動)'],
  ['idle-1', 'idle.vrma', '待機 1'],
  ['idle-2', 'idle_2.vrma', '待機 2'],
  ['idle-3', 'idle_3.vrma', '待機 3'],
  ['idle-4', 'idle_4.vrma', '待機 4'],
  ['idle-5', 'idle_5.vrma', '待機 5'],
  ['talking', 'talking.vrma', 'おしゃべり']
]
// ---- 2) 変換済みの 4 本(許可リスト。これ以外は、絶対に入れない) ----
const CONVERTED = [
  ['greeting', 'action_greeting', '挨拶'],
  ['gratitude', 'gratitude', '感謝'],
  ['caring', 'caring', 'いたわり(なでる反応)'],
  ['pat', 'action_pat', '頭をなでる反応']
]

const files = {}
const motionLines = []
for (const [name, file, label] of VRMA13) {
  const p = join(srcPack, 'motions', file)
  if (!existsSync(p)) throw new Error(`見つかりません: ${p}\n先に node scripts/fetch-private-pack.mjs を実行してください`)
  const buf = readFileSync(p)
  if (!isGlb(buf)) throw new Error(`VRMA(glb)ではありません: ${p}`)
  files[`motions/${file}`] = new Uint8Array(buf)
  const official = file.startsWith('VRMA_')
  const tags = [official ? 'VRoid公式' : null, /^idle-[2-5]$/.test(name) ? '待機バリエーション' : null].filter(Boolean)
  motionLines.push(
    `  - name: ${name}`,
    `    file: motions/${file}`,
    `    source: ${q(`github.com/aikeyaorg/aikeya static/animations/${file} (commit 640fd29b411e…, sha256 ${sha(buf).slice(0, 16)}…)`)}`,
    `    license: ${q(official ? 'VRoid Project(ピクシブ株式会社)公式 VRMA。商用はクレジット必須。二次配布は規約で禁止のため、友人限定。' : '制作者・ライセンスは未確認(友人限定)。')}`,
    `    redistributable: false`
  )
  if (official) motionLines.push(`    attribution: ${q('キャラクターアニメーション: ピクシブ株式会社 VRoidプロジェクト')}`)
  if (tags.length > 0) motionLines.push(`    tags: ${JSON.stringify(tags)}`)
  void label
}

const convRoot = join(userData, 'motions-converted')
for (const [name, base, label] of CONVERTED) {
  const hits = readdirSync(convRoot)
    .filter((d) => d.endsWith('-v4'))
    .map((d) => join(convRoot, d, `${base}.vrma`))
    .filter((p) => existsSync(p))
  if (hits.length !== 1) throw new Error(`${base}.vrma の候補が ${hits.length} 件です(1 件のはず): ${hits.join(', ')}`)
  const buf = readFileSync(hits[0])
  if (!isGlb(buf)) throw new Error(`VRMA(glb)ではありません: ${hits[0]}`)
  const file = `${base}.vrma`
  files[`motions/${file}`] = new Uint8Array(buf)
  motionLines.push(
    `  - name: ${name}`,
    `    file: motions/${file}`,
    `    source: ${q(`Spicy-VRM-Animations(test157t)由来の一般向けモーション「${base}」(sha256 ${sha(buf).slice(0, 16)}…)。${label}`)}`,
    `    license: ${q('ライセンスの記載なし(未確認。友人限定)。')}`,
    `    redistributable: false`
  )
}

const rules = readFileSync(join(here, 'private-packs', 'community-vrma', 'rules.yaml'), 'utf-8')
  .split('\n')
  .filter((l) => !l.startsWith('#'))
  .join('\n')
  .trim()
const extraRules = `
  # --- 初期セットで足した、挨拶・感謝・なでる反応 ---
  - id: word-greeting
    description: 「こんにちは」「おはよう」などと入力すると、挨拶のしぐさをする
    when: { trigger: userMessage, keywords: ["こんにちは", "おはよう", "こんばんは", "はじめまして"] }
    do:
      - { action: playMotion, motion: greeting }

  - id: word-thanks
    description: 「ありがとう」と入力すると、感謝のしぐさをする
    when: { trigger: userMessage, keywords: ["ありがとう", "感謝", "助かった"] }
    do:
      - { action: playMotion, motion: gratitude }

  - id: pat-head
    description: 頭をなでてもらうと、なでられた反応をする
    when: { trigger: stroke, part: head, minSec: 2 }
    if:
      - { condition: cooldown, sec: 45 }
    do:
      - { action: playMotion, motion: pat }

  - id: caring-hand
    description: 手を長押しすると、いたわるしぐさをする
    when: { trigger: hold, part: hand, minSec: 3 }
    if:
      - { condition: cooldown, sec: 60 }
    do:
      - { action: playMotion, motion: caring }`

const manifest = [
  '# 初期セット(ベータ配布用。友人限定・再配布しないこと)。scripts/build-beta-set.mjs が作成。',
  'id: beta-starter',
  `name: ${q('初期セット(ベータ)')}`,
  'version: "0.1.0"',
  'distribution: private',
  `description: ${q('会話・ふれあい用のモーション 17 本(VRoid 公式 7・待機 5・おしゃべり・挨拶・感謝・なでる反応)と、そのルール。友人限定の配布のため、再配布しないでください。')}`,
  'motions:',
  ...motionLines,
  '',
  'rules:',
  rules.replace(/^rules:\s*\n/, '') + '\n' + extraRules,
  ''
].join('\n')

files['mod.yaml'] = new TextEncoder().encode(manifest)
files['README.txt'] = new TextEncoder().encode(
  'VMaid ベータの初期セットです。友人限定の配布で、再配布しないでください。\n出典と権利は、同梱の「ベータ手順書」の「素材の出典」を見てください。\n'
)
writeFileSync(join(modsOut, 'beta-starter.vmaidmod'), zipSync(files, { level: 1 }))
console.log(`beta-starter.vmaidmod: ${Object.keys(files).length} ファイル`)
console.log(`出力先: ${modsOut}`)
