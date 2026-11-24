import { useEffect, useState } from 'react'
import type { ModListState } from '@shared/modListApi'

/**
 * Mod の一覧窓(host.ui.list)。Mod が渡した見出し・アイコン・リンクを、テキストとして並べるだけ(HTML は解釈しない)。
 * 見出しを押すと、Mod に「選んだ」と伝わる(ニュース Mod なら、その話題を、キャラが取り上げる)。↗ は、記事をブラウザで開く(Mod に権限があるときだけ)。
 */
export function App(): React.JSX.Element {
  const [state, setState] = useState<ModListState | null>(null)
  /** 押した項目(押したことが分かるように、少しのあいだ印をつける) */
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    void window.vmaid.getModList().then(setState)
    return window.vmaid.onModListChanged(setState)
  }, [])

  if (!state) return <div className="list" />
  const unread = state.items.filter((i) => i.unread).length

  const pick = (id: string): void => {
    setPicked(id)
    window.vmaid.selectModListItem(id)
    setTimeout(() => setPicked((p) => (p === id ? null : p)), 2500)
  }

  return (
    <div className="list">
      <header>
        <strong>{state.title || state.modName}</strong>
        {unread > 0 && <span className="badge">新着 {unread}</span>}
        <span className="grow" />
        <label className="follow" title="オンにすると、キャラの隣に付いてきます">
          <input type="checkbox" checked={state.follow} onChange={(e) => window.vmaid.setModListFollow(e.target.checked)} />
          キャラに追従
        </label>
        <button className="close" onClick={() => window.vmaid.closeModList()} title="この窓を閉じる(Mod タブ・トレイから、また出せます)">
          ✕
        </button>
      </header>
      {state.items.length === 0 ? (
        <div className="empty">{state.empty || 'まだ何もありません'}</div>
      ) : (
        <ul>
          {state.items.map((it) => {
            const icon = it.icon ? state.icons[it.icon] : undefined
            const source = it.subtitle.split(/[・·]/)[0]?.trim() || it.title
            return (
              <li key={it.id} className={`${it.unread ? 'unread' : ''} ${picked === it.id ? 'picked' : ''}`}>
                <button className="row" onClick={() => pick(it.id)} title="このニュースを話題にする">
                  {icon ? <img className="icon" src={icon} alt="" draggable={false} /> : <span className="icon letter">{[...source][0] ?? '?'}</span>}
                  <span className="body">
                    <span className="title">{it.title}</span>
                    {it.subtitle && <span className="sub">{it.subtitle}</span>}
                  </span>
                  {it.unread && <span className="dot" />}
                </button>
                {state.canOpen && it.link && (
                  <button className="open" onClick={() => window.vmaid.openModListItem(it.id)} title="記事を、ふだんのブラウザで開く">
                    ↗
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <footer className="muted">{picked ? '話題にしました。キャラが話します(会話中は話せないことがあります)' : '見出しを押すと、キャラがその話題を取り上げます'}</footer>
    </div>
  )
}
