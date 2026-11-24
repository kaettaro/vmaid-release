// どのモーションが、いまのキャラ(モデルの種類)で再生できるか。Electron/Three.js 非依存。
// ステージ(VrmStage / MmdStage)の判定と同じ規則: VRM のモデルは、VRMA と内蔵(MMD 対応が ON なら VMD も変換して)。
// PMX のモデルは、VMD と内蔵と VRMA(VRMA は、PMX の骨へ変換して再生する。vrmaToMmd.ts)。

export interface PlayableInput {
  /** 登録されているすべてのモーションの名前(内蔵・Mod・登録) */
  names: readonly string[]
  /** そのうち、VMD のもの(MMD 対応が ON のときだけ入る) */
  vmd: readonly string[]
  /** MMD 対応が ON か(ON なら、VRM のモデルも、VMD を変換して再生できる) */
  vmdToVrm?: boolean
}

/** モデルの種類に合わせて、再生できるモーションの名前を返す(元の順を保つ) */
export function playableMotions(kind: 'vrm' | 'pmx', input: PlayableInput): string[] {
  const vmd = new Set(input.vmd)
  if (kind === 'pmx') return [...input.names]
  return input.vmdToVrm ? [...input.names] : input.names.filter((n) => !vmd.has(n))
}
