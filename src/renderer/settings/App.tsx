import { useCallback, useEffect, useState } from 'react'
import type { SettingsPatch, SettingsView } from '@shared/settingsApi'
import { CharacterTab } from './CharacterTab'
import { HistoryTab } from './HistoryTab'
import { LlmTab } from './LlmTab'
import { MotionsTab } from './MotionsTab'
import { RulesTab } from './rules/RulesTab'
import { ModsTab } from './ModsTab'
import { BasicTab } from './BasicTab'

type TabId = 'motion' | 'mods' | 'llm' | 'character' | 'rules' | 'history' | 'display'

interface TabDef {
  id: TabId
  label: string
  /** 未実装のタブに出す案内 */
  placeholder?: string
}

const TABS: TabDef[] = [
  { id: 'character', label: 'キャラクター' },
  { id: 'motion', label: 'モーション' },
  { id: 'mods', label: 'Mod' },
  { id: 'llm', label: 'LLM' },
  { id: 'rules', label: 'ルール' },
  { id: 'history', label: '履歴' },
  { id: 'display', label: '基本設定' }
]

export function App(): React.JSX.Element {
  const [chosenTab, setTab] = useState<TabId>('character')
  const [view, setView] = useState<SettingsView | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    void window.vmaid.getSettings().then(setView)
    // メニューからキャラを切り替えたときなど、他の場所での変更を反映する
    return window.vmaid.onCharacterChanged(() => void window.vmaid.getSettings().then(setView))
  }, [])

  /** 変更を main へ送り、検証済みの結果で画面を更新する(不正な項目はエラーとして返る) */
  const update = useCallback(async (patch: SettingsPatch) => {
    const result = await window.vmaid.updateSettings(patch)
    setView(result.view)
    setErrors(result.errors)
  }, [])

  const tab: TabId = chosenTab
  const current = TABS.find((t) => t.id === tab)!

  return (
    <div className="settings">
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {errors.length > 0 && (
          <div className="notice error" role="alert">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
        {tab === 'rules' ? (
          <RulesTab />
        ) : tab === 'motion' ? (
          <MotionsTab />
        ) : tab === 'mods' ? (
          <ModsTab />
        ) : tab === 'display' ? (
          <BasicTab />
        ) : !view ? (
          <p className="muted">読み込み中…</p>
        ) : tab === 'llm' ? (
          <LlmTab view={view} update={update} />
        ) : tab === 'character' ? (
          <CharacterTab view={view} onResult={(r) => setView(r.view)} />
        ) : tab === 'history' ? (
          <HistoryTab view={view} update={update} />
        ) : (
          <section>
            <h1>{current.label}</h1>
            <p className="muted">{current.placeholder}</p>
          </section>
        )}
      </main>
    </div>
  )
}
