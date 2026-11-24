// 触った部位の判定(クリックした場所が、体のどこか)。Electron/Three.js 非依存の純粋ロジック。
//
// 方針: VRM の人体ボーン(Humanoid)の位置は、モデルによって見た目の部位とずれる(特に骨盤まわりは、骨が
// 胴の上のほうに寄っていることがある)。そこで、胴体と頭・脚は「骨の位置」ではなく「身体の高さに対する割合」で
// 区切り、腕と手だけは、肩〜手首の骨(位置が信頼できる)の線分で判定する。モデル個別の特例は持たない。

/** 本体が持つ部位 */
export type BuiltinTouchPart = 'head' | 'chest' | 'belly' | 'hips' | 'arm' | 'hand' | 'leg' | 'foot'
/** 触った部位の名前。本体の部位のほか、Mod が宣言した部位(`touchParts`)の id が入る */
export type TouchPart = string
export type TouchSide = 'left' | 'right' | 'center'

export interface TouchResult {
  part: TouchPart
  /** キャラから見た左右(頭・胸・お腹・腰は center) */
  side: TouchSide
}

export const TOUCH_PARTS: Array<{ value: BuiltinTouchPart; label: string }> = [
  { value: 'head', label: '頭' },
  { value: 'chest', label: '胸' },
  { value: 'belly', label: 'お腹' },
  { value: 'hips', label: '腰' },
  { value: 'arm', label: '腕' },
  { value: 'hand', label: '手' },
  { value: 'leg', label: '脚' },
  { value: 'foot', label: '足' }
]

export interface Point2 {
  x: number
  y: number
}

/** 画面上の骨の位置(px)。判定に必要な骨だけでよい */
export type BonePoints = Readonly<Record<string, Point2 | undefined>>

// --- Mod が宣言する部位(manifest の `touchParts`) ---
// 本体は、部位の「中身」(どこで、何と呼ぶか)を持たない。Mod が、骨の近く(bone)か、身体の高さの帯(band)で宣言する。
// 宣言した部位は、本体の部位より先に判定する(細かい範囲が先)。

/** 左右のある部位に使える骨(VRM の人体ボーン名から left / right を除き、先頭を大文字にしたもの) */
export const TOUCH_BONES_SIDED = ['shoulder', 'upperArm', 'lowerArm', 'hand', 'upperLeg', 'lowerLeg', 'foot', 'toes'] as const
/** 左右のない部位に使える骨 */
export const TOUCH_BONES_CENTER = ['head', 'neck', 'chest', 'spine', 'hips'] as const

export type CustomTouchRegion =
  /** 身体の高さに対する割合の帯(上=0〜足元=1)。halfWidth は、体の中心から左右への幅(高さに対する割合。省略は本体と同じ) */
  | { kind: 'band'; from: number; to: number; halfWidth?: number }
  /** 骨の位置から、この半径(高さに対する割合)の中。sides が true なら、骨の名前に left / right を付けた両側 */
  | { kind: 'bone'; bone: string; radius: number }

export interface CustomTouchPart {
  id: string
  label: string
  /** 左右(キャラの左右)を区別するか。false なら、side は center */
  sides: boolean
  region: CustomTouchRegion
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** 宣言した部位の判定に必要な骨の名前(VRM の人体ボーン名。左右のある部位は両側)。ステージが、画面上の位置を求める骨の一覧に足す */
export function touchBonesOf(parts: readonly CustomTouchPart[]): string[] {
  const out = new Set<string>()
  for (const p of parts) {
    if (p.region.kind !== 'bone') continue
    if (p.sides) {
      out.add('left' + capitalize(p.region.bone))
      out.add('right' + capitalize(p.region.bone))
    } else out.add(p.region.bone)
  }
  return [...out]
}

/** 点 p から線分 a-b への距離 */
export function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * 縦方向の区切り(全身の高さに対する割合。上=0 / 足元=1)。人型のプロポーションに共通の目安。
 * 頭: 上〜21%、胸: 21〜38%、お腹: 38〜46%、腰: 46〜56%、脚: 56〜93%、足: 93〜100%
 * (頭のてっぺんから首元までは、全身の17〜22%ほど。頭の大きいキャラでも、首元までを頭にする)
 */
export const BODY_BANDS: ReadonlyArray<{ part: BuiltinTouchPart; to: number }> = [
  { part: 'head', to: 0.21 },
  { part: 'chest', to: 0.38 },
  { part: 'belly', to: 0.46 },
  { part: 'hips', to: 0.56 },
  { part: 'leg', to: 0.93 },
  { part: 'foot', to: 1 }
]

/** 腕・手の骨(キャラの左右)。肩〜肘〜手首の線分と、手(手首の先)で判定する */
const LIMBS = [
  { side: 'left' as const, chain: ['leftUpperArm', 'leftLowerArm', 'leftHand'] },
  { side: 'right' as const, chain: ['rightUpperArm', 'rightLowerArm', 'rightHand'] }
]

/** 腕・手の触れる範囲(全身の高さに対する割合) */
const ARM_RADIUS = 0.038
const HAND_RADIUS = 0.05
/** 手の判定は、手首から、前腕の向きに、前腕の長さのこの割合だけ先まで(指先まで) */
const HAND_EXTEND = 0.5
/** 体の幅(中心から左右へ)。身体の高さに対する割合。これを超えて離れると、体の外として null */
const BODY_HALF_WIDTH = 0.2

/** 脚・足の左右。左右の脚の骨(なければ足首)の画面上のx座標のうち、近いほう */
function legSide(x: number, bones: BonePoints, centerX: number): 'left' | 'right' {
  const lx = bones.leftUpperLeg?.x ?? bones.leftFoot?.x
  const rx = bones.rightUpperLeg?.x ?? bones.rightFoot?.x
  if (lx !== undefined && rx !== undefined && Math.abs(lx - rx) > 1) {
    return Math.abs(x - lx) <= Math.abs(x - rx) ? 'left' : 'right'
  }
  return x > centerX ? 'left' : 'right'
}

/**
 * クリック位置の部位を判定する。
 * @param point クリック位置(画面のpx)
 * @param bones 骨の名前 → 画面上の位置(px)
 * @param box 体の範囲(画面のpx。top=頭のてっぺん、bottom=足元)
 * @returns 体から遠ければ null
 */
export function classifyTouch(
  point: Point2,
  bones: BonePoints,
  box: { top: number; bottom: number; centerX: number },
  /** Mod が宣言した部位(有効なものだけ)。本体の部位より先に判定する */
  custom: readonly CustomTouchPart[] = []
): TouchResult | null {
  const height = box.bottom - box.top
  if (!(height > 0)) return null

  const declared = classifyCustom(point, bones, box, height, custom)
  if (declared) return declared

  // 1) 腕・手(骨の線分)。手のほうが先: 手首付近は、腕より手を優先する
  let arm: { score: number; side: 'left' | 'right'; part: 'arm' | 'hand' } | null = null
  for (const { side, chain } of LIMBS) {
    const [shoulder, elbow, wrist] = chain.map((n) => bones[n])
    if (shoulder && elbow) consider({ part: 'arm', side, score: distanceToSegment(point, shoulder, elbow) - ARM_RADIUS * height })
    if (elbow && wrist) {
      consider({ part: 'arm', side, score: distanceToSegment(point, elbow, wrist) - ARM_RADIUS * height })
      const tip = { x: wrist.x + (wrist.x - elbow.x) * HAND_EXTEND, y: wrist.y + (wrist.y - elbow.y) * HAND_EXTEND }
      // 手は、手首〜指先の線分。手のほうをわずかに優先(同じ距離なら手)
      consider({ part: 'hand', side, score: distanceToSegment(point, wrist, tip) - HAND_RADIUS * height - 1e-6 })
    }
  }
  function consider(c: { part: 'arm' | 'hand'; side: 'left' | 'right'; score: number }): void {
    if (!arm || c.score < arm.score) arm = c
  }

  // 2) 胴体・頭・脚(身体の高さに対する割合)。体の幅の外なら、胴体ではない
  const dx = Math.abs(point.x - box.centerX)
  const t = (point.y - box.top) / height // 0(頭のてっぺん)〜1(足元)
  const inBodyColumn = dx <= BODY_HALF_WIDTH * height && t >= 0 && t <= 1
  let trunk: { part: TouchPart; side: TouchSide } | null = null
  if (inBodyColumn) {
    const band = BODY_BANDS.find((b) => t <= b.to)
    if (band) {
      const isLimbBand = band.part === 'leg' || band.part === 'foot'
      // 脚・足は、左右の脚の骨のうち近いほうで、キャラの左右を決める(後ろ向きでも、キャラ自身の左右になる)。
      // 脚の骨が無いモデルは、体の中心より画面の右ならキャラの左、とする。胴体・頭は center
      const side: TouchSide = isLimbBand ? legSide(point.x, bones, box.centerX) : 'center'
      trunk = { part: band.part, side }
    }
  }

  // 腕・手の線分に、触れる範囲で入っていれば(score < 0)、胴体より腕・手を優先する(体に重なる位置でも、腕を触った)
  const a = arm as { score: number; side: 'left' | 'right'; part: 'arm' | 'hand' } | null
  if (a && a.score < 0) return { part: a.part, side: a.side }
  if (trunk) return trunk
  // 体の外でも、腕・手の近く(身体の高さの10%以内)なら、腕・手とする(袖の先・髪の近く)
  if (a && a.score < 0.1 * height) return { part: a.part, side: a.side }
  return null
}

/** Mod が宣言した部位の判定。骨の近く(bone)を先に、次に帯(band。狭いほうが先)。どれにも当たらなければ null */
function classifyCustom(
  point: Point2,
  bones: BonePoints,
  box: { top: number; bottom: number; centerX: number },
  height: number,
  custom: readonly CustomTouchPart[]
): TouchResult | null {
  let best: { part: string; side: TouchSide; score: number } | null = null
  for (const p of custom) {
    const r = p.region
    if (r.kind === 'bone') {
      const names = p.sides ? [['left', 'left' + capitalize(r.bone)] as const, ['right', 'right' + capitalize(r.bone)] as const] : ([['center', r.bone]] as const)
      for (const [side, name] of names) {
        const b = bones[name]
        if (!b) continue
        const score = Math.hypot(point.x - b.x, point.y - b.y) / height - r.radius // 負なら範囲の中
        if (score < 0 && (!best || score < best.score)) best = { part: p.id, side, score }
      }
    }
  }
  if (best) return { part: best.part, side: best.side }
  let narrow: { part: string; side: TouchSide; width: number } | null = null
  for (const p of custom) {
    const r = p.region
    if (r.kind !== 'band') continue
    const t = (point.y - box.top) / height
    const dx = Math.abs(point.x - box.centerX)
    if (t < r.from || t > r.to || dx > (r.halfWidth ?? BODY_HALF_WIDTH) * height) continue
    const width = r.to - r.from
    // 左右のある帯は、体の中心より画面の右がキャラの左(脚の骨が無いときと同じ)
    const side: TouchSide = p.sides ? (point.x > box.centerX ? 'left' : 'right') : 'center'
    if (!narrow || width < narrow.width) narrow = { part: p.id, side, width }
  }
  return narrow ? { part: narrow.part, side: narrow.side } : null
}
