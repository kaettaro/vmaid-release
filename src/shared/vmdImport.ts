// 機能 Mod「VMD インポーター」の設定。VMD(MMD のモーション)を、VRM のモデルで再生できるように、VRMA へ変換する。
import { z } from 'zod'

/** VMD の変換は、機能 Mod「MMD 対応」の一部(2026-10-17 に、VMD インポーターを統合) */
export const VMD_IMPORT_ID = 'mmd'

/** 腕の基準の角度(MMD のモデルの A ポーズで、腕が水平から下がっている角度。度)の範囲 */
export const ARM_ANGLE_RANGE = { min: 0, max: 75 } as const

export const VmdImportSchema = z.object({
  /**
   * 腕の基準の角度(度)。null なら、標準の MMD モデルの実測値(約 45°)を使う。
   * モーションを作ったモデルの A ポーズが違うと、腕の高さがずれるので、そのときに合わせる(例: 35°)
   */
  armAngleDeg: z
    .number()
    .nullable()
    .catch(null)
    .transform((n) => (n === null || !Number.isFinite(n) ? null : Math.min(ARM_ANGLE_RANGE.max, Math.max(ARM_ANGLE_RANGE.min, n))))
})

export type VmdImportSettings = z.infer<typeof VmdImportSchema>
export const VmdImportPatchSchema = VmdImportSchema.partial()
export type VmdImportPatch = z.infer<typeof VmdImportPatchSchema>

export interface VmdImportView extends VmdImportSettings {
  /** Mod が ON か */
  enabled: boolean
}
