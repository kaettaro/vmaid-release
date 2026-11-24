// 動作確認用の疑似 VOICEVOX 互換サーバー(外部通信なし・127.0.0.1のみ)。実エンジンなしで、読み上げ・リップシンクを確認する。
// 使い方: node scripts/fake-tts-server.mjs [ポート=50021]
// 合成する音は、文字数に比例した長さの「ぷ・ぷ・ぷ」という音の連なり(口の開閉が見えるよう、音節ごとに音量が上下する)。
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 50021)
const SAMPLE_RATE = 24000

function wav(text, speed) {
  const syllables = Math.max(1, [...text].length)
  const secPerSyllable = 0.16 / Math.max(0.5, speed)
  const total = syllables * secPerSyllable
  const n = Math.floor(total * SAMPLE_RATE)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SAMPLE_RATE, 24); buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    const phase = (t % secPerSyllable) / secPerSyllable // 音節の中の位置
    const env = Math.sin(Math.PI * phase) ** 2 // 音節ごとに、小→大→小
    const v = Math.sin(2 * Math.PI * 220 * t) * 0.5 * env
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c).toString('utf8') }

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.method === 'GET' && url.pathname === '/version') return json(200, 'fake-0.0.1')
  if (req.method === 'GET' && url.pathname === '/speakers') {
    return json(200, [
      { name: 'テスト子', styles: [{ id: 1, name: 'ノーマル' }, { id: 2, name: 'あまあま' }] },
      { name: 'テスト太', styles: [{ id: 3, name: 'ノーマル' }] }
    ])
  }
  if (req.method === 'POST' && url.pathname === '/audio_query') {
    const text = url.searchParams.get('text') ?? ''
    console.log(`audio_query speaker=${url.searchParams.get('speaker')} text=${JSON.stringify(text)}`)
    return json(200, { accent_phrases: [], speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1, outputSamplingRate: SAMPLE_RATE, _text: text })
  }
  if (req.method === 'POST' && url.pathname === '/synthesis') {
    const q = JSON.parse(await readBody(req))
    console.log(`synthesis speaker=${url.searchParams.get('speaker')} speed=${q.speedScale} pitch=${q.pitchScale} volume=${q.volumeScale}`)
    await new Promise((r) => setTimeout(r, Number(process.env.FAKE_TTS_DELAY_MS ?? 150))) // 合成にかかる時間のつもり
    const body = wav(q._text ?? '', q.speedScale ?? 1)
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': body.length })
    return res.end(body)
  }
  json(404, { detail: 'Not Found' })
}).listen(port, '127.0.0.1', () => console.log(`fake VOICEVOX listening on http://127.0.0.1:${port}`))
