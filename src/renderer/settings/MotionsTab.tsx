import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MotionImportProgress, MotionImportResult, MotionItem, MotionsView } from '@shared/ipc'
import {
  deselectVisible,
  filterMotions,
  NO_FILTER,
  pruneSelection,
  selectAllVisible,
  selectRange,
  sortMotions,
  toggleOne,
  visibleSelectionState,
  windowRange,
  type MotionFilter,
  type OriginFilter,
  type SortKey
} from '@shared/motionListView'
import { parseTagInput, tagCounts } from '@shared/motionMeta'
import { useModsRegistry } from '../useModsRegistry'

/** 一覧の1行の高さ(px)。仮想化の計算に使うので、CSS の .mrow の高さと同じにする */
const ROW_H = 46
/** タグの絞り込みに、最初に出すタグの数(多い順)。残りは「すべて表示」で */
const TAG_CHIPS_FIRST = 24
/** 取り込み結果の、読み込めなかったファイルを、最初に出す数 */
const REJECTED_FIRST = 100

const ORIGIN_LABEL: Record<MotionItem['origin'], string> = { builtin: '内蔵', pack: 'Mod', user: '登録' }

/** モーションタブ: 一覧(検索・タグ・複数選択・一括操作)、取り込み(タグの一斉付与)、待機モーション、タグの管理 */
export function MotionsTab(): React.JSX.Element {
  // タグの機能は、公式の機能 Mod「モーションのタグ」(motion-tags)。OFF のときは、タグの欄・絞り込み・一括付与・管理を出さない(保存したタグは残る)
  const tagsOn = useModsRegistry().modEnabled('motion-tags')
  const vmdToVrm = useModsRegistry().modEnabled('mmd')
  const [view, setView] = useState<MotionsView | null>(null)
  // 基本設定「再生ウィンドウの中にもキャラを出す」が ON のときだけ、⧉(ウィンドウ内で再生)を出す。設定を変えて戻ってきたときにも読み直す
  const [previewInWindow, setPreviewInWindow] = useState(false)
  useEffect(() => {
    const load = (): void => void window.vmaid.getBasic().then((b) => setPreviewInWindow(b.previewInWindow))
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [])
  const [result, setResult] = useState<MotionImportResult | null>(null)
  const [showAllRejected, setShowAllRejected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<MotionImportProgress | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  // 取り込み時のオプション
  const [importTags, setImportTags] = useState('')
  const [tagFromFolders, setTagFromFolders] = useState(false)

  // 一覧の絞り込み・並べ替え
  const [filter, setFilter] = useState<MotionFilter>(NO_FILTER)
  const [sort, setSort] = useState<SortKey>('registered')
  const [showAllTags, setShowAllTags] = useState(false)

  // 選択と一括操作
  const [selectedRaw, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [bulkTag, setBulkTag] = useState('')
  const [removeTagChoice, setRemoveTagChoice] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const [renaming, setRenaming] = useState<{ name: string; draft: string } | null>(null)
  const [tagRename, setTagRename] = useState<{ tag: string; draft: string } | null>(null)

  useEffect(() => {
    let alive = true
    void window.vmaid.getMotionsView().then((v) => alive && setView(v))
    const off = window.vmaid.onMotionImportProgress((p) => alive && setProgress(p))
    return () => {
      alive = false
      off()
    }
  }, [])

  const items = useMemo(() => view?.items ?? [], [view])
  const filtered = useMemo(() => sortMotions(filterMotions(items, filter), sort), [items, filter, sort])
  const filteredNames = useMemo(() => filtered.map((i) => i.name), [filtered])
  const tagList = useMemo(() => {
    const byName: Record<string, readonly string[]> = {}
    for (const i of items) byName[i.name] = i.tags
    return tagCounts(byName, items.map((i) => i.name))
  }, [items])
  const untaggedCount = useMemo(() => items.filter((i) => i.tags.length === 0).length, [items])

  // 一覧から無くなった名前(削除・名前の変更)は、選択に含めない(状態は書き換えず、見るときに外す)
  const selected = useMemo(() => pruneSelection(selectedRaw, new Set(items.map((i) => i.name))), [selectedRaw, items])

  const apply = (v: MotionsView): void => setView(v)

  const runImport = async (fn: () => Promise<MotionImportResult>): Promise<void> => {
    setBusy(true)
    setProgress(null)
    setShowAllRejected(false)
    try {
      const r = await fn()
      if (r.picked) setResult(r)
      apply(r.view)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }
  const importOpts = (): { tags: string[]; tagFromFolders: boolean } => ({ tags: parseTagInput(importTags), tagFromFolders })

  if (!view) return <p className="muted">読み込み中…</p>

  const selectedItems = items.filter((i) => selected.has(i.name))
  const removableSelected = selectedItems.filter((i) => i.origin === 'user')
  const removableTags = [...new Set(selectedItems.flatMap((i) => i.tags.filter((t) => !i.lockedTags.includes(t))))]
  const selState = visibleSelectionState(selected, filteredNames)

  const clickRow = (name: string, shift: boolean): void => {
    setSelected((s) => (shift && anchor !== null ? selectRange(s, filteredNames, anchor, name) : toggleOne(s, name)))
    setAnchor(name)
    setConfirmRemove(false)
  }
  const toggleFilterTag = (tag: string): void =>
    setFilter((f) => ({ ...f, tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag], untaggedOnly: false }))

  const commitRename = async (from: string, to: string): Promise<void> => {
    const r = await window.vmaid.renameMotion(from, to)
    apply(r.view)
    setNote({ ok: r.ok, text: r.message })
    if (r.ok) setRenaming(null) // 失敗したときは、入力欄を残して直せるようにする
  }
  const editTags = async (names: string[], edit: { add?: string[]; remove?: string[] }): Promise<void> => {
    apply(await window.vmaid.editMotionTags({ names, ...edit }))
  }
  const addBulkTag = async (): Promise<void> => {
    const tags = parseTagInput(bulkTag)
    if (tags.length === 0) return
    await editTags([...selected], { add: tags })
    setBulkTag('')
    setNote({ ok: true, text: `${selected.size}件に、タグ「${tags.join('」「')}」を付けました` })
  }
  const removeBulkTag = async (): Promise<void> => {
    if (!removeTagChoice) return
    await editTags([...selected], { remove: [removeTagChoice] })
    setNote({ ok: true, text: `選択した中から、タグ「${removeTagChoice}」を外しました` })
    setRemoveTagChoice('')
  }
  const removeSelected = async (): Promise<void> => {
    const names = removableSelected.map((i) => i.name)
    apply(await window.vmaid.removeMotions(names))
    setNote({ ok: true, text: `${names.length}件の登録を外しました(ファイル自体は削除しません)` })
    setConfirmRemove(false)
  }
  const copyRejected = (): void => {
    if (!result) return
    const text = result.rejected.map((r) => `${r.path}\t${r.reason}`).join('\n')
    void navigator.clipboard?.writeText(text)
    setNote({ ok: true, text: `読み込めなかった ${result.rejected.length}件を、クリップボードにコピーしました` })
  }

  const chipTags = showAllTags ? tagList : tagList.slice(0, TAG_CHIPS_FIRST)

  return (
    <section>
      <h1>モーション</h1>
      <p className="muted">
        キャラの動き(VRMA / BVH)を登録します。BVH は取り込み時に自動で VRMA に変換します。
        {tagsOn
          ? 'モーションには、タグを付けて整理できます。ルール(「ルール」タブ)から、名前でも、タグ(その中からランダム)でも呼び出せます。'
          : 'ルール(「ルール」タブ)から、名前で呼び出せます。タグで整理したいときは、設定 →「Mod」で「モーションのタグ」を ON にしてください。'}
      </p>

      <h2>取り込み</h2>
      <div className="import-box">
        {tagsOn && (
        <>
        <label className="field-inline">
          取り込むモーションに付けるタグ
          <input
            type="text"
            value={importTags}
            placeholder="例: Spicy, 寝る(カンマ・空白で区切る。空なら付けない)"
            onChange={(e) => setImportTags(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="radio-line">
          <input type="checkbox" checked={tagFromFolders} onChange={(e) => setTagFromFolders(e.target.checked)} disabled={busy} />
          フォルダの名前もタグにする(フォルダ取り込みでは、サブフォルダ名。ファイル取り込みでは、ファイルがあるフォルダの名前)
        </label>
        </>
        )}
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => void runImport(() => window.vmaid.addMotionFiles(importOpts()))}>
            ファイルを選んで取り込む…
          </button>
          <button className="primary" disabled={busy} onClick={() => void runImport(() => window.vmaid.addMotionFolder(importOpts()))}>
            フォルダからまとめて取り込む…
          </button>
          <button onClick={() => window.vmaid.openMotionPreview()} title="モーションの一覧(タグ・割り当て済みのルールつき)から選んで、キャラで再生します">
            再生ウィンドウを開く
          </button>
          <label className="field-inline small">
            1回の上限
            <input
              type="number"
              min={0}
              step={100}
              className="num"
              defaultValue={view.maxImportFiles}
              key={view.maxImportFiles}
              onBlur={(e) => void window.vmaid.setMaxImportFiles(Number(e.target.value) || 0).then(apply)}
            />
            件(0 = 無制限)
          </label>
        </div>
        {busy && (
          <div className="progress-line">
            <progress value={progress?.done ?? 0} max={Math.max(1, progress?.total ?? 1)} />
            <span className="small muted">{progress ? `${progress.done} / ${progress.total} 件を確認中…` : 'ファイルを探しています…'}</span>
          </div>
        )}
      </div>
      <p className="muted small">
        ファイルは複数を選べます。フォルダを選ぶと、中の .vrma / .bvh を、サブフォルダも含めてすべて取り込みます。
        すでに登録済みのファイルも、付けるタグがあれば、タグだけを付けます(重複登録はしません)。名前が同じ別のファイルは、「名前-2」のように区別されます。
      </p>
      {result && (
        <div className={result.rejected.length > 0 ? 'notice warn' : 'notice ok-box'} role="status">
          <strong>{result.message}</strong>
          {result.rejected.length > 0 && (
            <details>
              <summary>読み込めなかったファイル({result.rejected.length}件)</summary>
              <p className="row">
                <button onClick={copyRejected}>一覧をコピー</button>
                {result.rejected.length > REJECTED_FIRST && !showAllRejected && (
                  <button onClick={() => setShowAllRejected(true)}>すべて表示</button>
                )}
              </p>
              <ul className="reject-list">
                {(showAllRejected ? result.rejected : result.rejected.slice(0, REJECTED_FIRST)).map((r) => (
                  <li key={r.path}>
                    <code>{r.path}</code>
                    <div className="muted small">{r.reason}</div>
                  </li>
                ))}
                {!showAllRejected && result.rejected.length > REJECTED_FIRST && <li className="muted small">…ほか {result.rejected.length - REJECTED_FIRST}件</li>}
              </ul>
            </details>
          )}
          {result.notes.length > 0 && (
            <details>
              <summary>BVH の変換についての注意({result.notes.length}件)</summary>
              <ul className="reject-list">
                {result.notes.slice(0, REJECTED_FIRST).map((n) => (
                  <li key={n} className="muted small">
                    {n}
                  </li>
                ))}
                {result.notes.length > REJECTED_FIRST && <li className="muted small">…ほか {result.notes.length - REJECTED_FIRST}件</li>}
              </ul>
            </details>
          )}
        </div>
      )}

      <h2>
        モーション一覧 <span className="muted small">(全{items.length}件)</span>
      </h2>
      <p className="muted small">ダンスで足が床を滑るときは、設定 →「Mod」の「足の接地補正」を ON にしてください(現在: {view.footLock ? 'ON' : 'OFF'})。</p>
      {note && <p className={note.ok ? 'ok small' : 'ng small'}>{note.text}</p>}

      <div className="mtoolbar">
        <input
          type="search"
          className="msearch"
          value={filter.query}
          placeholder="名前・タグで検索(空白で区切ると、すべてを含むもの)"
          onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
        />
        <select value={filter.origin} onChange={(e) => setFilter((f) => ({ ...f, origin: e.target.value as OriginFilter }))}>
          <option value="all">すべて</option>
          <option value="user">登録したもの</option>
          <option value="builtin">内蔵</option>
          <option value="pack">Mod</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="registered">登録順</option>
          <option value="name">名前順</option>
        </select>
        {(filter.query !== '' || filter.tags.length > 0 || filter.untaggedOnly || filter.origin !== 'all') && (
          <button onClick={() => setFilter(NO_FILTER)}>絞り込みを解除</button>
        )}
      </div>

      {tagsOn && (
      <div className="tagchips" aria-label="タグで絞り込み">
        <button className={`chip${filter.untaggedOnly ? ' on' : ''}`} onClick={() => setFilter((f) => ({ ...f, untaggedOnly: !f.untaggedOnly, tags: [] }))}>
          タグなし ({untaggedCount})
        </button>
        {chipTags.map((t) => (
          <button key={t.tag} className={`chip${filter.tags.includes(t.tag) ? ' on' : ''}`} onClick={() => toggleFilterTag(t.tag)}>
            {t.tag} ({t.count})
          </button>
        ))}
        {tagList.length > TAG_CHIPS_FIRST && (
          <button className="chip more" onClick={() => setShowAllTags((v) => !v)}>
            {showAllTags ? '少なく表示' : `ほか ${tagList.length - TAG_CHIPS_FIRST} 個のタグを表示`}
          </button>
        )}
      </div>
      )}

      <div className="mhead">
        <label className="radio-line">
          <input
            type="checkbox"
            checked={selState === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = selState === 'some'
            }}
            onChange={() => setSelected((s) => (selState === 'all' ? deselectVisible(s, filteredNames) : selectAllVisible(s, filteredNames)))}
          />
          表示中の{filtered.length}件をすべて選択
        </label>
        <span className="muted small">
          {filtered.length === items.length ? `${items.length}件を表示` : `${items.length}件中 ${filtered.length}件を表示`}
          {selected.size > 0 && ` / ${selected.size}件を選択中`}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="bulkbar">
          {tagsOn && (
          <div className="row">
            <input type="text" value={bulkTag} placeholder="付けるタグ(カンマ区切り)" onChange={(e) => setBulkTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void addBulkTag()} />
            <button onClick={() => void addBulkTag()} disabled={parseTagInput(bulkTag).length === 0}>
              選択にタグを付ける
            </button>
            <select value={removeTagChoice} onChange={(e) => setRemoveTagChoice(e.target.value)} disabled={removableTags.length === 0}>
              <option value="">外すタグを選ぶ…</option>
              {removableTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button onClick={() => void removeBulkTag()} disabled={!removeTagChoice}>
              外す
            </button>
          </div>
          )}
          <div className="row">
            {!confirmRemove ? (
              <button className="danger" disabled={removableSelected.length === 0} onClick={() => setConfirmRemove(true)}>
                選択した登録を外す({removableSelected.length}件)
              </button>
            ) : (
              <>
                <strong>{removableSelected.length}件の登録を外します(ファイルは削除しません)。よろしいですか?</strong>
                <button className="danger" onClick={() => void removeSelected()}>
                  外す
                </button>
                <button onClick={() => setConfirmRemove(false)}>やめる</button>
              </>
            )}
            <button onClick={() => setSelected(new Set())}>選択を解除</button>
            {selectedItems.length > removableSelected.length && <span className="muted small">内蔵・Mod のモーションは、登録を外せません(タグは付けられます)</span>}
          </div>
        </div>
      )}

      <MotionList
        previewInWindow={previewInWindow}
        rows={filtered}
        selected={selected}
        idle={view.idle}
        renaming={renaming}
        onRenaming={setRenaming}
        onClickRow={clickRow}
        onIdle={(name) => void window.vmaid.setIdleMotion(name).then(apply)}
        onRemoveOne={(name) => void window.vmaid.removeMotions([name]).then(apply)}
        onCommitRename={(from, to) => void commitRename(from, to)}
        onFilterTag={toggleFilterTag}
        onRemoveTag={(name, tag) => void editTags([name], { remove: [tag] })}
        tagsOn={tagsOn}
        vmdToVrm={vmdToVrm}
        onAddFaces={(name) => void window.vmaid.addMotionFaces(name).then((r) => (apply(r.view), r.message && setNote({ ok: r.ok, text: r.message })))}
        onClearFaces={(name) => void window.vmaid.clearMotionFaces(name).then(apply)}
        onVmdReport={(name) => void window.vmaid.getVmdReport(name).then((r) => setNote({ ok: r.ok, text: `${name}: ${r.lines.join(' / ')}` }))}
      />
      {items.length > 0 && filtered.length === 0 && <p className="muted">条件に合うモーションがありません。</p>}

      {tagsOn && (
      <details className="tagmanager">
        <summary>タグの管理({tagList.length}個)</summary>
        <p className="muted small">タグの名前を、すべてのモーションでまとめて変えたり、消したりできます。内蔵・Mod が最初から持つタグ(🔒)は、変えられません。</p>
        <ul className="tag-table">
          {tagList.map((t) => {
            const userCount = items.filter((i) => i.tags.includes(t.tag) && !i.lockedTags.includes(t.tag)).length
            return (
              <li key={t.tag}>
                {tagRename?.tag === t.tag ? (
                  <input
                    autoFocus
                    value={tagRename.draft}
                    onChange={(e) => setTagRename({ tag: t.tag, draft: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setTagRename(null)
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) void window.vmaid.renameMotionTag(t.tag, tagRename.draft).then((v) => (apply(v), setTagRename(null)))
                    }}
                  />
                ) : (
                  <span className="tagname">{t.tag}</span>
                )}
                <span className="muted small">{t.count}件</span>
                {userCount === 0 ? (
                  <span className="muted small">🔒 最初から持つタグ</span>
                ) : (
                  <>
                    <button onClick={() => setTagRename({ tag: t.tag, draft: t.tag })}>名前を変える</button>
                    <button className="danger" onClick={() => void window.vmaid.deleteMotionTag(t.tag).then(apply)}>
                      消す
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </details>
      )}
    </section>
  )
}

interface MotionListProps {
  /** 基本設定「再生ウィンドウの中にもキャラを出す」が ON か(ON のときだけ、⧉ を出す) */
  previewInWindow: boolean
  rows: MotionItem[]
  selected: ReadonlySet<string>
  idle: string | null
  renaming: { name: string; draft: string } | null
  onRenaming: (r: { name: string; draft: string } | null) => void
  onClickRow: (name: string, shift: boolean) => void
  onIdle: (name: string | null) => void
  onRemoveOne: (name: string) => void
  onCommitRename: (from: string, to: string) => void
  onFilterTag: (tag: string) => void
  onRemoveTag: (name: string, tag: string) => void
  /** タグの表示(Mod「モーションのタグ」が ON か) */
  tagsOn: boolean
  /** MMD 対応が ON か(ON のとき、VMD の行に、表情 VMD の操作を出す) */
  vmdToVrm: boolean
  onAddFaces: (name: string) => void
  onClearFaces: (name: string) => void
  onVmdReport: (name: string) => void
}

/** 仮想化した一覧: 見えている行だけを描く(数千件でも軽い) */
function MotionList(p: MotionListProps): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(480)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = (): void => setHeight(el.clientHeight)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // 絞り込みで件数が減ったとき、スクロール位置が範囲外にならないようにする
  useEffect(() => {
    const el = boxRef.current
    if (el && el.scrollTop > Math.max(0, p.rows.length * ROW_H - el.clientHeight)) el.scrollTop = 0
  }, [p.rows.length])

  const w = windowRange(scrollTop, height, ROW_H, p.rows.length)
  return (
    <div className="mlist" ref={boxRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: w.padTop }} />
      {p.rows.slice(w.start, w.end).map((m) => {
        const isSel = p.selected.has(m.name)
        const isRenaming = p.renaming?.name === m.name
        return (
          <div key={m.name} className={`mrow${isSel ? ' sel' : ''}`}>
            <input type="checkbox" checked={isSel} onChange={() => undefined} onClick={(e) => p.onClickRow(m.name, e.shiftKey)} aria-label={`${m.name}を選択`} />
            <div className="mmain">
              {isRenaming && p.renaming ? (
                <input
                  autoFocus
                  className="rename"
                  maxLength={40}
                  value={p.renaming.draft}
                  onChange={(e) => p.onRenaming({ name: m.name, draft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') p.onRenaming(null)
                    // 日本語入力の変換確定の Enter では、確定しない
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && p.renaming) p.onCommitRename(m.name, p.renaming.draft)
                  }}
                />
              ) : (
                <span className="mname" title={m.path ?? m.name}>
                  {m.name}
                  {m.origin !== 'user' && <span className="badge origin">{ORIGIN_LABEL[m.origin]}</span>}
                </span>
              )}
              {p.tagsOn && (
              <span className="mtags">
                {m.tags.map((t) => {
                  const locked = m.lockedTags.includes(t)
                  return (
                    <span key={t} className={`tag${locked ? ' locked' : ''}`}>
                      <button className="tagbtn" title="このタグで絞り込む" onClick={() => p.onFilterTag(t)}>
                        {locked ? '🔒' : ''}
                        {t}
                      </button>
                      {!locked && (
                        <button className="tagx" title="このタグを外す" onClick={() => p.onRemoveTag(m.name, t)}>
                          ×
                        </button>
                      )}
                    </span>
                  )
                })}
              </span>
              )}
            </div>
            <button className="icon" title="キャラで再生して試す" aria-label={`${m.name} を再生`} onClick={() => window.vmaid.previewMotion(m.name)}>
              ▶
            </button>
            {p.previewInWindow && (
              <button className="icon" title="再生ウィンドウの中のキャラで再生して試す(画面のキャラは動きません)" aria-label={`${m.name} をウィンドウ内で再生`} onClick={() => window.vmaid.openMotionPreview(m.name)}>
                ⧉
              </button>
            )}
            <label className="radio-line idle-radio" title="ふだんループして再生する待機モーションにする">
              <input type="radio" name="idle" checked={p.idle === m.name} onChange={() => p.onIdle(m.name)} />
              待機
            </label>
            {p.vmdToVrm && m.origin === 'user' && m.path && /\.vmd$/i.test(m.path) && (
              <>
                <button className="icon" title="体の VMD に、表情の VMD を足す(VRM のモデルで使うとき、1 つにまとめて変換します)" onClick={() => p.onAddFaces(m.name)}>
                  表情 VMD{m.faces && m.faces.length > 0 ? `(${m.faces.length})` : ''}
                </button>
                {m.faces && m.faces.length > 0 && (
                  <button className="icon" title="足した表情の VMD を、すべて外す" onClick={() => p.onClearFaces(m.name)}>
                    表情を外す
                  </button>
                )}
                <button className="icon" title="VRM のモデル用に変換した結果(使った表情・警告)を見る" onClick={() => p.onVmdReport(m.name)}>
                  変換結果
                </button>
              </>
            )}
            {m.origin === 'user' && (
              <>
                <button className="icon" onClick={() => p.onRenaming({ name: m.name, draft: m.name })}>
                  名前
                </button>
                <button className="icon danger" onClick={() => p.onRemoveOne(m.name)}>
                  外す
                </button>
              </>
            )}
          </div>
        )
      })}
      <div style={{ height: w.padBottom }} />
    </div>
  )
}
