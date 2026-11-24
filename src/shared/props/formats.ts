// 小道具の形式(glb / fbx / pmx)。Electron/Three.js に依存しない純粋ロジック。
// glb は標準(「小道具」Mod)。fbx は「FBX インポーター」Mod、pmx は「PMX/X インポーター」Mod が ON のときだけ使える(.x は未対応)。

export type PropKind = 'glb' | 'fbx' | 'pmx'

/** レンダラーへ渡す、小道具の中身。glb・fbx は中身そのもの、pmx は専用プロトコルの URL(テクスチャが、別ファイルなので) */
export type PropPayload = { kind: 'glb' | 'fbx'; data: Uint8Array } | { kind: 'pmx'; url: string }

/** ファイルの拡張子から、形式を決める。対応していなければ null */
export function propKindOf(file: string): PropKind | null {
  const m = /\.([a-z0-9]+)$/i.exec(file)
  const ext = m?.[1].toLowerCase()
  return ext === 'glb' || ext === 'fbx' || ext === 'pmx' ? ext : null
}

/** その形式を使うのに必要な、公式の機能 Mod の id */
export const PROP_KIND_MOD: Record<PropKind, string> = { glb: 'props', fbx: 'fbx-import', pmx: 'pmx-import' }

/** 形式ごとの、1単位が、何メートルか(Mod の指定の大きさ(scale)の前に掛ける)。FBX は cm が普通、MMD は 1 単位が約 8cm */
export const PROP_FORMAT_UNIT: Record<PropKind, number> = { glb: 1, fbx: 0.01, pmx: 0.08 }

export const MAX_PROP_FBX_BYTES = 50 * 1024 * 1024
export const MAX_PROP_PMX_BYTES = 100 * 1024 * 1024

/** PMX の先頭の印(`PMX ` の4文字) */
export function looksLikePmx(data: Uint8Array): boolean {
  return data.length > 8 && data[0] === 0x50 && data[1] === 0x4d && data[2] === 0x58 && data[3] === 0x20
}

/** FBX の先頭の印: バイナリ(`Kaydara FBX Binary`)、またはテキスト(`; FBX` で始まる) */
export function looksLikeFbx(data: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(data.subarray(0, 32))
  return head.startsWith('Kaydara FBX Binary') || head.trimStart().startsWith('; FBX')
}
