import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { app, dialog } from 'electron'
import { featureModName } from '../shared/mods/features'
import { describePermissions } from '../shared/scripts/spec'
import { parsePackYaml, pickManifest } from '../shared/packs/manifest'
import { MOD_FILE_EXT, PACK_FILE_EXT, packToZip, unzipPack } from '../shared/packs/transfer'
import type { PackStore } from './packStore'

/** 取り込む .vmaidpack の大きさの上限(バイト)。展開後の上限は、別に検査する */
const MAX_PACK_FILE_BYTES = 600 * 1024 * 1024

export interface PackActionOutcome {
  ok: boolean
  message: string
  /** 取り込み・書き出しで、パックが変わったか */
  changed: boolean
}

/**
 * 自作 Mod(individual)を、1つのファイル(.vmaidmod)に書き出す。**自分の別のPC(Mac → Windows など)へ移すための専用の入口**。
 * ルールの共有書き出し(exportRules)や配布物には、自作 Mod は含まれない。
 */
export function exportIndividualMod(packs: PackStore, id: string): PackActionOutcome {
  const files = packs.exportFiles(id)
  if (!files) return { ok: false, changed: false, message: '書き出せる自作 Mod が見つかりません' }
  app.focus({ steal: true })
  const go = dialog.showMessageBoxSync({
    type: 'warning',
    message: `自作 Mod「${id}」を書き出します`,
    detail:
      'このファイルは、**あなた自身の別のPCへ移すためのもの**です。中に含まれるモーションなどは、配布元の規約で、再配布が許されていないことがあります。\n' +
      '他の人への配布・公開・共有には使わないでください。',
    buttons: ['書き出す', 'キャンセル'],
    defaultId: 1,
    cancelId: 1
  })
  if (go !== 0) return { ok: false, changed: false, message: '' }
  const path = dialog.showSaveDialogSync({
    title: '自作 Mod を書き出す(自分の別のPCへ移す用)',
    defaultPath: `${id}${MOD_FILE_EXT}`,
    filters: [{ name: 'VMaid Mod', extensions: [MOD_FILE_EXT.slice(1)] }]
  })
  if (!path) return { ok: false, changed: false, message: '' }
  try {
    writeFileSync(path, packToZip(files))
  } catch (e) {
    return { ok: false, changed: false, message: `書き出せませんでした: ${e instanceof Error ? e.message : String(e)}` }
  }
  return { ok: true, changed: false, message: `${Object.keys(files).length}個のファイルを書き出しました: ${path}` }
}

/** .vmaidmod(旧 .vmaidpack)を、コミュニティ Mod として取り込む(community フォルダへ)。中身を確認してから追加し、追加直後は OFF(利用者が ON にする) */
export function importCommunityMod(packs: PackStore): PackActionOutcome {
  app.focus({ steal: true })
  const paths = dialog.showOpenDialogSync({
    title: 'Mod を取り込む',
    properties: ['openFile'],
    filters: [{ name: 'VMaid Mod', extensions: [MOD_FILE_EXT.slice(1), PACK_FILE_EXT.slice(1)] }]
  })
  if (!paths || paths.length === 0) return { ok: false, changed: false, message: '' }
  const src = paths[0]
  let bytes: Uint8Array
  try {
    if (statSync(src).size > MAX_PACK_FILE_BYTES) return { ok: false, changed: false, message: 'ファイルが大きすぎます' }
    bytes = new Uint8Array(readFileSync(src))
  } catch {
    return { ok: false, changed: false, message: 'ファイルを読み込めませんでした' }
  }
  const unzipped = unzipPack(bytes)
  if (!unzipped.ok) return { ok: false, changed: false, message: `取り込めません: ${unzipped.error}` }
  const parsed = parsePackYaml(new TextDecoder('utf-8').decode(unzipped.files[pickManifest(unzipped.files) ?? 'mod.yaml']), { category: 'community' })
  if (!parsed.pack) return { ok: false, changed: false, message: `取り込めません: ${parsed.errors.join(' / ')}` }
  const pack = parsed.pack
  if (pack.feature !== undefined) return { ok: false, changed: false, message: 'この Mod は、本体の機能と結びつく指定(feature)を持っています。公式の Mod だけが使える指定なので、取り込めません' }
  for (const m of pack.motions) {
    if (!(m.file in unzipped.files)) return { ok: false, changed: false, message: `取り込めません: モーション「${m.name}」のファイル(${m.file})が入っていません` }
  }
  // スクリプトを含む Mod は、「開発者向け」が ON のときだけ取り込める(既定 OFF。なりすましの配布・うっかり導入を避けるため)
  if (pack.script && !packs.developerMode()) {
    return { ok: false, changed: false, message: 'この Mod には、スクリプトが含まれています。設定 →「Mod」の「開発者向け」を ON にすると、取り込めます(信頼できる配布元のものだけを入れてください)' }
  }
  // 取り込む前に、中身を見せて確認する(追加直後は OFF)。Mod は、ルールでキャラの反応を変え、モーションを足せる
  const ruleIds = pack.ruleSet.rules.map((r) => r.id.replace(`${pack.id}/`, ''))
  const detail = [
    pack.description,
    `ルール ${pack.ruleSet.rules.length} 件 / モーション ${pack.motions.length} 件`,
    pack.requires.length > 0 ? `必要な機能 Mod: ${pack.requires.map(featureModName).join('、')}` : '',
    ruleIds.length > 0 ? `ルール: ${ruleIds.slice(0, 8).join(', ')}${ruleIds.length > 8 ? ' ほか' : ''}` : '',
    ...(pack.script
      ? [
          '',
          '⚠ この Mod には、スクリプト(プログラム)が含まれます。次の権限で動きます:',
          ...describePermissions(pack.script).map((l) => `${l.danger ? '⚠ ' : '・'}${l.text}`),
          'スクリプトは、サンドボックスの中で動き、ファイル・OS には触れません。ただし、CPU を使い続けて、動作を重くすることは、防げません。信頼できる配布元のものだけを入れてください。',
          '追加した直後は OFF で、「Mod」タブで内容を確認して ON にします。'
        ]
      : ['この Mod にコードは含まれません(通信もしません)。追加した直後は OFF で、「Mod」タブで ON にすると使えます。いつでも OFF にして、元に戻せます。'])
  ]
    .filter(Boolean)
    .join('\n')
  const ok = dialog.showMessageBoxSync({ type: 'question', message: `Mod「${pack.name}」(v${pack.version})を追加します`, detail, buttons: ['追加する', 'キャンセル'], defaultId: 1, cancelId: 1 })
  if (ok !== 0) return { ok: false, changed: false, message: '' }
  const root = packs.ensureCommunityDir()
  const target = join(root, pack.id)
  if (existsSync(target)) {
    const go = dialog.showMessageBoxSync({
      type: 'question',
      message: `Mod「${pack.id}」は、すでにあります`,
      detail: '置き換えます。いまのものは、`mods/backup/` に残します(1つ前の世代のみ)。',
      buttons: ['置き換える', 'キャンセル'],
      defaultId: 1,
      cancelId: 1
    })
    if (go !== 0) return { ok: false, changed: false, message: '' }
    const backup = join(dirname(root), 'backup')
    mkdirSync(backup, { recursive: true })
    const old = join(backup, pack.id)
    try {
      if (existsSync(old)) renameSync(old, `${old}.old`) // 古いバックアップを、さらに1つ前へ(その前のものは、上書き)
      renameSync(target, old)
    } catch (e) {
      return { ok: false, changed: false, message: `いまの Mod を退避できませんでした: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  try {
    const realTarget = resolve(target)
    for (const [rel, data] of Object.entries(unzipped.files)) {
      const dest = resolve(target, rel)
      if (!dest.startsWith(realTarget + sep)) return { ok: false, changed: false, message: `取り込めません: 危険なパス(${rel})` } // 念のための二重の確認
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, data)
    }
  } catch (e) {
    return { ok: false, changed: false, message: `書き込めませんでした: ${e instanceof Error ? e.message : String(e)}` }
  }
  packs.setEnabled(pack.id, false) // 追加直後は OFF
  return { ok: true, changed: true, message: `Mod「${pack.name}」を追加しました(いまは OFF です。「Mod」タブで ON にすると使えます)` }
}
