import { useCallback, useEffect, useRef } from 'react'
import { BgmPlayer, type Bgm } from './bgmPlayer'
import { SePlayer } from './sePlayer'
import type { CharacterStage } from './stage'

/** モーションの再生オプション(stage.playMotion と同じ) */
type PlayOpts = { durationSec?: number; queue?: boolean; interrupt?: boolean }

/**
 * 効果音(機能 Mod「効果音」)とダンスの BGM を、キャラウィンドウへつなぐ。
 * - BGM: モーションに曲が付いていれば、先に曲を読み込んでから、モーションを再生する。曲は、ステージが
 *   「モーションが実際に始まった」と知らせた瞬間に鳴らし、「終わった」で止める(モーション基準で、ズレない)。
 * - 効果音: ルールのアクションで鳴らす。設定・Mod の ON/OFF は main から受け取る。OFF なら、何もしない。
 */
export function useAudio(): {
  bgm: React.RefObject<BgmPlayer | null>
  /** 曲つきでモーションを再生する(曲が無ければ、ふつうに再生する) */
  playMotion: (stage: CharacterStage | null, name: string, opts?: PlayOpts, bgm?: Bgm) => void
  playSound: (name: string) => void
  /** BGM を止める */
  stopBgm: () => void
  /** BGM も効果音も止める(効果を今すぐ解除など) */
  stopAll: () => void
} {
  const bgmRef = useRef<BgmPlayer | null>(null)
  const seRef = useRef<SePlayer | null>(null)

  useEffect(() => {
    const bgm = new BgmPlayer()
    const se = new SePlayer()
    bgmRef.current = bgm
    seRef.current = se
    void window.vmaid.getSound().then((v) => se.setView(v))
    const off = window.vmaid.onSoundChanged((v) => se.setView(v))
    return () => {
      off()
      bgm.dispose()
      se.dispose()
      bgmRef.current = null
      seRef.current = null
    }
  }, [])

  const playMotion = useCallback((stage: CharacterStage | null, name: string, opts?: PlayOpts, bgm?: Bgm): void => {
    if (!stage) return
    const p = bgmRef.current
    if (!bgm || !p || !stage.hasMotion(name)) {
      p?.forget(name) // 曲なしの要求は、前に準備した曲を引き継がない
      stage.playMotion(name, opts)
      return
    }
    // 曲の読み込みが終わってから、モーションを始める(初回だけ少し遅れる。2回目からは、覚えているので待たない)
    void p.prepare(name, bgm).then((ok) => {
      if (!ok) p.forget(name)
      stage.playMotion(name, opts)
    })
  }, [])

  const playSound = useCallback((name: string) => void seRef.current?.play(name), [])
  const stopBgm = useCallback(() => bgmRef.current?.stop(), [])
  const stopAll = useCallback(() => {
    bgmRef.current?.stop()
    seRef.current?.stopAll()
  }, [])

  return { bgm: bgmRef, playMotion, playSound, stopBgm, stopAll }
}
