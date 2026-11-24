import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deleteRule, duplicateRule, moveRule, newRule, replaceRule, uniqueId } from '@shared/rules/edit'
import { tagCounts } from '@shared/motionMeta'
import { lintRuleSet } from '@shared/rules/lint'
import { parseRuleSet } from '@shared/rules/schema'
import type { Rule, RuleIssue, RuleSet } from '@shared/rules/types'
import { formatIssue, parseRuleSetYaml, stringifyRuleSet } from '@shared/rules/yaml'
import { useModsRegistry } from '../../useModsRegistry'
import type { FormContext } from './ParamField'
import { nodeCtxOf } from './NodeEditor'
import { RuleEditor } from './RuleEditor'
import { RuleList } from './RuleList'

/** モデルを読み込んでいないときに候補に出す、標準の表情名 */
const STANDARD_EXPRESSIONS = ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink']

const SAVE_DELAY_MS = 400

/** ルールタブ: 一覧(ON/OFF・並べ替え・複製・削除)、定義駆動の編集フォーム、グループ編集、テスト発火、YAML表示(双方向同期)、書き出し・取り込み */
export function RulesTab(): React.JSX.Element {
  const [ruleSet, setRuleSet] = useState<RuleSet | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'gui' | 'yaml'>('gui')
  const [yamlText, setYamlText] = useState('')
  const [yamlErrors, setYamlErrors] = useState<string[]>([])
  const [filePath, setFilePath] = useState('')
  const [message, setMessage] = useState('')
  /** Mod のルール(ON の Mod の分すべて)と、所属 Mod の名前。マイルールと並べて、1 つの一覧に出す */
  const [modRules, setModRules] = useState<Rule[]>([])
  const [modNames, setModNames] = useState<ReadonlyMap<string, string>>(new Map())
  const registry = useModsRegistry()
  const [baseCtx, setCtx] = useState<Omit<FormContext, 'registry'>>({ motions: [], tags: [], expressions: STANDARD_EXPRESSIONS, presets: [], overlayEffects: [], characters: [], touchParts: [], previewInWindow: false })
  const ctx = useMemo<FormContext>(() => ({ ...baseCtx, registry }), [baseCtx, registry])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 最後に保存(または読み込み)したYAML。自分の保存が戻ってきたときに、編集中の画面を上書きしないための目印 */
  const lastSaved = useRef('')

  // --- 読み込みと、他の場所での変更の反映 ---
  const applyText = useCallback((text: string, path: string) => {
    lastSaved.current = text
    setFilePath(path)
    const r = parseRuleSetYaml(text)
    setYamlText(text)
    setYamlErrors(r.issues.map(formatIssue))
    if (r.ruleSet) {
      setRuleSet(r.ruleSet)
      setSelected((cur) => (cur && r.ruleSet!.rules.some((x) => x.id === cur) ? cur : (r.ruleSet!.rules[0]?.id ?? null)))
    }
  }, [])

  useEffect(() => {
    let alive = true
    void window.vmaid.getRules().then((f) => alive && applyText(f.text, f.path))
    void window.vmaid.getMotions().then((s) => alive && setCtx((c) => ({ ...c, motions: s.names, tags: tagCounts(s.tags, s.names) })))
    void window.vmaid.getAdjust().then((snap) => {
      const names = snap?.items.filter((i) => i.group === 'expression').map((i) => i.key.replace(/^expr:/, ''))
      if (alive && names && names.length > 0) setCtx((c) => ({ ...c, expressions: names }))
      if (alive && snap) setCtx((c) => ({ ...c, presets: snap.presets }))
    })
    void window.vmaid.getOverlayEffects().then((list) => alive && setCtx((x) => ({ ...x, overlayEffects: list.filter((e) => !e.error).map((e) => ({ name: e.name, label: e.label })) })))
    void window.vmaid.getCharacterChange().then((c) => alive && setCtx((x) => ({ ...x, characters: c.characters })))
    const offCharacter = window.vmaid.onCharacterChanged((c) => setCtx((x) => ({ ...x, characters: c.characters })))
    // Mod が宣言した触れ合いの部位(ルールの「触った部位」の選択肢)。Mod・パックが変わったら取り直す
    const loadTouchParts = (): void => void window.vmaid.getTouchParts().then((parts) => alive && setCtx((x) => ({ ...x, touchParts: parts.map((p) => ({ id: p.id, label: p.label })) })))
    loadTouchParts()
    const loadModRules = (): void => {
      void window.vmaid.getPackRuleSetAll().then((rs) => alive && setModRules(rs.rules))
      void window.vmaid.getPacks().then((v) => alive && setModNames(new Map(v.packs.map((p) => [p.id, p.name]))))
    }
    loadModRules()
    const offPacks = window.vmaid.onPacksChanged(() => {
      loadTouchParts()
      loadModRules()
    })
    // 基本設定「再生ウィンドウの中にもキャラを出す」(設定を変えて戻ってきたときにも読み直す)
    const loadBasic = (): void => void window.vmaid.getBasic().then((b) => alive && setCtx((x) => ({ ...x, previewInWindow: b.previewInWindow })))
    loadBasic()
    window.addEventListener('focus', loadBasic)
    const offMods = window.vmaid.onModsChanged(loadTouchParts)
    const off = window.vmaid.onRulesChanged((f) => {
      if (f.text !== lastSaved.current) applyText(f.text, f.path) // 自分が保存した内容なら、何もしない
    })
    return () => {
      alive = false
      off()
      offCharacter()
      offPacks()
      window.removeEventListener('focus', loadBasic)
      offMods()
    }
  }, [applyText])

  // --- 検証(エラー・警告) ---
  const issues = useMemo<RuleIssue[]>(() => (ruleSet ? parseRuleSet(JSON.parse(JSON.stringify(ruleSet))).issues : []), [ruleSet])
  const warnings = useMemo<RuleIssue[]>(() => (ruleSet && issues.length === 0 ? lintRuleSet(ruleSet, { motions: ctx.motions, tagCounts: ctx.tags, characterIds: ctx.characters.map((c) => c.id), registry }) : []), [ruleSet, issues, ctx.motions, ctx.tags, ctx.characters, registry])
  /** エラー(検証に通らない)のあるルールのid。一覧の「要修正」の表示用(ルールごとに全件を調べ直さない) */
  const badIds = useMemo(() => {
    const set = new Set<string>()
    if (!ruleSet) return set
    for (const i of issues) {
      const m = /^rules\[(\d+)\]/.exec(i.path)
      const r = m ? ruleSet.rules[Number(m[1])] : undefined
      if (r) set.add(r.id)
    }
    return set
  }, [issues, ruleSet])
  const ruleIndex = (id: string): number => ruleSet?.rules.findIndex((r) => r.id === id) ?? -1
  const issuesFor = (list: RuleIssue[], id: string): RuleIssue[] => {
    const i = ruleIndex(id)
    return list.filter((x) => x.path.startsWith(`rules[${i}]`) || x.message.includes(`「${id}」`))
  }

  // --- 保存(正しいときだけ。少し待ってからまとめて) ---
  const scheduleSave = useCallback((next: RuleSet) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (parseRuleSet(JSON.parse(JSON.stringify(next))).issues.length > 0) return // 直るまで保存しない
      const text = stringifyRuleSet(next)
      lastSaved.current = text
      void window.vmaid.saveRules(text).then((r) => {
        if (r.ok) setYamlText(text)
        else setMessage(r.errors.join(' / '))
      })
    }, SAVE_DELAY_MS)
  }, [])

  const edit = useCallback(
    (next: RuleSet) => {
      setRuleSet(next)
      scheduleSave(next)
    },
    [scheduleSave]
  )

  // --- 操作 ---
  if (!ruleSet) {
    return (
      <section>
        <h1>ルール</h1>
        {yamlErrors.length > 0 ? (
          <>
            <div className="notice error">
              <strong>ルールファイルを読み込めません。YAMLを直してください:</strong>
              {yamlErrors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
            <YamlEditor text={yamlText} onText={setYamlText} errors={yamlErrors} setErrors={setYamlErrors} onSaved={applyText} />
          </>
        ) : (
          <p className="muted">読み込み中…</p>
        )}
      </section>
    )
  }

  // Mod のルールの id は「<Mod の id>/<ルール id>」(マイルールの id には '/' が入らない)
  const isModRule = (id: string): boolean => id.includes('/')
  const owners = new Map(modRules.map((r) => [r.id, modNames.get(r.id.split('/')[0]) ?? r.id.split('/')[0]]))
  const shownSet: RuleSet = { ...ruleSet, rules: [...ruleSet.rules, ...modRules] }
  const current = shownSet.rules.find((r) => r.id === selected) ?? null
  const currentIsMod = current !== null && isModRule(current.id)
  /** Mod のルールを、マイルールへコピーする(id は重ならないように付ける)。元のルールは、OFF にする(二重に動かないように) */
  const forkModRule = (rule: Rule, disableOriginal: boolean): string => {
    const id = uniqueId(rule.id.split('/').join('-'), ruleSet.rules.map((r) => r.id))
    edit({ ...ruleSet, rules: [...ruleSet.rules, { ...structuredClone(rule), id, enabled: true }] })
    if (disableOriginal) void window.vmaid.setModRuleEnabled(rule.id, false)
    setSelected(id)
    return id
  }
  /** 一覧からの変更(有効/無効・並べ替え・タグ・削除)を、マイルールと Mod のルールに振り分ける */
  const editMerged = (next: RuleSet): void => {
    const own = next.rules.filter((r) => !isModRule(r.id))
    if (own.length !== ruleSet.rules.length || own.some((r, i) => r !== ruleSet.rules[i])) edit({ ...ruleSet, rules: own })
    for (const m of modRules) {
      const after = next.rules.find((r) => r.id === m.id)
      // Mod のルールは、削除できない(消されたときは、OFF にする)。有効/無効の切り替えは、そのまま反映する
      const enabledNow = after?.enabled ?? false
      if (enabledNow !== m.enabled) void window.vmaid.setModRuleEnabled(m.id, enabledNow)
    }
  }
  const formCtx: FormContext = ctx

  const switchMode = (to: 'gui' | 'yaml'): void => {
    if (to === 'yaml') {
      setYamlText(stringifyRuleSet(ruleSet))
      setYamlErrors([])
      setMode('yaml')
      return
    }
    // YAMLからGUIへ: 不正なYAMLのままでは戻れない(保存も適用もされない)
    const r = parseRuleSetYaml(yamlText)
    if (!r.ruleSet) {
      setYamlErrors(r.issues.map(formatIssue))
      return
    }
    setMode('gui')
  }

  return (
    <section className="rules-tab">
      <div className="rules-head">
        <h1>ルール</h1>
        <div className="seg" role="tablist" aria-label="表示の切り替え">
          <button role="tab" aria-selected={mode === 'gui'} className={mode === 'gui' ? 'on' : ''} onClick={() => switchMode('gui')}>
            フォーム
          </button>
          <button role="tab" aria-selected={mode === 'yaml'} className={mode === 'yaml' ? 'on' : ''} onClick={() => switchMode('yaml')}>
            YAML
          </button>
        </div>
      </div>
      <p className="muted small">
        「いつ → もし → する」の順に、キャラの動きを決めます。一覧には、あなたのルール(マイルール)と、ON の Mod のルールが並びます(Mod のルールには、Mod の名前が付きます)。どれも、有効/無効の切り替えと編集ができます。Mod のルールを編集すると、自動でマイルールにコピーされ、元のルールは OFF になります。変更は自動で保存され、すぐキャラに反映されます。マイルールの保存先: <code>{filePath}</code>
      </p>

      {mode === 'yaml' ? (
        <YamlEditor
          text={yamlText}
          onText={setYamlText}
          errors={yamlErrors}
          setErrors={setYamlErrors}
          onSaved={(text, path) => {
            applyText(text, path)
            setMessage('YAMLを保存しました')
          }}
        />
      ) : (
        <>
          <div className="rules-layout">
            <RuleList ruleSet={shownSet} current={selected} badIds={badIds} onSelect={setSelected} onEdit={editMerged} owners={owners} />
            <div className="rule-detail">
              <div className="row rule-add">
                <button
                  className="primary"
                  onClick={() => {
                    const r = newRule(ruleSet, nodeCtxOf(ctx))
                    r.do = [{ action: 'say', text: ['こんにちは!'] }]
                    edit({ ...ruleSet, rules: [...ruleSet.rules, r] })
                    setSelected(r.id)
                  }}
                >
                  ＋ ルールを追加
                </button>
              </div>
              {current ? (
                <>
                  {currentIsMod && (
                    <div className="notice">
                      <strong>{owners.get(current.id)}</strong> の Mod のルールです。内容を変えると、自動で「マイルール」にコピーされ、元のルールは OFF になります(Mod 自体は、そのままです)。
                    </div>
                  )}
                  <div className="row rule-actions">
                    <button className="primary" onClick={() => window.vmaid.testFireRule(current.id)} title="条件を無視して、いまこのルールを1回実行します(保存済みの内容で)">
                      テスト発火
                    </button>
                    {!currentIsMod && <button onClick={() => edit(moveRule(ruleSet, current.id, -1))}>↑ 上へ</button>}
                    {!currentIsMod && <button onClick={() => edit(moveRule(ruleSet, current.id, 1))}>↓ 下へ</button>}
                    <button
                      onClick={() => {
                        if (currentIsMod) {
                          forkModRule(current, false)
                          return
                        }
                        const r = duplicateRule(ruleSet, current.id)
                        edit(r.ruleSet)
                        if (r.newId) setSelected(r.newId)
                      }}
                    >
                      複製
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (currentIsMod) {
                          void window.vmaid.setModRuleEnabled(current.id, false) // Mod のルールは消せない。OFF にする
                          return
                        }
                        if (!window.confirm(`ルール「${current.id}」を削除しますか?`)) return
                        const next = deleteRule(ruleSet, current.id)
                        setSelected(next.rules[0]?.id ?? null)
                        edit(next)
                      }}
                    >
                      {currentIsMod ? 'OFF にする' : '削除'}
                    </button>
                  </div>
                  <RuleEditor
                    rule={current}
                    ctx={formCtx}
                    issues={currentIsMod ? [] : issuesFor(issues, current.id)}
                    warnings={currentIsMod ? [] : issuesFor(warnings, current.id)}
                    onChange={(rule: Rule) => {
                      if (currentIsMod) {
                        forkModRule(rule, true) // 編集した内容を、マイルールへ。元のルールは OFF
                        return
                      }
                      edit(replaceRule(ruleSet, current.id, rule))
                      if (rule.id !== current.id) setSelected(rule.id)
                    }}
                  />
                </>
              ) : (
                <p className="muted">左の一覧からルールを選ぶか、「ルールを追加」を押してください。</p>
              )}
            </div>
          </div>
        </>
      )}

      <h2>共有・初期化</h2>
      <div className="row">
        <button onClick={() => void window.vmaid.exportRules().then((r) => r.message && setMessage(r.message))}>書き出し…</button>
        <button
          onClick={() =>
            void window.vmaid.importRules().then((r) => {
              setMessage([r.message, ...(r.errors ?? [])].filter(Boolean).join(' / '))
            })
          }
        >
          取り込み…
        </button>
        <button
          className="danger"
          onClick={() => {
            if (window.confirm('マイルールをすべて消して、空にします。いまのルールは rules.yaml.bak に残ります。よろしいですか?')) void window.vmaid.resetRules().then((f) => applyText(f.text, f.path))
          }}
        >
          マイルールを空にする
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
    </section>
  )
}

/** YAMLを直接編集する。入力のたびに検証して、エラーを行番号つきで出す。正しいときだけ保存できる */
function YamlEditor({
  text,
  onText,
  errors,
  setErrors,
  onSaved
}: {
  text: string
  onText: (t: string) => void
  errors: string[]
  setErrors: (e: string[]) => void
  onSaved: (text: string, path: string) => void
}): React.JSX.Element {
  return (
    <div className="yaml">
      <textarea
        className="yaml-text"
        spellCheck={false}
        value={text}
        rows={22}
        onChange={(e) => {
          onText(e.target.value)
          setErrors(parseRuleSetYaml(e.target.value).issues.map(formatIssue))
        }}
      />
      {errors.length > 0 ? (
        <div className="notice error" role="alert">
          <strong>このままでは保存できません(いまのルールで動き続けます):</strong>
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      ) : (
        <p className="ok small">書き方は正しいです。</p>
      )}
      <div className="row">
        <button
          className="primary"
          disabled={errors.length > 0}
          onClick={() =>
            void window.vmaid.saveRules(text).then((r) => {
              if (r.ok) onSaved(r.file.text, r.file.path)
              else setErrors(r.errors)
            })
          }
        >
          YAMLを保存
        </button>
      </div>
    </div>
  )
}
