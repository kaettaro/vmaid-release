// 配布物に含まれる本番依存(dependencies とその依存)のライセンス表記を、THIRD_PARTY_LICENSES.md に書き出す。
// 使い方: npm run licenses (build:mac / build:win の中でも実行される)
// 追加の依存を入れずに、node_modules の package.json と LICENSE ファイルを読むだけで作る。
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(import.meta.dirname, '..')
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** name のパッケージのディレクトリを、from から親へ辿って探す(Nodeの解決と同じ) */
function locate(name, from) {
  for (let d = from; ; d = dirname(d)) {
    const p = join(d, 'node_modules', name)
    if (existsSync(join(p, 'package.json'))) return p
    if (d === dirname(d)) return null
  }
}

const found = new Map()
function visit(name, from) {
  const dir = locate(name, from)
  if (!dir || found.has(dir)) return
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  found.set(dir, pkg)
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep, dir)
}
for (const dep of Object.keys(rootPkg.dependencies ?? {})) visit(dep, root)

const licenseOf = (pkg) => (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? (pkg.licenses ?? []).map((l) => l.type).join(' OR ') ?? 'UNKNOWN') || 'UNKNOWN'
const repoOf = (pkg) => (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? '').replace(/^git\+/, '')

function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying|notice)(\.(md|txt))?$/i.test(f))
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null
}

const entries = [...found.entries()]
  .map(([dir, pkg]) => ({ dir, name: pkg.name, version: pkg.version, license: licenseOf(pkg), repo: repoOf(pkg), text: licenseText(dir) }))
  .sort((a, b) => a.name.localeCompare(b.name))

// 寛容でないライセンス(GPL/AGPL/非商用など)が混ざっていたら、ビルドを止める(CLAUDE.md: 入れる前に相談する)
const PERMISSIVE = /^(MIT|ISC|BSD-[23]-Clause|Apache-2\.0|BlueOak-1\.0\.0|0BSD|Unlicense|CC0-1\.0|Python-2\.0)$/i
const bad = entries.filter((e) => !e.license.split(/\s+(?:OR|AND)\s+|[()]/).filter(Boolean).some((l) => PERMISSIVE.test(l.trim())))
if (bad.length > 0) {
  console.error('寛容ライセンスと確認できない依存があります。内容を確認してください:')
  for (const b of bad) console.error(`  ${b.name}@${b.version}: ${b.license}`)
  process.exit(1)
}

const lines = [
  '# サードパーティのライセンス表記',
  '',
  'VMaid は、次のオープンソースソフトウェアを含みます。(このファイルは `npm run licenses` で自動生成されます)',
  '',
  'Electron と Chromium のライセンスは、配布物に同梱の `LICENSE.electron.txt` / `LICENSES.chromium.html` を参照してください。',
  '',
  `## 一覧(${entries.length}件)`,
  '',
  '| パッケージ | バージョン | ライセンス |',
  '|---|---|---|',
  ...entries.map((e) => `| ${e.name} | ${e.version} | ${e.license} |`),
  '',
  '## ライセンス本文',
  ''
]
for (const e of entries) {
  lines.push(`### ${e.name}@${e.version} (${e.license})`, '')
  if (e.repo) lines.push(e.repo, '')
  lines.push(e.text ? ['```', e.text, '```'].join('\n') : '(ライセンスファイルは同梱されていません。上記のライセンス種別に従います)', '')
}
writeFileSync(join(root, 'THIRD_PARTY_LICENSES.md'), lines.join('\n'), 'utf8')
console.log(`THIRD_PARTY_LICENSES.md を出力しました(${entries.length}件)`)
