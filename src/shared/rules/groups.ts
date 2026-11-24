// ルールのトリガー・条件・アクションの選択肢を、**所属**(標準 / どの Mod が足したか)でまとめる(画面の見出しと、所属 Mod の表示だけ。動作は変えない)。
// 標準のものは「標準」、Mod が足したもの(機能 Mod の modId、スクリプト Mod の `<modId>/<種類>`)は、その Mod の名前の見出しの下に出す。

import { featureModName } from '../mods/features'
import type { NodeDef } from './definitions'

export interface NodeGroup {
  /** 標準は 'standard'、Mod は Mod の id */
  id: string
  label: string
}

export const STANDARD_GROUP: NodeGroup = { id: 'standard', label: '標準' }

/** 種類を足した Mod の id(機能 Mod の modId、またはスクリプト Mod の `<modId>/<種類>`)。標準なら undefined */
export function ownerModId(def: Pick<NodeDef, 'type' | 'modId'>): string | undefined {
  if (def.modId) return def.modId
  const i = def.type.indexOf('/')
  return i > 0 ? def.type.slice(0, i) : undefined
}

/** 所属する Mod の名前(標準なら undefined)。種類の選択欄の横の、バッジに使う */
export function ownerLabel(def: Pick<NodeDef, 'type' | 'modId'>): string | undefined {
  const id = ownerModId(def)
  return id === undefined ? undefined : featureModName(id)
}

/** 種類の所属(見出し) */
export function groupOf(def: Pick<NodeDef, 'type' | 'modId'>): NodeGroup {
  const id = ownerModId(def)
  return id === undefined ? STANDARD_GROUP : { id, label: featureModName(id) }
}

/** 種類の一覧を、所属ごとにまとめる。「標準」が先頭で、Mod は、最初に出てきた順。それぞれの中は、元の順 */
export function groupDefs<T extends Pick<NodeDef, 'type' | 'modId'>>(defs: readonly T[]): Array<{ group: NodeGroup; defs: T[] }> {
  const out: Array<{ group: NodeGroup; defs: T[] }> = []
  for (const d of defs) {
    const group = groupOf(d)
    const found = out.find((g) => g.group.id === group.id)
    if (found) found.defs.push(d)
    else out.push({ group, defs: [d] })
  }
  return out.sort((a, b) => Number(b.group.id === STANDARD_GROUP.id) - Number(a.group.id === STANDARD_GROUP.id))
}
