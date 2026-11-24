// 動作確認用の疑似OpenAI互換サーバー(外部通信なし・127.0.0.1のみ)。実LLMなしで会話UIを確認する。
// 使い方: node scripts/fake-llm-server.mjs [ポート=18080]
// モデル名で挙動が変わる: "slow"=ゆっくり返す / "think"=<think>混じりで返す / "missing"=404 / "error"=ストリーム途中でエラー
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 18080)
const MODELS = ['fake', 'slow', 'think', 'error']
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) }))
    return
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let body = ''
    for await (const c of req) body += c
    const { model, messages } = JSON.parse(body)
    if (model === 'missing') {
      res.statusCode = 404
      res.end(JSON.stringify({ error: { message: `model '${model}' not found` } }))
      return
    }
    const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    console.log(`[fake-llm] model=${model} messages=${messages.length} system=${messages[0].role === 'system'} last="${last}"`)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const send = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
    send({ role: 'assistant', content: '' })
    const reply = `「${last}」だね。うん、ちゃんと聞こえているよ。今日はどんな一日だった？ゆっくり聞かせてね。`
    if (model === 'think') {
      send({ content: '<thi' })
      send({ content: 'nk>ユーザーは挨拶している。短く返そう。</th' })
      send({ content: 'ink>\n\n' })
    }
    const step = model === 'slow' ? 400 : 60
    for (let i = 0; i < reply.length; i += 3) {
      if (res.destroyed) return // クライアントが中断した
      if (model === 'error' && i > 12) {
        res.write(`data: ${JSON.stringify({ error: { message: 'fake server exploded' } })}\n\n`)
        break
      }
      send({ content: reply.slice(i, i + 3) })
      await wait(step)
    }
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }
  res.statusCode = 404
  res.end()
})
server.listen(port, '127.0.0.1', () => console.log(`[fake-llm] http://127.0.0.1:${port}/v1`))
