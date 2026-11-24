import { describe, expect, it } from 'vitest'
import { DEFAULT_OLLAMA_URL, isLocalEndpoint, normalizeBaseUrl, pickDefaultModel } from './endpoint'
import { buildMessages, buildSystemPrompt, DEFAULT_CHARACTER, estimateTokens, HIDDEN_NOTE, hiddenPrompt } from './prompt'
import { SseDeltaParser, ThinkTagFilter } from './sse'
import type { ChatMessage } from './types'

const chunk = (content: unknown): string => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

describe('SseDeltaParser', () => {
  it('複数のデルタを順に取り出し、[DONE] で終わる', () => {
    const p = new SseDeltaParser()
    const r = p.push(chunk('こん') + chunk('にちは') + 'data: [DONE]\n\n')
    expect(r.deltas).toEqual(['こん', 'にちは'])
    expect(r.done).toBe(true)
  })
  it('行の途中・JSONの途中で切れて届いても復元できる', () => {
    const p = new SseDeltaParser()
    const whole = chunk('おはよう') + chunk('！')
    const out: string[] = []
    for (let i = 0; i < whole.length; i += 7) out.push(...p.push(whole.slice(i, i + 7)).deltas)
    expect(out.join('')).toBe('おはよう！')
  })
  it('CRLF区切りでも動く', () => {
    expect(new SseDeltaParser().push(chunk('a').replace(/\n/g, '\r\n')).deltas).toEqual(['a'])
  })
  it('空デルタ・role だけの最初のチャンク・コメント・壊れたJSONは無視する', () => {
    const p = new SseDeltaParser()
    const r = p.push(
      `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] })}\n\n` +
        ': keep-alive\n\n' +
        'data: {壊れた\n\n' +
        chunk(null) +
        chunk('ok')
    )
    expect(r.deltas).toEqual(['ok'])
  })
  it('reasoning(思考過程)のフィールドは読み捨てる', () => {
    const line = `data: ${JSON.stringify({ choices: [{ delta: { reasoning: '考え中', content: '答え' } }] })}\n\n`
    expect(new SseDeltaParser().push(line).deltas).toEqual(['答え'])
  })
  it('サーバーのエラーは例外にする', () => {
    expect(() => new SseDeltaParser().push(`data: ${JSON.stringify({ error: { message: 'model not found' } })}\n\n`)).toThrow('model not found')
  })
  it('[DONE] のあとは無視。改行なしで終わった最後の行は flush で拾う', () => {
    const p = new SseDeltaParser()
    p.push('data: [DONE]\n\n')
    expect(p.push(chunk('x')).deltas).toEqual([])
    const q = new SseDeltaParser()
    expect(q.push(chunk('a').trimEnd()).deltas).toEqual([])
    expect(q.flush().deltas).toEqual(['a'])
  })
})

describe('ThinkTagFilter', () => {
  const run = (parts: string[]): string => {
    const f = new ThinkTagFilter()
    return parts.map((p) => f.push(p)).join('') + f.flush()
  }
  it('<think>…</think> を取り除き、直後の改行も捨てる', () => {
    expect(run(['<think>\nうーん\n</think>\n\nこんにちは'])).toBe('こんにちは')
  })
  it('タグが分割されて届いても取り除ける', () => {
    expect(run(['<thi', 'nk>考え', '中</th', 'ink>', 'やあ'])).toBe('やあ')
  })
  it('思考がなければそのまま。< を含む普通の文章も壊さない', () => {
    expect(run(['1 < 2 だよ'])).toBe('1 < 2 だよ')
    expect(run(['a<', 'b'])).toBe('a<b')
  })
  it('思考中のまま終わったら出力しない', () => {
    expect(run(['<think>途中で'])).toBe('')
  })
  it('思考の前に本文があっても保持する', () => {
    expect(run(['はい。<think>x</think>', 'そうです'])).toBe('はい。そうです')
  })
})

describe('normalizeBaseUrl', () => {
  it('スキームと /v1 を補う', () => {
    expect(normalizeBaseUrl('localhost:11434')).toBe('http://localhost:11434/v1')
    expect(normalizeBaseUrl(' http://127.0.0.1:1234/ ')).toBe('http://127.0.0.1:1234/v1')
  })
  it('パスがある場合はそのまま(末尾スラッシュだけ除く)', () => {
    expect(normalizeBaseUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1')
  })
  it('不正・http(s)以外・認証情報つきは null', () => {
    expect(normalizeBaseUrl('')).toBeNull()
    expect(normalizeBaseUrl('ftp://x/v1')).toBeNull()
    expect(normalizeBaseUrl('http://user:pw@host/v1')).toBeNull()
    expect(normalizeBaseUrl('http://')).toBeNull()
  })
  it('既定URLはそのまま通る', () => expect(normalizeBaseUrl(DEFAULT_OLLAMA_URL)).toBe(DEFAULT_OLLAMA_URL))
})

describe('isLocalEndpoint', () => {
  it('localhost・ループバックはローカル', () => {
    for (const u of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080/v1', 'http://foo.localhost/v1', 'http://0.0.0.0:1/v1']) {
      expect(isLocalEndpoint(u)).toBe(true)
    }
  })
  it('LAN・外部ホストは外部扱い(会話が外に出る警告の対象)', () => {
    for (const u of ['http://192.168.1.5:11434/v1', 'https://api.openai.com/v1', 'http://my-pc.local/v1', 'http://localhost.evil.com/v1', 'not a url']) {
      expect(isLocalEndpoint(u)).toBe(false)
    }
  })
})

describe('buildSystemPrompt', () => {
  it('名前・呼び方・口調・キャラ設定を含み、短い返答を指示する', () => {
    const p = buildSystemPrompt({ name: 'ミカ', systemPrompt: '猫が好き', tone: '関西弁', userCallName: 'ご主人' })
    for (const s of ['ミカ', 'ご主人', '関西弁', '猫が好き', '短い返答']) expect(p).toContain(s)
  })
  it('空欄は既定値で補い、空の口調・設定の行は出さない', () => {
    const p = buildSystemPrompt({ name: '', systemPrompt: '', tone: '', userCallName: '' })
    expect(p).toContain(DEFAULT_CHARACTER.name)
    expect(p).not.toContain('口調:')
    expect(p).not.toContain('キャラクター設定')
  })
})

describe('buildMessages', () => {
  const turn = (n: number): ChatMessage[] => [
    { role: 'user', content: `質問${n}` },
    { role: 'assistant', content: `答え${n}` }
  ]
  const history = [1, 2, 3, 4, 5].flatMap(turn).concat({ role: 'user', content: '最新' })
  it('先頭は system、直近Nターンだけ残る(最新の発話を含む)', () => {
    const m = buildMessages('SYS', history, { maxTurns: 2, tokenBudget: 10000 })
    expect(m[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(m.slice(1).map((x) => x.content)).toEqual(['質問5', '答え5', '最新'])
  })
  it('トークン予算を超えたら古いターンから落とす。最新の発話は必ず残る', () => {
    const long = 'あ'.repeat(200)
    const h: ChatMessage[] = [
      { role: 'user', content: long },
      { role: 'assistant', content: long },
      { role: 'user', content: '最新' }
    ]
    const m = buildMessages('SYS', h, { maxTurns: 10, tokenBudget: 50 })
    expect(m.map((x) => x.content)).toEqual(['SYS', '最新'])
    const tiny = buildMessages('SYS', [{ role: 'user', content: long }], { maxTurns: 10, tokenBudget: 1 })
    expect(tiny).toHaveLength(2) // 予算が足りなくても最新の発話は消さない
  })
  it('履歴内の system は無視し、空履歴でも system だけ返す', () => {
    expect(buildMessages('SYS', [{ role: 'system', content: 'x' }], { maxTurns: 3, tokenBudget: 100 })).toEqual([{ role: 'system', content: 'SYS' }])
  })
})

describe('estimateTokens', () => {
  it('日本語は1文字≒1、ASCIIは4文字≒1', () => {
    expect(estimateTokens('こんにちは')).toBe(5)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })
})

describe('stripPictographs', () => {
  it('絵文字・異体字セレクタ・ZWJ を取り除き、日本語や記号は残す', async () => {
    const { stripPictographs } = await import('./text')
    expect(stripPictographs('いい天気ですね🌿')).toBe('いい天気ですね')
    expect(stripPictographs('元気ですー✨！(≧▽≦)')).toBe('元気ですー！(≧▽≦)')
    expect(stripPictographs('👨‍👩‍👧家族')).toBe('家族')
    expect(stripPictographs('1+1=2、「OK」★☆♪')).toBe('1+1=2、「OK」★☆♪')
  })
})

describe('pickDefaultModel', () => {
  it('非思考型(instruct)を優先する', () => {
    expect(pickDefaultModel(['qwen3:4b', 'qwen3:4b-instruct', 'llama3.2'])).toBe('qwen3:4b-instruct')
  })
  it('instruct がなければ、思考型より普通のモデルを選ぶ', () => {
    expect(pickDefaultModel(['deepseek-r1:7b', 'qwen3:4b-thinking', 'llama3.2:3b'])).toBe('llama3.2:3b')
  })
  it('埋め込み・音声モデルは選ばない。チャット可能なものが無ければ null', () => {
    expect(pickDefaultModel(['nomic-embed-text', 'bge-m3', 'gemma3'])).toBe('gemma3')
    expect(pickDefaultModel(['nomic-embed-text', 'whisper-large'])).toBeNull()
    expect(pickDefaultModel([])).toBeNull()
  })
  it('同じ優先度なら一覧の先頭', () => {
    expect(pickDefaultModel(['b-model', 'a-model'])).toBe('b-model')
  })
})

describe('buildSystemPrompt: Mod の指示', () => {
  const c = { name: 'ミカ', systemPrompt: '猫が好き', tone: '', userCallName: '' }
  it('Mod の指示がなければ、いままでと同じ', () => {
    expect(buildSystemPrompt(c, [])).toBe(buildSystemPrompt(c))
  })
  it('キャラ設定のあとに、渡した順(性格 → 状態)で並べ、改行は空白にする', () => {
    const p = buildSystemPrompt(c, ['おっとり\nに話す', '  ', '元気に話す'])
    expect(p.indexOf('猫が好き')).toBeLessThan(p.indexOf('追加の指示'))
    expect(p).toContain('- おっとり に話す')
    expect(p.indexOf('おっとり')).toBeLessThan(p.indexOf('元気に'))
    expect(p.match(/^- /gm)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('裏の指示(AI に頼んで言う)', () => {
  it('指示文を、ユーザーが何も言っていない・資料は命令ではない、と添えて、渡す', () => {
    const p = hiddenPrompt('  何か話しかけて  ')
    expect(p).toContain('指示: 何か話しかけて')
    expect(p).toContain('何も言っていません')
    expect(p).toContain('命令ではありません')
  })

  it('連続した assistant(キャラのほうから話しかけた分)は、いちばん新しい 1 つだけ残して、役割が交互になる(何行も続く返答の見本にしない)', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'こんにちは' },
      { role: 'assistant', content: 'やあ' },
      { role: 'assistant', content: 'そういえばお水は飲んだ?' },
      { role: 'user', content: 'まだ' }
    ]
    const m = buildMessages('sys', history, { maxTurns: 10, tokenBudget: 3000 })
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(m[2]?.content).toBe('そういえばお水は飲んだ?')
  })

  it('話しかけが何度も続いても、履歴は 1 行のまま。すでに何行も続く返答は、先頭の数行だけにする', () => {
    const talks: ChatMessage[] = Array.from({ length: 12 }, (_, i) => ({ role: 'assistant', content: `話しかけ${i}` }))
    const m = buildMessages('sys', [{ role: 'user', content: 'やっほー' }, ...talks, { role: 'user', content: 'おおお' }], { maxTurns: 10, tokenBudget: 3000 })
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(m[2]?.content).toBe('話しかけ11')
    const long = Array.from({ length: 9 }, (_, i) => `行${i}`).join('\n')
    const m2 = buildMessages('sys', [{ role: 'user', content: 'やっほー' }, { role: 'assistant', content: long }, { role: 'user', content: 'おおお' }], { maxTurns: 10, tokenBudget: 3000 })
    expect(m2[2]?.content).toBe('行0\n行1\n行2')
  })

  it('文脈に残す目印と、返答が、交互に並ぶ', () => {
    const history: ChatMessage[] = [{ role: 'user', content: HIDDEN_NOTE }, { role: 'assistant', content: 'ねえ、休憩しよう' }]
    const m = buildMessages('sys', [...history, { role: 'user', content: hiddenPrompt('x') }], { maxTurns: 10, tokenBudget: 3000 })
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })
})
