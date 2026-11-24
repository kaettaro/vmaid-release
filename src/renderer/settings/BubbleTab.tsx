import { useEffect, useState } from 'react'
import {
  BUBBLE_FONT_LABEL,
  BUBBLE_FONTS,
  BUBBLE_SHAPE_LABEL,
  BUBBLE_SHAPES,
  CONTENT_CATEGORIES,
  CONTENT_CATEGORY_LABEL,
  DEFAULT_CONTENT_TABLE,
  DEFAULT_EMOTION_TABLE,
  EMOTION_CATEGORIES,
  EMOTION_CATEGORY_LABEL,
  MAX_CONTENT_RULES,
  resolveBubbleStyle,
  type BubbleBase,
  type BubbleOverride,
  type BubblePatch,
  type BubbleSettings,
  type BubbleView,
  type ContentCategory,
  type ContentRule
} from '@shared/bubble'
import { Toggle } from './Toggle'

interface CharacterRef {
  id: string
  name: string
}

/** 吹き出しの見本(キャラ画面と同じ CSS の変数・形で描く) */
function Preview({ settings, characterId, emotion, text }: { settings: BubbleSettings; characterId: string; emotion?: string; text: string }): React.JSX.Element {
  const mine = resolveBubbleStyle({ settings, characterId, side: 'character', emotion, text })
  const yours = resolveBubbleStyle({ settings, characterId, side: 'user' })
  return (
    <div className="bubble-preview">
      <div className="bubble bubble-character" data-shape={mine.shape} data-shake={mine.shake ? '' : undefined} style={mine.css as React.CSSProperties}>
        <div className="bubble-scroll">{text}</div>
      </div>
      <div className="bubble bubble-user" data-shape={yours.shape} style={yours.css as React.CSSProperties}>
        <div className="bubble-scroll sent">こんにちは</div>
      </div>
    </div>
  )
}

/** 変化 1 つ分の編集行(形・色・大きさ・太字・ふるえ)。感情・内容の表・キーワードの規則で共通 */
function PatchEditor({ patch, onChange, onReset }: { patch: BubblePatch; onChange: (patch: BubblePatch) => void; onReset?: () => void }): React.JSX.Element {
  const set = (p: Partial<Record<keyof BubblePatch, unknown>>): void => onChange({ ...patch, ...p } as BubblePatch)
  return (
    <>
      <select value={patch.shape ?? ''} onChange={(e) => set({ shape: e.target.value === '' ? undefined : e.target.value })}>
        <option value="">形は変えない</option>
        {BUBBLE_SHAPES.map((sh) => (
          <option key={sh} value={sh}>
            {BUBBLE_SHAPE_LABEL[sh]}
          </option>
        ))}
      </select>
      <label>
        背景 <input type="color" value={patch.bg ?? '#ffffff'} onChange={(e) => set({ bg: e.target.value })} />
      </label>
      <label>
        文字 <input type="color" value={patch.fg ?? '#2a2a35'} onChange={(e) => set({ fg: e.target.value })} />
      </label>
      <label>
        縁 <input type="color" value={patch.border ?? '#888888'} onChange={(e) => set({ border: e.target.value })} />
      </label>
      <label>
        大きさ ×
        <input type="number" min={0.5} max={2} step={0.05} value={patch.scale ?? 1} style={{ width: 64 }} onChange={(e) => set({ scale: Number(e.target.value) })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={patch.bold ?? false} onChange={(e) => set({ bold: e.target.checked })} />
        太字
      </label>
      <label className="check">
        <input type="checkbox" checked={patch.shake ?? false} onChange={(e) => set({ shake: e.target.checked })} />
        ふるえる
      </label>
      {onReset && <button onClick={onReset}>初期値</button>}
    </>
  )
}

/** 機能 Mod「吹き出し拡張」の設定(Mod タブの、この Mod の行の中)。共通 + キャラごとの上書き + 感情・発言の内容による変化 */
export function BubbleTab(): React.JSX.Element {
  const [view, setView] = useState<BubbleView | null>(null)
  const [characters, setCharacters] = useState<CharacterRef[]>([])
  /** 編集の対象: '' = 全キャラ共通 / キャラ id = そのキャラだけの上書き */
  const [scope, setScope] = useState('')
  const [previewEmotion, setPreviewEmotion] = useState('')
  const [previewText, setPreviewText] = useState('今日もいい天気だね')

  useEffect(() => {
    void window.vmaid.getBubble().then(setView)
    void window.vmaid.getCharacterChange().then((c) => setCharacters(c.characters))
    const offB = window.vmaid.onBubbleChanged(setView)
    const offC = window.vmaid.onCharacterChanged((c) => setCharacters(c.characters))
    return () => {
      offB()
      offC()
    }
  }, [])
  if (!view) return <p className="muted">読み込み中…</p>

  const settings: BubbleSettings = view
  const base = view.base
  const over: Partial<BubbleOverride> = scope === '' ? {} : (view.byCharacter[scope] ?? {})
  // 画面に出す値: 共通の画面では基本、キャラの画面では「上書き → 基本」
  const shown = <K extends keyof BubbleBase>(key: K): BubbleBase[K] => (scope === '' ? base[key] : ((over[key as keyof BubbleOverride] as BubbleBase[K] | undefined) ?? base[key]))
  const saveBase = (patch: Partial<BubbleBase>): void => void window.vmaid.saveBubble({ base: { ...base, ...patch } }).then(setView)
  const saveOver = (patch: Partial<BubbleOverride>): void => {
    const next = { ...(view.byCharacter[scope] ?? {}), ...patch }
    void window.vmaid.saveBubble({ byCharacter: { ...view.byCharacter, [scope]: next } }).then(setView)
  }
  const change = (patch: Partial<BubbleBase>): void => (scope === '' ? saveBase(patch) : saveOver(patch as Partial<BubbleOverride>))
  const side = (which: 'character' | 'user', patch: Partial<BubbleBase['character']>): void => {
    if (scope === '') saveBase({ [which]: { ...base[which], ...patch } })
    else saveOver({ [which]: { ...(over[which] ?? {}), ...patch } })
  }
  const clearOver = (): void => {
    const rest = { ...view.byCharacter }
    delete rest[scope]
    void window.vmaid.saveBubble({ byCharacter: rest }).then(setView)
  }
  const sideValue = (which: 'character' | 'user', key: 'bg' | 'fg' | 'border'): string | null => (scope === '' ? base[which][key] : (over[which]?.[key] ?? base[which][key]))
  const previewId = scope === '' ? '' : scope
  const hasOver = scope !== '' && Object.keys(view.byCharacter[scope] ?? {}).length > 0

  const colorRow = (which: 'character' | 'user', label: string): React.JSX.Element => (
    <div className="field-inline">
      <strong>{label}</strong>
      <label>
        背景 <input type="color" value={sideValue(which, 'bg') ?? '#ffffff'} onChange={(e) => side(which, { bg: e.target.value })} />
      </label>
      <label>
        文字 <input type="color" value={sideValue(which, 'fg') ?? '#2a2a35'} onChange={(e) => side(which, { fg: e.target.value })} />
      </label>
      <label>
        縁 <input type="color" value={sideValue(which, 'border') ?? '#888888'} onChange={(e) => side(which, { border: e.target.value })} />
      </label>
      <button onClick={() => side(which, { border: null })}>縁なし</button>
    </div>
  )

  const saveEmotion = (table: BubbleView['emotion']['table'], enabled = view.emotion.enabled): void => void window.vmaid.saveBubble({ emotion: { enabled, table } }).then(setView)
  const saveContent = (patch: Partial<BubbleView['content']>): void => void window.vmaid.saveBubble({ content: { enabled: view.content.enabled, table: view.content.table, rules: view.content.rules, ...patch } }).then(setView)
  const setRule = (i: number, rule: ContentRule): void => saveContent({ rules: view.content.rules.map((r, j) => (j === i ? rule : r)) })
  const moveRule = (i: number, d: -1 | 1): void => {
    const rules = [...view.content.rules]
    const j = i + d
    if (j < 0 || j >= rules.length) return
    ;[rules[i], rules[j]] = [rules[j]!, rules[i]!]
    saveContent({ rules })
  }

  return (
    <div className="engine-box">
      <p className="muted small">キャラのセリフと、自分の入力の吹き出しを変えます。変更は、すぐ画面のキャラに反映されます。</p>

      <div className="field-inline">
        <strong>編集する対象</strong>
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">全キャラ共通</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} だけ(上書き)
            </option>
          ))}
        </select>
        {scope !== '' && (
          <button disabled={!hasOver} onClick={clearOver}>
            このキャラの上書きを消す
          </button>
        )}
      </div>

      <div className="field-inline">
        <strong>見本</strong>
        <select value={previewEmotion} onChange={(e) => setPreviewEmotion(e.target.value)}>
          <option value="">感情なし</option>
          {EMOTION_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {EMOTION_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <label>
          セリフ{' '}
          <input type="text" value={previewText} maxLength={80} style={{ width: 220 }} onChange={(e) => setPreviewText(e.target.value)} />
        </label>
      </div>
      <Preview settings={settings} characterId={previewId} emotion={previewEmotion || undefined} text={previewText} />

      <div className="field-inline">
        <label>
          キャラの吹き出しの形{' '}
          <select value={shown('shape')} onChange={(e) => change({ shape: e.target.value as BubbleBase['shape'] })}>
            {BUBBLE_SHAPES.map((s) => (
              <option key={s} value={s}>
                {BUBBLE_SHAPE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          自分の吹き出しの形{' '}
          <select value={shown('userShape')} onChange={(e) => change({ userShape: e.target.value as BubbleBase['userShape'] })}>
            {BUBBLE_SHAPES.map((s) => (
              <option key={s} value={s}>
                {BUBBLE_SHAPE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {colorRow('character', 'キャラの吹き出しの色')}
      {colorRow('user', '自分の吹き出しの色')}
      <div className="field-inline">
        <label>
          フォント{' '}
          <select value={shown('font')} onChange={(e) => change({ font: e.target.value as BubbleBase['font'] })}>
            {BUBBLE_FONTS.map((f) => (
              <option key={f} value={f}>
                {BUBBLE_FONT_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        {shown('font') === 'custom' && (
          <label>
            フォント名{' '}
            <input type="text" defaultValue={shown('customFont')} placeholder="例: Yu Gothic UI" maxLength={60} onBlur={(e) => change({ customFont: e.target.value })} />
          </label>
        )}
      </div>
      <label className="field">
        <span className="field-label">文字の大きさ: ×{shown('fontScale').toFixed(2)}</span>
        <input type="range" min={0.7} max={1.8} step={0.05} value={shown('fontScale')} onChange={(e) => change({ fontScale: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span className="field-label">背景の濃さ: {Math.round(shown('opacity') * 100)}%</span>
        <input type="range" min={0.3} max={1} step={0.02} value={shown('opacity')} onChange={(e) => change({ opacity: Number(e.target.value) })} />
      </label>
      {scope === '' && <p className="muted small">フォント名は、このパソコンに入っているフォントの名前です(無ければ、標準のフォントになります)。フォントファイルの同梱は、していません。</p>}

      <h3>漫画のように変える</h3>
      <label className="check">
        <Toggle checked={view.emotion.enabled} label="感情で変える" onChange={(on) => saveEmotion(view.emotion.table, on)} />
        キャラの感情で変える(AI に、返答の最初に感情タグを付けてもらいます。言い始めから変わります。タグを付けてくれない小さなモデルでは、変わりません)
      </label>
      {view.emotion.enabled && (
        <ul className="reject-list">
          {EMOTION_CATEGORIES.map((c) => (
            <li key={c} className="field-inline">
              <strong>{EMOTION_CATEGORY_LABEL[c]}</strong>
              <PatchEditor patch={view.emotion.table[c]} onChange={(p) => saveEmotion({ ...view.emotion.table, [c]: p })} onReset={() => saveEmotion({ ...view.emotion.table, [c]: DEFAULT_EMOTION_TABLE[c] })} />
            </li>
          ))}
        </ul>
      )}
      <label className="check">
        <Toggle checked={view.content.enabled} label="発言の内容で変える" onChange={(on) => saveContent({ enabled: on })} />
        発言の内容で変える(ルールのセリフにも効きます。感情がある場合は、感情が優先)
      </label>
      {view.content.enabled && (
        <>
          <ul className="reject-list">
            {CONTENT_CATEGORIES.map((c: ContentCategory) => (
              <li key={c} className="field-inline">
                <strong>{CONTENT_CATEGORY_LABEL[c]}</strong>
                <PatchEditor patch={view.content.table[c]} onChange={(p) => saveContent({ table: { ...view.content.table, [c]: p } })} onReset={() => saveContent({ table: { ...view.content.table, [c]: DEFAULT_CONTENT_TABLE[c] } })} />
              </li>
            ))}
          </ul>
          <h4>キーワードの規則</h4>
          <p className="muted small">セリフに、指定した語(「,」で区切って複数)のどれかが含まれると、その見た目を重ねます。上の規則から順に当てはめ、あとのものが勝ちます(最大 {MAX_CONTENT_RULES} 件)。</p>
          <ul className="reject-list">
            {view.content.rules.map((r, i) => (
              <li key={i} className="field-inline">
                <input type="text" defaultValue={r.words.join(',')} placeholder="例: ありがとう,感謝" style={{ width: 170 }} onBlur={(e) => setRule(i, { ...r, words: e.target.value.split(/[,、，]/) })} />
                <PatchEditor patch={r.patch} onChange={(p) => setRule(i, { ...r, patch: p })} />
                <button title="上へ" disabled={i === 0} onClick={() => moveRule(i, -1)}>
                  ↑
                </button>
                <button title="下へ" disabled={i === view.content.rules.length - 1} onClick={() => moveRule(i, 1)}>
                  ↓
                </button>
                <button onClick={() => saveContent({ rules: view.content.rules.filter((_, j) => j !== i) })}>削除</button>
              </li>
            ))}
          </ul>
          <button disabled={view.content.rules.length >= MAX_CONTENT_RULES} onClick={() => saveContent({ rules: [...view.content.rules, { words: ['ありがとう'], patch: { shape: 'cloud' } }] })}>
            規則を足す
          </button>
        </>
      )}
    </div>
  )
}
