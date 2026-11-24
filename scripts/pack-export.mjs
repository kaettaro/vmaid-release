#!/usr/bin/env node
// パックのフォルダを、1つの .vmaidpack(zip)にする(自分の別のPC — Mac → Windows など — へ移す用)。
// アプリの 設定 →「パック」→「書き出す」と同じ形式(取り込みは、アプリの「.vmaidpack を取り込む…」)。
// 使い方: node scripts/pack-export.mjs <パックのフォルダ> [--out <出力する.vmaidpack>]
// **再配布しないこと**(私用パックの素材は、配布元の規約で、再配布が許されていないことがある)。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { zipSync } from 'fflate'
import { parse } from 'yaml'

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out')
if (!dir) {
  console.error('使い方: node scripts/pack-export.mjs <パックのフォルダ> [--out <出力する.vmaidpack>]')
  process.exit(1)
}
const root = resolve(dir)
const manifestPath = join(root, 'pack.yaml')
if (!existsSync(manifestPath)) {
  console.error(`pack.yaml が見つかりません: ${manifestPath}`)
  process.exit(1)
}
const manifestText = readFileSync(manifestPath, 'utf-8')
const manifest = parse(manifestText)
const safe = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\\') && !p.includes(':') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..')
const files = { 'pack.yaml': new TextEncoder().encode(manifestText) }
for (const m of manifest.motions ?? []) {
  if (!safe(m.file) || !m.file.toLowerCase().endsWith('.vrma')) throw new Error(`不正なファイルの指定: ${m.file}`)
  files[m.file] = new Uint8Array(readFileSync(join(root, m.file)))
}
for (const extra of ['README.txt', 'README.md']) if (existsSync(join(root, extra))) files[extra] = new Uint8Array(readFileSync(join(root, extra)))
const outIdx = args.indexOf('--out')
const out = resolve(outIdx >= 0 ? args[outIdx + 1] : `${basename(root)}.vmaidpack`)
writeFileSync(out, zipSync(files, { level: 1 }))
console.log(`${Object.keys(files).length} 個のファイルを書き出しました: ${out}`)
