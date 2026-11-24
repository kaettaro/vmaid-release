// 体の VMD と表情の VMD の組み合わせ(取り込み時に、同じ名前のまとまりを見つけて、1 つのモーションにする)。純粋関数。
// 判別は、ファイルの中身(ボーンのキー / モーフのキー)で行い、名前は、まとまりを見つけるためだけに使う。

import type { Vmd } from './vmdParse'
import { vmdKind } from './vmdParse'

export interface VmdFileInfo {
  path: string
  kind: ReturnType<typeof vmdKind>
}

export interface VmdPairPlan {
  /** 単独で登録するファイル(体、または、組む相手のいない表情だけのファイル) */
  standalone: string[]
  /** 体のファイルのパス → それに足す、表情のファイルのパス */
  faces: Map<string, string[]>
}

/** パスから、ファイル名(拡張子なし) */
const baseName = (path: string): string => (path.split(/[\\/]/).pop() ?? path).replace(/\.vmd$/i, '')
const dirName = (path: string): string => path.slice(0, Math.max(0, path.length - (path.split(/[\\/]/).pop() ?? '').length))

/** 名前の終わりの「体」「表情」を表す語を除いて、まとまりを見つけるための、比べる名前にする */
const KIND_WORDS = /(?:[ _\-.()（）]*(?:body|face|morph|expression|expr|exp|facial|motion|体|表情|モーフ|ボディ|フェイス|モーション)[ _\-.()（）]*)+$/i
export function pairStem(path: string): string {
  const base = baseName(path)
  const stem = base.replace(KIND_WORDS, '').replace(/[ _\-.()（）]+$/, '')
  return stem === '' ? base : stem
}

/**
 * 選んだ VMD から、組み合わせを決める。
 * - 同じフォルダで、比べる名前が同じものを、1 つのまとまりとする。
 * - まとまりの中に、体(ボーンのキーがあるもの)があれば、表情だけのファイルを、その体に足す(体が複数なら、最初の 1 つ)。
 * - 体が無ければ、表情だけのファイルは、単独で登録する。中身が空のファイルは、単独のまま(取り込みの検査で外れる)。
 */
export function planVmdPairs(files: readonly VmdFileInfo[]): VmdPairPlan {
  const groups = new Map<string, VmdFileInfo[]>()
  for (const f of files) {
    const key = `${dirName(f.path)}\u0000${pairStem(f.path)}`
    const list = groups.get(key)
    if (list) list.push(f)
    else groups.set(key, [f])
  }
  const standalone: string[] = []
  const faces = new Map<string, string[]>()
  for (const list of groups.values()) {
    const base = list.find((f) => f.kind === 'body' || f.kind === 'both')
    for (const f of list) {
      if (f.kind === 'face' && base) {
        const cur = faces.get(base.path)
        if (cur) cur.push(f.path)
        else faces.set(base.path, [f.path])
      } else standalone.push(f.path)
    }
  }
  return { standalone, faces }
}

/** 種類の判定(ファイルの中身から) */
export const kindOf = (vmd: Vmd): VmdFileInfo['kind'] => vmdKind(vmd)
