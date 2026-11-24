#!/usr/bin/env node
// 公開ベータの ZIP を作る(Windows 用)。事前に、次を済ませておく:
//   1) npm run build:dir        → release/win-unpacked/
//   2) node scripts/build-beta-set.mjs → beta/mods/*.vmaidmod
//   3) AliciaSolid.vrm を、リポジトリの直下に置く(.gitignore 済み)
// 出力: beta/VMaid-beta-<version>-win/ と、beta/VMaid-beta-<version>-win.zip
// 出力(beta/)はリポジトリに入れない(.gitignore)。公開は GitHub Releases に ZIP を置く。
// 同梱する素材は、再配布できると確認できたものだけ(AliciaSolid.vrm=ニコニ立体の配布ページで「再配布: 可能」。モーションは自動生成のみ)。
// 再配布できない素材を入れた友人限定版を作るときは、build-beta-set.mjs --with-starter と、手で Mod/ へ足す(この版では入れない)。
// 使い方: node scripts/make-beta-zip.mjs
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf-8')).version
const name = `VMaid-beta-${version}-win`
const root = join(repo, 'beta')
const stage = join(root, name)
const zip = join(root, `${name}.zip`)

const need = [
  [join(repo, 'release', 'win-unpacked', 'VMaid.exe'), 'npm run build:dir を先に実行してください'],
  [join(root, 'mods', 'news-rss.vmaidmod'), 'node scripts/build-beta-set.mjs を先に実行してください'],
  [join(repo, 'AliciaSolid.vrm'), 'AliciaSolid.vrm をリポジトリの直下に置いてください']
]
for (const [p, hint] of need) if (!existsSync(p)) throw new Error(`見つかりません: ${p}\n${hint}`)

rmSync(stage, { recursive: true, force: true })
rmSync(zip, { force: true })
mkdirSync(join(stage, 'Mod'), { recursive: true })
mkdirSync(join(stage, 'サンプル'), { recursive: true })

cpSync(join(repo, 'release', 'win-unpacked'), join(stage, 'VMaid'), { recursive: true })
cpSync(join(root, 'mods', 'news-rss.vmaidmod'), join(stage, 'Mod', 'news-rss.vmaidmod'))
cpSync(join(repo, 'AliciaSolid.vrm'), join(stage, 'サンプル', 'AliciaSolid.vrm'))
cpSync(join(repo, 'docs', 'beta-readme.txt'), join(stage, 'はじめに.txt'))
cpSync(join(repo, 'docs', 'BETA_GUIDE.md'), join(stage, 'ベータ手順書.md'))

// 配布に含めない公式 Mod: 性格系(おっとり・元気・クール・ヤンデレ)。リポジトリには残す(2026-11-24 の判断)
const officialDir = join(stage, 'VMaid', 'resources', 'mods', 'official')
for (const e of readdirSync(officialDir)) {
  if (e.startsWith('persona-')) rmSync(join(officialDir, e), { recursive: true, force: true })
}
if (readdirSync(officialDir).some((e) => e.startsWith('persona-'))) throw new Error('性格系 Mod が残っています')

// 検査: 入れてはいけないものが無いこと
const banned = /\.(pmx|vmd|vpd|bvh|fbx|gguf|wav|mp3)$/i
const found = []
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (banned.test(e)) found.push(p)
  }
}
walk(stage)
if (found.length > 0) throw new Error(`入れてはいけない種類のファイルがあります:\n${found.join('\n')}`)

// Windows 標準の tar(bsdtar)で zip にする
// (Git Bash の GNU tar は zip を作れず、「C:」を接続先と誤解するため、System32 の tar を直接使い、相対パスで渡す)
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
const r = spawnSync(tar, ['-a', '-c', '-f', `${name}.zip`, name], { stdio: 'inherit', cwd: root })
if (r.status !== 0) throw new Error('tar での zip 作成に失敗しました')
console.log(`作成: ${zip} (${(statSync(zip).size / 1024 / 1024).toFixed(0)} MB)`)
