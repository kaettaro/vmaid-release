import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { deselectVisible, pruneSelection, selectAllVisible, selectRange, toggleOne, visibleSelectionState, windowRange } from '@shared/motionListView'
import { parseTagInput } from '@shared/motionMeta'
import { Toggle } from '../Toggle'
import { useModsRegistry } from '../../useModsRegistry'
import { addRuleTags, deleteRules, filterRules, NO_RULE_FILTER, removeRuleTags, ruleTagCounts, setEnabledMany, toggleRule, type RuleFilter } from '@shared/rules/edit'
import type { RuleSet } from '@shared/rules/types'

/** 一覧の1行の高さ(px)。仮想化の計算に使うので、CSS の .rrow の高さと同じにする */
const ROW_H = 58
/** タグの絞り込みに、最初に出すタグの数(多い順) */
const TAG_CHIPS_FIRST = 16

interface Props {
  ruleSet: RuleSet
  /** いま、右側で編集しているルールのid */
  current: string | null
  /** 検証でエラーのあるルールのid */
  badIds: ReadonlySet<string>
  onSelect: (id: string) => void
  onEdit: (next: RuleSet) => void
  /** Mod のルール(id → 所属 Mod の名前)。無いものは、マイルール */
  owners?: ReadonlyMap<string, string>
}

/** ルールの一覧: 検索・タグ絞り込み・複数選択・一括操作(有効/無効・タグ・削除)。数百〜数千件でも、見える行だけを描く */
export function RuleList({ ruleSet, current, badIds, onSelect, onEdit, owners }: Props): React.JSX.Element {
  // ルールのタグ(整理用)の絞り込み・一括付与は、公式の機能 Mod「モーションのタグ」(motion-tags)が ON のときだけ
  const tagsOn = useModsRegistry().modEnabled('motion-tags')
  const [filter, setFilter] = useState<RuleFilter>(NO_RULE_FILTER)
  const [checkedRaw, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [bulkTag, setBulkTag] = useState('')
  const [removeTagChoice, setRemoveTagChoice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAllTags, setShowAllTags] = useState(false)

  const boxRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(420)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = (): void => setHeight(el.clientHeight)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const tags = useMemo(() => ruleTagCounts(ruleSet), [ruleSet])
  const rows = useMemo(() => filterRules(ruleSet.rules, filter), [ruleSet.rules, filter])
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows])
  // 一覧から無くなったルール(削除・id の変更)は、選択に含めない(状態は書き換えず、見るときに外す)
  const checked = useMemo(() => pruneSelection(checkedRaw, new Set(ruleSet.rules.map((r) => r.id))), [checkedRaw, ruleSet.rules])
  const state = visibleSelectionState(checked, rowIds)
  const removableTags = useMemo(() => [...new Set(ruleSet.rules.filter((r) => checked.has(r.id)).flatMap((r) => r.tags ?? []))], [ruleSet.rules, checked])

  // 絞り込みで件数が減ったとき、スクロール位置が範囲外にならないようにする
  useEffect(() => {
    const el = boxRef.current
    if (el && el.scrollTop > Math.max(0, rows.length * ROW_H - el.clientHeight)) el.scrollTop = 0
  }, [rows.length])

  const toggleFilterTag = (tag: string): void => setFilter((f) => ({ ...f, tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag] }))
  const click = (id: string, shift: boolean): void => {
    setChecked((s) => (shift && anchor !== null ? selectRange(s, rowIds, anchor, id) : toggleOne(s, id)))
    setAnchor(id)
    setConfirmDelete(false)
  }
  const apply = (next: RuleSet): void => {
    if (next !== ruleSet) onEdit(next)
  }
  const w = windowRange(scrollTop, height, ROW_H, rows.length)
  const filtering = filter.query !== '' || filter.tags.length > 0 || filter.enabled !== 'all'
  const chipTags = showAllTags ? tags : tags.slice(0, TAG_CHIPS_FIRST)

  return (
    <div className="rule-pane">
      <div className="rule-tools">
        <input type="search" value={filter.query} placeholder="id・説明・タグ・動作で検索" onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))} />
        <select value={filter.enabled} onChange={(e) => setFilter((f) => ({ ...f, enabled: e.target.value as RuleFilter['enabled'] }))} aria-label="有効・無効で絞り込み">
          <option value="all">すべて</option>
          <option value="on">有効のみ</option>
          <option value="off">無効のみ</option>
        </select>
        {filtering && <button onClick={() => setFilter(NO_RULE_FILTER)}>解除</button>}
      </div>
      {tagsOn && tags.length > 0 && (
        <div className="tagchips rule-chips" aria-label="タグで絞り込み">
          {chipTags.map((t) => (
            <button key={t.tag} className={`chip${filter.tags.includes(t.tag) ? ' on' : ''}`} onClick={() => toggleFilterTag(t.tag)}>
              {t.tag} ({t.count})
            </button>
          ))}
          {tags.length > TAG_CHIPS_FIRST && (
            <button className="chip more" onClick={() => setShowAllTags((v) => !v)}>
              {showAllTags ? '少なく表示' : `ほか ${tags.length - TAG_CHIPS_FIRST} 個`}
            </button>
          )}
        </div>
      )}
      <div className="mhead">
        <label className="radio-line">
          <input
            type="checkbox"
            checked={state === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = state === 'some'
            }}
            onChange={() => setChecked((s) => (state === 'all' ? deselectVisible(s, rowIds) : selectAllVisible(s, rowIds)))}
          />
          表示中の{rows.length}件を選択
        </label>
        <span className="muted small">
          {rows.length === ruleSet.rules.length ? `全${rows.length}件` : `${ruleSet.rules.length}件中 ${rows.length}件`}
          {checked.size > 0 && ` / ${checked.size}件を選択中`}
        </span>
      </div>

      {checked.size > 0 && (
        <div className="bulkbar">
          <div className="row">
            <button onClick={() => apply(setEnabledMany(ruleSet, checked, true))}>有効にする</button>
            <button onClick={() => apply(setEnabledMany(ruleSet, checked, false))}>無効にする</button>
            <button onClick={() => setChecked(new Set())}>選択を解除</button>
          </div>
          {tagsOn && (
          <div className="row">
            <input
              type="text"
              value={bulkTag}
              placeholder="付けるタグ(カンマ区切り)"
              onChange={(e) => setBulkTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && parseTagInput(bulkTag).length > 0) {
                  apply(addRuleTags(ruleSet, checked, parseTagInput(bulkTag)))
                  setBulkTag('')
                }
              }}
            />
            <button
              disabled={parseTagInput(bulkTag).length === 0}
              onClick={() => {
                apply(addRuleTags(ruleSet, checked, parseTagInput(bulkTag)))
                setBulkTag('')
              }}
            >
              タグを付ける
            </button>
            <select value={removeTagChoice} onChange={(e) => setRemoveTagChoice(e.target.value)} disabled={removableTags.length === 0}>
              <option value="">外すタグを選ぶ…</option>
              {removableTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              disabled={!removeTagChoice}
              onClick={() => {
                apply(removeRuleTags(ruleSet, checked, [removeTagChoice]))
                setRemoveTagChoice('')
              }}
            >
              外す
            </button>
          </div>
          )}
          <div className="row">
            {!confirmDelete ? (
              <button className="danger" onClick={() => setConfirmDelete(true)}>
                選択したルールを削除({checked.size}件)
              </button>
            ) : (
              <>
                <strong>{checked.size}件のルールを削除します。よろしいですか?</strong>
                <button
                  className="danger"
                  onClick={() => {
                    apply(deleteRules(ruleSet, checked))
                    setChecked(new Set())
                    setConfirmDelete(false)
                  }}
                >
                  削除する
                </button>
                <button onClick={() => setConfirmDelete(false)}>やめる</button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="rlist" ref={boxRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: w.padTop }} />
        {rows.slice(w.start, w.end).map((r) => (
          <div key={r.id} className={`rrow${r.id === current ? ' selected' : ''}${checked.has(r.id) ? ' sel' : ''}`}>
            <input type="checkbox" checked={checked.has(r.id)} onChange={() => undefined} onClick={(e) => click(r.id, e.shiftKey)} aria-label={`${r.id}を選択`} />
            <Toggle checked={r.enabled} label={`${r.id} を有効にする`} title={r.enabled ? '有効(クリックで無効)' : '無効(クリックで有効)'} onChange={(on) => apply(toggleRule(ruleSet, r.id, on))} />
            <button className="rule-name" onClick={() => onSelect(r.id)}>
              <span className={r.enabled ? 'rule-id' : 'rule-id off'}>
                {r.id}
                {badIds.has(r.id) && <span className="ng small"> ⚠ 要修正</span>}
                {owners?.has(r.id) && <span className="badge">{owners.get(r.id)}</span>}
              </span>
              {r.description && <span className="muted small rule-desc1">{r.description}</span>}
              {tagsOn && r.tags && r.tags.length > 0 && <span className="rtags">{r.tags.map((t) => `#${t}`).join(' ')}</span>}
            </button>
          </div>
        ))}
        <div style={{ height: w.padBottom }} />
      </div>
      {ruleSet.rules.length === 0 && <p className="muted small">ルールはまだありません。</p>}
      {ruleSet.rules.length > 0 && rows.length === 0 && <p className="muted small">条件に合うルールがありません。</p>}
    </div>
  )
}
