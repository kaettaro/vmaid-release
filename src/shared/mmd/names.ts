// MMD 対応 Mod の、Electron/Three.js に依存しない部分(テストできる)。

/** VMD ファイルの先頭 30 バイトの印(Shift_JIS だが、先頭の ASCII 部分だけ見れば足りる) */
const VMD_MAGIC = 'Vocaloid Motion Data'

/** データが VMD か(VRMA など別の形式を、MMD のモデルで再生しようとしないため) */
export function isVmd(data: Uint8Array): boolean {
  if (data.length < VMD_MAGIC.length) return false
  for (let i = 0; i < VMD_MAGIC.length; i++) if (data[i] !== VMD_MAGIC.charCodeAt(i)) return false
  return true
}

/** VRM 風の表情名 → MMD で、よく使われるモーフ名(あるものを、先に見つかった順で使う) */
const MORPH_ALIASES: Record<string, string[]> = {
  blink: ['まばたき', 'まばたき(左)'],
  happy: ['笑い', 'にこり', 'にっこり', '喜び'],
  angry: ['怒り', 'ジト目'],
  sad: ['悲しい', '困る', '悲しみ'],
  relaxed: ['にこり', 'なごみ', '笑い'],
  surprised: ['びっくり', '驚き', 'おどろき'],
  aa: ['あ'],
  ih: ['い'],
  ou: ['う'],
  ee: ['え'],
  oh: ['お']
}

export function morphCandidates(name: string): string[] {
  return MORPH_ALIASES[name] ?? []
}

/** VRM の人体ボーン名 → MMD のボーン名(小道具を付ける骨を、VRM 風の名前で指定できるように)。日本語のボーン名は、そのまま指定できる */
export const HUMANOID_TO_MMD: Record<string, string> = {
  hips: 'センター',
  spine: '上半身',
  chest: '上半身2',
  neck: '首',
  head: '頭',
  leftUpperArm: '左腕',
  leftLowerArm: '左ひじ',
  leftHand: '左手首',
  rightUpperArm: '右腕',
  rightLowerArm: '右ひじ',
  rightHand: '右手首',
  leftUpperLeg: '左足',
  rightUpperLeg: '右足',
  leftFoot: '左足首',
  rightFoot: '右足首'
}

/** 触れ合いの部位を判定する骨(Mod が宣言した部位の骨を含む)。VRM の人体ボーン名 → MMD のボーン名。無い骨は、判定から外れる */
export const TOUCH_BONE_MMD: Record<string, string> = {
  ...HUMANOID_TO_MMD,
  leftShoulder: '左肩',
  rightShoulder: '右肩',
  leftLowerLeg: '左ひざ',
  rightLowerLeg: '右ひざ',
  leftToes: '左つま先',
  rightToes: '右つま先'
}
