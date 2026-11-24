// クォータニオン(x, y, z, w)と3次元ベクトルの小さな計算。Three.js に依存しない(shared から使う)

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

export const Q_IDENTITY: Quat = [0, 0, 0, 1]

export const qAxisAngle = (axis: 'x' | 'y' | 'z', rad: number): Quat => {
  const s = Math.sin(rad / 2)
  return [axis === 'x' ? s : 0, axis === 'y' ? s : 0, axis === 'z' ? s : 0, Math.cos(rad / 2)]
}

/** a · b(b を先に適用し、そのあとで a。回転行列の積 R(a)·R(b) と同じ順序) */
export const qMul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
]

/** 逆回転(単位クォータニオン前提の共役) */
export const qInv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]

export const qNormalize = (q: Quat): Quat => {
  const n = Math.hypot(q[0], q[1], q[2], q[3])
  return n < 1e-12 ? [0, 0, 0, 1] : [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

export const qDot = (a: Quat, b: Quat): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]

/** ベクトル v を q で回す */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(u×v) + 2u×(u×v)、u = (x,y,z)
  const [x, y, z, w] = q
  const cx = y * v[2] - z * v[1]
  const cy = z * v[0] - x * v[2]
  const cz = x * v[1] - y * v[0]
  return [
    v[0] + 2 * (w * cx + y * cz - z * cy),
    v[1] + 2 * (w * cy + z * cx - x * cz),
    v[2] + 2 * (w * cz + x * cy - y * cx)
  ]
}

export const vLen = (v: Vec3): number => Math.hypot(v[0], v[1], v[2])
export const vSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const vAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const vScale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k]
export const vNormalize = (v: Vec3): Vec3 => {
  const n = vLen(v)
  return n < 1e-12 ? [0, 0, 0] : [v[0] / n, v[1] / n, v[2] / n]
}
export const vDot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const vCross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** 単位ベクトル a を b に重ねる最小の回転(ひねりなし) */
export function qFromTo(a: Vec3, b: Vec3): Quat {
  const d = vDot(a, b)
  if (d > 1 - 1e-9) return [0, 0, 0, 1]
  if (d < -1 + 1e-9) {
    // 真逆: a に直交する任意の軸で 180°
    const ortho: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const axis = vNormalize(vCross(a, ortho))
    return [axis[0], axis[1], axis[2], 0]
  }
  const c = vCross(a, b)
  return qNormalize([c[0], c[1], c[2], 1 + d])
}
