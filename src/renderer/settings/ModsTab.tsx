import { useEffect, useState } from 'react'
import type { ModsView } from '@shared/modsApi'
import type { ModCategory } from '@shared/packs/manifest'
import type { PackInfo, PacksView } from '@shared/packsApi'
import type { SettingsPatch, SettingsView } from '@shared/settingsApi'
import { BeautifyTab } from './BeautifyTab'
import { BubbleTab } from './BubbleTab'
import { ChaseTab } from './ChaseTab'
import { GameSettings } from './GameSettings'
import { ModExportSection } from './ModExportSection'
import { MoveTab } from './MoveTab'
import { TalkTab } from './TalkTab'
import { OverlayEffectsEditor } from './OverlayEffectsEditor'
import { SlotEditor } from './SlotEditor'
import { RuleValuesEditor } from './RuleValuesEditor'
import { SoundTab } from './SoundTab'
import { Toggle } from './Toggle'
import { VmdImportTab } from './VmdImportTab'
import { VoiceTab } from './VoiceTab'

/** スクリプト Mod の、ログと通信ログ(開いたときだけ読む) */
function ScriptLogs({ modId }: { modId: string }): React.JSX.Element {
  const [data, setData] = useState<{ log: string[]; http: Array<{ at: number; method: string; url: string; result: string }>; running: boolean } | null>(null)
  return (
    <details
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void window.vmaid.getScriptLogs(modId).then(setData)
      }}
    >
      <summary className="small">ログ・通信ログを見る</summary>
      {data && (
        <div className="small">
          <p className="muted">スクリプト: {data.running ? '動いています(使われなければ、5分で終了します)' : '止まっています(ルールが使うときに、起動します)'}</p>
          <strong>通信ログ(本文は残しません)</strong>
          <ul className="reject-list">
            {data.http.slice(-20).map((h, i) => (
              <li key={i}>
                {new Date(h.at).toLocaleTimeString()} {h.method} {h.url} → {h.result}
              </li>
            ))}
            {data.http.length === 0 && <li className="muted">通信は、まだありません</li>}
          </ul>
          <strong>ログ</strong>
          <ul className="reject-list">
            {data.log.slice(-30).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
            {data.log.length === 0 && <li className="muted">ログは、まだありません</li>}
          </ul>
        </div>
      )}
    </details>
  )
}

/** 音声合成の設定(設定の全体を読んで、VoiceTab に渡す) */
function VoiceSettings(): React.JSX.Element {
  const [view, setView] = useState<SettingsView | null>(null)
  useEffect(() => {
    void window.vmaid.getSettings().then(setView)
  }, [])
  if (!view) return <p className="muted">読み込み中…</p>
  const update = async (patch: SettingsPatch): Promise<void> => {
    const r = await window.vmaid.updateSettings(patch)
    setView(r.view)
  }
  return <VoiceTab view={view} update={update} onResult={(r) => setView(r.view)} />
}

/** 機能 Mod ごとの詳細設定(Mod が ON のときだけ出す)。以前の専用タブの中身 */
function FeatureSettings({ feature }: { feature: string }): React.JSX.Element | null {
  switch (feature) {
    case 'tts':
      return <VoiceSettings />
    case 'se':
      return <SoundTab />
    case 'beautify-real':
    case 'beautify-toon':
      return <BeautifyTab />
    case 'chase':
      return <ChaseTab />
    case 'game':
      return <GameSettings game="tictactoe" />
    case 'game-connect4':
      return <GameSettings game="connect4" />
    case 'game-reversi':
      return <GameSettings game="reversi" />
    case 'game-chess':
      return <GameSettings game="chess" />
    case 'overlay':
      return <OverlayEffectsEditor />
    case 'move':
      return <MoveTab />
    case 'talk':
      return <TalkTab />
    case 'bubble-style':
      return <BubbleTab />
    case 'mmd':
      return <VmdImportTab />
    default:
      return null
  }
}

const CATEGORY_LABEL: Record<ModCategory, string> = { official: '公式', community: 'コミュニティ', individual: '自作' }

/** 1 行の要約(説明の最初の 1 文) */
const summary = (text: string): string => {
  const first = text.split(/[。\n]/)[0] ?? ''
  return first.length > 70 ? `${first.slice(0, 70)}…` : first
}

/** Mod タブ: Mod を 1 つ 1 行で並べる。行を開くと、その Mod の設定・ルール・中身がその場で出る(公式 / コミュニティ / 自作に分ける) */
export function ModsTab(): React.JSX.Element {
  const [view, setView] = useState<PacksView | null>(null)
  const [mods, setMods] = useState<ModsView | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  // スロット(モーション)の選択肢: 使えるモーションの名前
  const [motionNames, setMotionNames] = useState<string[]>([])
  useEffect(() => {
    void window.vmaid.getMotions().then((s) => setMotionNames(s.names))
    return window.vmaid.onMotionsChanged((s) => setMotionNames(s.names))
  }, [])

  useEffect(() => {
    let alive = true
    void window.vmaid.getPacks().then((v) => alive && setView(v))
    void window.vmaid.getMods().then((v) => alive && setMods(v))
    const offPacks = window.vmaid.onPacksChanged(() => void window.vmaid.getPacks().then((v) => alive && setView(v)))
    const offMods = window.vmaid.onModsChanged((v) => setMods(v))
    return () => {
      alive = false
      offPacks()
      offMods()
    }
  }, [])

  if (!view || !mods) return <p className="muted">読み込み中…</p>

  const run = async (fn: () => Promise<{ ok: boolean; message: string; view: PacksView }>): Promise<void> => {
    const r = await fn()
    setView(r.view)
    setNote(r.message ? { ok: r.ok, text: r.message } : null)
  }
  const saveSetting = async (modId: string, name: string, value: string): Promise<void> => {
    const r = await window.vmaid.setModSetting(modId, name, value)
    setView(r.view)
    setNote(r.message ? { ok: false, text: r.message } : null)
  }
  const toggleOpen = (id: string): void =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const personaCount = view.packs.filter((p) => p.enabled && p.valid && p.promptLayer === 'persona').length

  // コンポーネントにしない(行ごとに作り直されて、中の設定欄の入力が消えるのを防ぐ)
  const renderCard = (p: PackInfo): React.JSX.Element => {
    const isOpen = open.has(p.id)
    const featureId = p.feature ?? p.id
    const settingsPanel = p.enabled ? <FeatureSettings feature={featureId} /> : null
    return (
      <li key={p.id} className="pack mod-card">
        <div className="row mod-head">
          <button className="mod-chevron" aria-expanded={isOpen} aria-label={`${p.name}の詳細を${isOpen ? '閉じる' : '開く'}`} onClick={() => toggleOpen(p.id)}>
            {isOpen ? '▾' : '▸'}
          </button>
          <Toggle
            checked={p.enabled}
            disabled={!p.valid}
            label={`${p.name}を有効にする`}
            onChange={(on) => {
              // スクリプトを含む Mod を ON にするときは、権限を、もう一度、見せて確認する
              if (on && p.script && !window.confirm(`Mod「${p.name}」を ON にします。\n\n次の権限で、スクリプトが動きます:\n${p.script.permissions.map((l) => `${l.danger ? '⚠ ' : '・'}${l.text}`).join('\n')}\n\n信頼できる配布元のものですか?`)) return
              void run(async () => ({ ok: true, message: '', view: await window.vmaid.setPackEnabled(p.id, on) }))
            }}
          />
          <button className="mod-title" onClick={() => toggleOpen(p.id)}>
            <strong>{p.name}</strong>
          </button>
          {p.version && <span className="muted small">v{p.version}</span>}
          {p.category !== 'official' && <span className="badge warn">{CATEGORY_LABEL[p.category]}</span>}
          {p.promptLayer && <span className="badge">{p.promptLayer === 'persona' ? '性格' : '状態'}</span>}
          {p.script && <span className="badge warn">スクリプト</span>}
          {!p.valid && <span className="badge warn">読み込めません</span>}
          {p.rules.length > 0 && <span className="muted small">ルール {p.rules.filter((r) => r.enabled).length}/{p.rules.length}</span>}
        </div>
        {!isOpen && p.description && <p className="muted small mod-summary">{summary(p.description)}</p>}
        {isOpen && (
          <div className="mod-body">
            {p.description && <p className="muted small">{p.description}</p>}
            {p.errors.length > 0 && (
              <ul className="reject-list">
                {p.errors.map((e) => (
                  <li key={e} className="ng small">
                    {e}
                  </li>
                ))}
              </ul>
            )}
            {p.requires.length > 0 && (
              <p className="muted small">
                必要な機能 Mod:{' '}
                {p.requires.map((r) => (
                  <span key={r.id} className={r.enabled ? 'badge' : 'badge warn'}>
                    {r.name}{r.enabled ? '' : '(OFF)'}
                  </span>
                ))}
                {p.requires.some((r) => !r.enabled) && ' OFF のものを使う部分は、ON にするまで動きません'}
              </p>
            )}
            {settingsPanel && <div className="mod-embed">{settingsPanel}</div>}
            {p.slots.length > 0 && (
              <SlotEditor
                pack={p}
                motionNames={motionNames}
                onSet={(slotId, value, characterId) => void run(async () => ({ ok: true, message: '', view: await window.vmaid.setModSlot(p.id, slotId, value, characterId || undefined) }))}
              />
            )}
            {p.ruleFields.length > 0 && (
              <RuleValuesEditor
                pack={p}
                onSet={(ruleId, path, value, characterId) => void run(async () => ({ ok: true, message: '', view: await window.vmaid.setModRuleValue(p.id, ruleId, path, value, characterId || undefined) }))}
              />
            )}
            {p.uiWindow && (
              <div className="slot-field">
                <label className="field-inline">
                  <input
                    type="checkbox"
                    checked={p.uiWindow.visible}
                    onChange={(e) => void run(async () => ({ ok: true, message: '', view: await window.vmaid.setModUiWindow(p.id, { visible: e.target.checked }) }))}
                  />
                  一覧の窓を表示する
                </label>
                <label className="field-inline">
                  <input
                    type="checkbox"
                    checked={p.uiWindow.follow}
                    onChange={(e) => void run(async () => ({ ok: true, message: '', view: await window.vmaid.setModUiWindow(p.id, { follow: e.target.checked }) }))}
                  />
                  キャラに追従する(オフなら、好きな場所に置けます。大きさは、変えられます)
                </label>
                <div className="muted small">この Mod が集めた見出しを、窓で見られます。Mod が ON のときだけ出ます。トレイ・右クリックのメニューからも、出し入れできます。</div>
              </div>
            )}
            {p.script && (
              <div className="script-box">
                <div className="muted small">
                  <span className="badge warn">スクリプトを含む</span> サンドボックスの中で動き、次の権限だけを使えます(ファイル・OS には触れません):
                </div>
                <ul className="reject-list">
                  {p.script.permissions.map((l) => (
                    <li key={l.text} className={l.danger ? 'ng small' : 'small'}>
                      {l.danger ? '⚠ ' : '・'}
                      {l.text}
                    </li>
                  ))}
                </ul>
                {p.script.blocked && <p className="ng small">{p.script.blocked}</p>}
                {p.script.settings.length > 0 && (
                  <div className="slots">
                    <div className="muted small">この Mod の設定(空にすると、既定値に戻ります。トークンなどの秘密の値は、暗号化して保存し、画面には出しません):</div>
                    {p.script.settings.map((s) => (
                      <label key={`${p.id}-${s.name}`} className="field-inline">
                        {s.label}
                        {s.kind === 'file' ? (
                          <span className="row">
                            <code className="small">{s.value || '(未選択)'}</code>
                            <button
                              onClick={(e) => {
                                e.preventDefault()
                                void window.vmaid.pickModLauncher(p.id).then((r) => {
                                  setView(r.view)
                                  setNote(r.message ? { ok: false, text: r.message } : null)
                                })
                              }}
                            >
                              選ぶ…
                            </button>
                            {s.value !== '' && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault()
                                  void saveSetting(p.id, s.name, '')
                                }}
                              >
                                解除
                              </button>
                            )}
                          </span>
                        ) : s.kind === 'urls' ? (
                          <textarea
                            rows={5}
                            style={{ width: '100%' }}
                            defaultValue={s.value}
                            placeholder={'https://example.com/rss.xml\n(1 行に 1 つ。https の外部のサイトだけ。保存するとき、サイトごとに確認が出ます)'}
                            onBlur={(e) => e.target.value.trim() !== s.value.trim() && void saveSetting(p.id, s.name, e.target.value)}
                          />
                        ) : s.kind === 'enum' ? (
                          <select value={s.value} onChange={(e) => void saveSetting(p.id, s.name, e.target.value)}>
                            <option value="">(既定{s.default !== undefined ? `: ${s.options?.find((o) => o.value === s.default)?.label ?? s.default}` : ''})</option>
                            {(s.options ?? []).map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : s.kind === 'boolean' ? (
                          <select value={s.value} onChange={(e) => void saveSetting(p.id, s.name, e.target.value)}>
                            <option value="">(既定{s.default !== undefined ? `: ${s.default}` : ''})</option>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : (
                          <input
                            type={s.kind === 'secret' ? 'password' : 'text'}
                            defaultValue={s.value}
                            placeholder={s.kind === 'secret' ? (s.isSet ? '設定済み(変えるときだけ入力)' : '未設定') : (s.default ?? '')}
                            onBlur={(e) => e.target.value !== s.value && (s.kind !== 'secret' || e.target.value !== '') && void saveSetting(p.id, s.name, e.target.value)}
                          />
                        )}
                        {s.hint && <span className="muted small"> {s.hint}</span>}
                      </label>
                    ))}
                  </div>
                )}
                {p.script.launcher && (
                  <div className="slots">
                    <button
                      disabled={!p.enabled}
                      onClick={() => {
                        const label = p.script?.launcher?.label ?? ''
                        setNote({ ok: true, text: `${label}を起動しています…(モデルの読み込みに、時間がかかることがあります)` })
                        void window.vmaid.startModLauncher(p.id).then((r) => setNote({ ok: r.ok, text: r.message }))
                      }}
                    >
                      {p.script.launcher.label}を起動する
                    </button>
                    <span className="muted small"> すでに起動していれば、何もしません。VMaid が起動したものは、VMaid の終了時・この Mod を OFF にしたときに、止めます。</span>
                  </div>
                )}
                <ScriptLogs modId={p.id} />
              </div>
            )}
            {p.rules.length > 0 && (
              <>
                <h3>ルール({p.rules.length})</h3>
                <p className="muted small">1 つずつ ON/OFF できます。OFF にしたルールは、Mod が ON でも動きません。</p>
                <ul className="reject-list mod-rules">
                  {p.rules.map((r) => (
                    <li key={r.id}>
                      <Toggle
                        checked={r.enabled}
                        label={`ルール ${r.id} を有効にする`}
                        onChange={(on) => void run(async () => ({ ok: true, message: '', view: await window.vmaid.setModRuleEnabled(r.id, on) }))}
                      />{' '}
                      <code>{r.id}</code> <span className="muted small">{r.description}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {p.motions.length > 0 && (
              <>
                <h3>モーション({p.motions.length})</h3>
                <ul className="reject-list">
                  {p.motions.map((m) => (
                    <li key={m.name}>
                      <code>{m.name}</code>
                      {m.redistributable === true && <span className="badge">再配布可</span>}
                      {m.redistributable === false && <span className="badge warn">再配布不可</span>}
                      <div className="muted small">
                        {m.source && <>出典: {m.source}  </>}
                        {m.license && <>規約: {m.license}  </>}
                        {m.attribution && <>クレジット: {m.attribution}</>}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="row">
              {p.dir && <span className="muted small">場所: {p.dir}</span>}
              {p.category === 'individual' && p.valid && <button onClick={() => void run(() => window.vmaid.exportPack(p.id))}>書き出す(自分の別のPCへ)…</button>}
            </div>
          </div>
        )}
      </li>
    )
  }

  const section = (category: ModCategory, empty: string): React.JSX.Element => {
    const list = view.packs.filter((p) => p.category === category)
    return (
      <>
        <ul className="motion-list">
          {list.map((p) => renderCard(p))}
        </ul>
        {list.length === 0 && <p className="muted small">{empty}</p>}
      </>
    )
  }

  return (
    <section>
      <h1>Mod</h1>
      <p className="muted">機能・ルール・モーションを、Mod としてまとめて ON/OFF します。行をクリックすると、その Mod の設定・ルール・中身が開きます。OFF にしても、保存した設定は消えません。</p>
      {personaCount > 1 && (
        <div className="notice warn">性格の Mod が {personaCount} 個 ON です(重ね掛けできます)。話し方が矛盾するときは、Mod の id 順で、あとのものが優先されます。</div>
      )}
      {note && <p className={note.ok ? 'ok small' : 'ng small'}>{note.text}</p>}

      <h2>公式</h2>
      <p className="muted small">アプリに同梱された Mod です(自作・再配布できると確認できたものだけ)。</p>
      {section('official', '公式の Mod は、ありません。')}

      <h2>コミュニティ</h2>
      <p className="muted small">
        他の人が作った Mod を、<code>.vmaidmod</code> から取り込んだものです。取り込むと、中身と権限を確認してから、OFF の状態で追加されます。置き場所: <code>{view.communityDir}</code>
      </p>
      <div className="row">
        <button onClick={() => void run(() => window.vmaid.importPack())}>.vmaidmod を取り込む…</button>
      </div>
      {section('community', '取り込んだ Mod は、まだありません。')}

      <h2>自作</h2>
      <p className="muted small">
        あなたが作った Mod です(再配布が許されていない素材を使うものも、ここに置けます)。<strong>あなたのPCの中だけ</strong>にあります。
        置き場所: <code>{view.individualDir}</code>(<code>Mod の id/mod.yaml</code> とモーション(.vrma)のフォルダを置くと、読み込まれます)。
        別のPC(Mac → Windows など)へ移すには、各 Mod の「書き出す」で .vmaidmod を作り、別のPCの「取り込む」で読み込みます。
      </p>
      <div className="row">
        <button className="primary" onClick={() => window.vmaid.openPacksFolder()}>
          自作 Mod のフォルダを開く
        </button>
      </div>
      {section('individual', '自作の Mod は、まだありません。')}

      <h2>マイ Mod を作る</h2>
      <ModExportSection />

      <h2>開発者向け</h2>
      <label className="radio-line">
        <Toggle checked={mods.developerMode} label="開発者向けを有効にする" onChange={(on) => void window.vmaid.setDeveloperMode(on).then(setMods)} />
        スクリプトを含む Mod の導入を許す
      </label>
      <p className="muted small">ON にすると、スクリプトを含む Mod を、取り込み・使えるようになります(権限を確認してから、ON にします)。信頼できる配布元のものだけを入れてください。OFF にすると、スクリプトを含む Mod は、すべて止まります。</p>
    </section>
  )
}
