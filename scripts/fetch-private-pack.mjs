#!/usr/bin/env node
// 私用パック「community-vrma」を作る(開発者が手動で実行するスクリプト。アプリ本体は通信しない)。
// 公開の GitHub リポジトリ(aikeyaorg/aikeya)にある VRMA を、**固定したコミット**から取得して、アプリのデータフォルダの
// mods/individual/community-vrma/ に置く。**リポジトリ(Git)には入れない。再配布しない。**
//
// 権利について(docs/MOTION_SOURCES.md を参照。2026-10-16 確認):
//   - VRMA_01〜07 は、VRoid Project(ピクシブ株式会社)の公式 VRMA(BOOTH)と同名。規約で「許可なく取り出せる状態での二次配布」が禁止。
//     → このスクリプトで取得したものは、**自分の私用**にとどめ、配布・公開しないこと。
//   - idle*.vrma / talking.vrma の制作者・ライセンスは、確認できていない(未確認)。→ 私用。
// 使い方: node scripts/fetch-private-pack.mjs [--out <mods/individual のフォルダ>]
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const REPO = 'aikeyaorg/aikeya'
const COMMIT = '640fd29b411ed3ace5725c124eb3dbd5a467d2b2' // 固定(2026-10-16 時点の main)。中身が変わっても、同じものを取得する
const BASE = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/static/animations`
const PACK_ID = 'community-vrma'
const MAX_BYTES = 30 * 1024 * 1024

/** [登録名, ファイル名, 説明] — VRMA_01〜07 の内容は、BOOTH の一覧の順(全身/挨拶/Vサイン/撃つ/回る/モデルポーズ/屈伸)に基づく(要・目視確認) */
const MOTIONS = [
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

function defaultPrivateDir() {
  const home = homedir()
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'vmaid', 'mods', 'individual')
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'vmaid', 'mods', 'individual')
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'vmaid', 'mods', 'individual')
}

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outRoot = resolve(outIdx >= 0 ? args[outIdx + 1] : defaultPrivateDir())
const dir = join(outRoot, PACK_ID)

async function download(file) {
  const url = `${BASE}/${file}`
  const res = await fetch(url, { redirect: 'error' })
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error(`${file}: 大きすぎます`)
  if (buf.subarray(0, 4).toString('latin1') !== 'glTF') throw new Error(`${file}: VRMA(glb)ではありません`)
  return buf
}

console.log(`私用パック ${PACK_ID} を作ります → ${dir}`)
console.log('※ 自分の私用にとどめ、配布・公開しないでください(docs/MOTION_SOURCES.md)')
mkdirSync(join(dir, 'motions'), { recursive: true })

const entries = []
for (const [name, file, label] of MOTIONS) {
  process.stdout.write(`  ${file} … `)
  const buf = await download(file)
  const tmp = join(dir, 'motions', `${file}.tmp`)
  writeFileSync(tmp, buf)
  renameSync(tmp, join(dir, 'motions', file))
  const sha = createHash('sha256').update(buf).digest('hex')
  console.log(`${(buf.length / 1024).toFixed(0)} KB`)
  entries.push({ name, file, label, sha })
}

const here = dirname(fileURLToPath(import.meta.url))
const rulesText = readFileSync(join(here, 'private-packs', PACK_ID, 'rules.yaml'), 'utf-8')
const q = (s) => JSON.stringify(s) // YAML の二重引用符つき文字列(JSON と互換)
const lines = [
  `# 私用パック(再配布不可)。scripts/fetch-private-pack.mjs が作成。素材の出典と規約は、docs/MOTION_SOURCES.md を参照。`,
  `id: ${PACK_ID}`,
  `name: ${q('コミュニティVRMA(私用)')}`,
  `version: "0.1.0"`,
  `distribution: private`,
  `description: ${q('VRoid Project 公式 VRMA 7種と、idle×5・talking。待機の変化・なでる反応・トリガーワードのルールつき。自分の私用にとどめ、再配布しないこと。')}`,
  `motions:`
]
for (const e of entries) {
  const official = e.file.startsWith('VRMA_')
  lines.push(
    `  - name: ${e.name}`,
    `    file: motions/${e.file}`,
    `    source: ${q(`https://github.com/${REPO}/blob/${COMMIT}/static/animations/${e.file} (sha256 ${e.sha.slice(0, 16)}…)`)}`,
    `    license: ${q(official ? 'VRoid Project(ピクシブ株式会社)公式 VRMA。改変・商用利用は可(商用はクレジット必須)。許可なく取り出せる状態での二次配布は禁止。' : '制作者・ライセンスは未確認。')}`,
    `    redistributable: false`
  )
  if (official) lines.push(`    attribution: ${q('キャラクターアニメーション: ピクシブ株式会社 VRoidプロジェクト')}`)
  // 待機 2〜5 は、ルールから「待機バリエーション」タグで選ぶ(以前の motionGroups の代わり)
  const tags = [official ? 'VRoid公式' : null, /^idle-[2-5]$/.test(e.name) ? '待機バリエーション' : null].filter(Boolean)
  if (tags.length > 0) lines.push(`    tags: ${JSON.stringify(tags)}`)
}
lines.push('', rulesText.trim(), '')
const manifest = lines.join('\n')
writeFileSync(join(dir, 'pack.yaml'), manifest)
writeFileSync(
  join(dir, 'README.txt'),
  `このフォルダは、VMaid の私用パックです(scripts/fetch-private-pack.mjs で作成)。\n再配布しないでください。出典: https://github.com/${REPO} (commit ${COMMIT})\n詳細: docs/MOTION_SOURCES.md\n`
)
if (!existsSync(join(dir, 'pack.yaml'))) throw new Error('pack.yaml を書けませんでした')
console.log(`完了: ${entries.length} 個のモーションと pack.yaml を書きました。VMaid の設定 →「パック」で確認できます。`)
