import { useEffect, useState } from 'react'
import { createRegistry, registryFromView, type RuleRegistry } from '@shared/rules/registry'

/**
 * 機能 Mod の ON/OFF から作った、ルールの「使える定義」。変更は全ウィンドウに届く。
 * 読み込み前は、すべて OFF として扱う(まだ分からない間に、Mod の機能を使うルールが動かないように)
 */
export function useModsRegistry(): RuleRegistry {
  const [registry, setRegistry] = useState<RuleRegistry>(() => createRegistry([]))
  useEffect(() => {
    let alive = true
    void window.vmaid.getMods().then((v) => alive && setRegistry(registryFromView(v)))
    const off = window.vmaid.onModsChanged((v) => setRegistry(registryFromView(v)))
    return () => {
      alive = false
      off()
    }
  }, [])
  return registry
}
