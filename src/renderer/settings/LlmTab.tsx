import { useState } from 'react'
import { isLocalEndpoint, normalizeBaseUrl } from '@shared/llm/endpoint'
import type { LlmTestResult, SettingsPatch, SettingsView } from '@shared/settingsApi'
import { Field, TextField } from './fields'
import { ModelsSection } from './ModelsSection'

interface Props {
  view: SettingsView
  update: (patch: SettingsPatch) => Promise<void>
}

export function LlmTab({ view, update }: Props): React.JSX.Element {
  const { llm, secureStorageAvailable } = view
  const [apiKey, setApiKey] = useState('')
  const [test, setTest] = useState<LlmTestResult | 'running' | null>(null)

  const normalized = normalizeBaseUrl(llm.baseUrl)
  // 会話がこのPCの外に出る設定のときは警告する(SPEC 8章)
  const external = normalized !== null && !isLocalEndpoint(normalized)

  const runTest = async (): Promise<void> => {
    setTest('running')
    setTest(await window.vmaid.testLlm())
  }

  return (
    <section>
      <h1>LLM</h1>
      <p className="muted">
        {llm.backend === 'builtin'
          ? '会話に使う言語モデルを、このアプリの中で動かします。会話の内容は、このPCの外に出ません。'
          : '会話に使う言語モデルの接続先です。会話は、ここで指定した接続先にだけ送られます。'}
      </p>

      <Field label="実行方式">
        <div className="radios">
          <label>
            <input type="radio" name="backend" checked={llm.backend === 'builtin'} onChange={() => void update({ llm: { backend: 'builtin' } })} />
            内蔵(アプリ内で動かす) — 何も入れずに使えます(初回のみモデルをダウンロード)
          </label>
          <label>
            <input type="radio" name="backend" checked={llm.backend === 'openai'} onChange={() => void update({ llm: { backend: 'openai' } })} />
            OpenAI互換(Ollama / LM Studio など、別に動かしているLLM)
          </label>
        </div>
      </Field>

      {llm.backend === 'builtin' ? (
        <ModelsSection />
      ) : (
        <>

      <TextField
        label="URL"
        value={llm.baseUrl}
        placeholder="http://localhost:11434/v1"
        hint="Ollama は http://localhost:11434/v1 、LM Studio は http://localhost:1234/v1 です。末尾の /v1 は自動で補います。"
        onCommit={(v) => void update({ llm: { baseUrl: v } })}
      />
      {external && (
        <div className="notice warn" role="alert">
          <strong>外部サーバーへ会話が送信されます。</strong>
          このURLは、このPCの外にあります(localhost 以外)。入力した会話の内容が、そのサーバーに送られます。信頼できる接続先か確認してください。
        </div>
      )}

      <TextField
        label="モデル名"
        value={llm.model}
        placeholder="空欄なら自動で選びます"
        hint={
          <>
            空欄のままで使えます(サーバーにあるモデルから、思考過程を出さないものを優先して自動で選びます)。指定する場合は Ollama の <code>ollama list</code> に出る名前。
            思考過程を長く出力するモデル(Qwen3 の <code>-thinking</code> など)は、返答が出るまで遅くなります。
          </>
        }
        onCommit={(v) => void update({ llm: { model: v.trim() } })}
      />

      <Field
        label="APIキー(任意)"
        hint={
          secureStorageAvailable
            ? 'OllamaやLM Studioでは不要です。外部のサービスを使う場合だけ入力します。OSの安全な保管庫(Keychain / 資格情報)に暗号化して保存し、設定ファイルには平文で残しません。'
            : 'この環境ではOSの安全な保管庫が使えないため、APIキーは保存できません。'
        }
      >
        <div className="row">
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={!secureStorageAvailable}
            placeholder={llm.hasApiKey ? '設定済み(新しいキーで上書きできます)' : '未設定'}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            disabled={!secureStorageAvailable || apiKey === ''}
            onClick={() => {
              void update({ apiKey }).then(() => setApiKey(''))
            }}
          >
            保存
          </button>
          <button disabled={!llm.hasApiKey} onClick={() => void update({ apiKey: null })}>
            削除
          </button>
        </div>
      </Field>

      <Field label="文脈に入れる直近のターン数" hint="多いほど会話の流れを覚えますが、返答が遅くなります。">
        <input
          type="number"
          min={1}
          max={50}
          value={llm.maxTurns}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value))
            if (n >= 1 && n <= 50) void update({ llm: { maxTurns: n } })
          }}
        />
      </Field>

      <div className="row">
        <button className="primary" onClick={() => void runTest()} disabled={test === 'running'}>
          接続テスト
        </button>
        {test === 'running' && <span className="muted">確認中…</span>}
        {test && test !== 'running' && <span className={test.ok ? 'ok' : 'ng'}>{test.message}</span>}
      </div>
        </>
      )}
    </section>
  )
}
