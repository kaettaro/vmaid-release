/* global host, setTimeout */
// モーション生成 Mod(text-to-vrma 連携)のスクリプト。ADR 0001。
// サンドボックスの中で動き、ホスト API(host.*)だけを使う。通信は host.http.fetch(宣言した通信先だけ)。
//
// 送るリクエストは、必ず「完全ローカル」になる固定の値にする(外部への通信が起きないように):
//   engine: 'ardy' / planner: 'none' / use_jev: false / format: 'vrma'
// (text-to-vrma は、省略すると、外部の AI(OpenAI など)や Jev へ送る設定になりうるため。ユーザーが変えられるのは、接続先・トークン・待ち時間だけ)

const MAX_PROMPT = 500
/** 同時に生成するのは1件。待たせるのは、最大3件まで */
const MAX_WAITING = 3
/** 生成の開始と開始の間隔(連続して、GPU・サーバーを埋めないように) */
const COOLDOWN_MS = 10_000
/** 作った動きを残す数(これを超えたら、古いものから、一覧から外す。1つの Mod が追加できる上限 50 より少なく) */
const MAX_KEEP = 40
/** 覚えさせられるポーズの数(合言葉つき。覚えたポーズの動きは、上の MAX_KEEP で外されない) */
const MAX_POSES = 30
/** ポーズ名の長さ */
const MAX_POSE_NAME = 20

/** 状況を、ルールのトリガーで知らせる(状態表示の窓などが受ける。権限 emit が無い・古い環境では、何もしない) */
const notify = (name) => {
  try {
    if (host.rules && host.rules.emit) host.rules.emit(name)
  } catch {
    // 通知の失敗は、生成には影響させない
  }
}

const queue = []
let running = false
let lastStart = 0

/** 説明を整える(前後の空白・連続した空白を、1つに) */
const normalize = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** 簡単なハッシュ(キャッシュのキー用。FNV-1a) */
function hash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** text-to-vrma のエラー応答({ error: { message, code } })や、通信の失敗を、短い日本語にする */
function explain(r) {
  if (!r.ok) {
    if (r.reason === 'origin-not-allowed') return '接続先が、この Mod が宣言した通信先と違います(設定の「接続先」を確認してください)'
    if (r.reason === 'timeout') return '生成が間に合わず、タイムアウトしました(設定の待ち時間を延ばせます)'
    if (r.reason === 'too-big') return '返ってきたデータが大きすぎます'
    if (r.reason === 'no-permission') return '通信の権限がありません'
    return 'text-to-vrma に接続できません(起動していますか?)'
  }
  let code = ''
  try {
    code = JSON.parse(r.text).error?.code ?? ''
  } catch {
    // JSON ではない応答
  }
  if (code === 'ardy_unavailable') return 'text-to-vrma の ARDY エンジンが起動していません'
  if (code === 'unauthorized') return 'トークンが違います(設定の「トークン」を確認してください)'
  if (code === 'invalid_prompt') return '動きの説明を受け付けてもらえませんでした(長さ・内容を確認してください)'
  if (code === 'provider_not_configured') return 'text-to-vrma 側の生成の設定が済んでいません'
  return `生成に失敗しました(HTTP ${r.status}${code ? ` / ${code}` : ''})`
}

async function readIndex() {
  const v = await host.storage.get('index')
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

async function readPoses() {
  const v = await host.storage.get('poses')
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

/** 名前の照合用(空白・かぎ括弧・句読点を除く) */
const squash = (s) => String(s ?? '').replace(/[\s「」『』“”"'、。,.!?!?~〜…]/g, '')

/** 「ポーズを覚えて「万歳」両手を上げて喜ぶ」のような入力から、ポーズ名と内容の指示を取り出す。取れなければ null */
function parseDefine(message) {
  const m = /[「『“"]([^」』”"]{1,40})[」』”"]\s*([\s\S]*)$/.exec(String(message ?? ''))
  if (!m) return null
  const name = normalize(m[1])
  const prompt = normalize(m[2])
  return name === '' || prompt === '' ? null : { name, prompt }
}

/** 1件を生成する。再生はしない(動きの名前を返す。失敗したら null) */
async function generate(prompt, durationSec, quiet) {
  const key = hash(`${prompt.toLowerCase()}|${durationSec ?? ''}`)
  const index = await readIndex()
  // キャッシュ: 同じ説明・長さは、通信せず、前に作ったものを、すぐ再生する
  if (index[key]) {
    host.log('info', `キャッシュを使います: ${index[key].name}`)
    notify('cached')
    return index[key].name
  }

  const endpoint = String((await host.settings.get('endpoint')) || '').replace(/\/+$/, '')
  const token = await host.settings.get('token')
  const timeoutSec = Number(await host.settings.get('timeoutSec')) || 300
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const body = JSON.stringify({
    prompt,
    engine: 'ardy',
    planner: 'none',
    use_jev: false,
    format: 'vrma',
    ...(durationSec ? { duration: durationSec } : {})
  })

  if (!quiet) host.say('考え中…(動きを作っています)') // 自動の反応(quiet)は、黙って作る
  notify('generating')
  const r = await host.http.fetch(`${endpoint}/v1/motions`, { method: 'POST', headers, body, timeoutMs: timeoutSec * 1000 })
  if (!r.ok || r.status !== 200 || !/gltf-binary|octet-stream/i.test(r.contentType ?? '')) {
    host.log('warn', `生成できませんでした: ${r.ok ? `HTTP ${r.status}` : r.reason}`)
    notify('failed')
    if (!quiet) host.say(explain(r))
    return null
  }

  const name = await host.motion.add(`gen-${prompt.slice(0, 8)}-${key.slice(0, 4)}`, r.bytes)
  if (!name) {
    notify('failed')
    if (!quiet) host.say('生成された動きを、VRMA として読み込めませんでした')
    return null
  }
  index[key] = { name, at: Date.now() }
  // 古いものを、一覧から外す(合言葉を付けて覚えたポーズの動きは、外さない)
  const keep = new Set(Object.values(await readPoses()).map((x) => x.name))
  const keys = Object.keys(index)
    .filter((k) => !keep.has(index[k].name))
    .sort((a, b) => index[a].at - index[b].at)
  let over = Object.keys(index).length - MAX_KEEP
  while (over > 0 && keys.length > 0) {
    const old = keys.shift()
    await host.motion.remove(index[old].name)
    delete index[old]
    over--
  }
  await host.storage.set('index', index)
  notify('generated')
  return name
}

/** 動きを作って、覚える(合言葉 = ポーズ名)。作れたら、再生して、見せる。覚えるのは、これだけ */
async function learnPose(poseName, prompt, durationSec) {
  const name = await generate(prompt, durationSec)
  if (!name) return
  const poses = await readPoses()
  poses[poseName] = { name, at: Date.now() }
  await host.storage.set('poses', poses)
  host.say(`「${poseName}」を覚えました。「${poseName}をとって」と言うと、すぐとります`)
  host.motion.play(name)
}

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.length > 0) {
      const wait = lastStart + COOLDOWN_MS - Date.now()
      if (wait > 0) await new Promise((res) => setTimeout(res, wait))
      const job = queue.shift()
      lastStart = Date.now()
      try {
        if (job.poseName) await learnPose(job.poseName, job.prompt, job.durationSec)
        else {
          const name = await generate(job.prompt, job.durationSec, job.quiet)
          if (name) host.motion.play(name)
        }
      } catch (e) {
        host.log('error', String(e))
        host.say('生成中に、問題が起きました')
      }
    }
  } finally {
    running = false
  }
}

// ------------------------------------------------------------ 入口(役割ごとに、分ける)
/** 動きの説明を、生成の待ちに入れる。poseName があれば、できた動きを、その名前で覚える(無ければ、覚えない)。入れられなければ、理由を言う */
function enqueue(prompt, durationSec, poseName, quiet) {
  if (quiet && (prompt === '' || [...prompt].length > MAX_PROMPT || queue.length >= 1)) return // 自動の反応は、空・長すぎ・混んでいるときは、黙ってやめる
  if (prompt === '') return host.say('動きの説明が空です。「ポーズをとって: 手を振る」のように入力してください')
  if ([...prompt].length > MAX_PROMPT) return host.say(`動きの説明が長すぎます(${MAX_PROMPT}文字まで)`)
  if (queue.length >= MAX_WAITING) return host.say('生成待ちがいっぱいです。少し待ってから、もう一度お願いします')
  const d = Number(durationSec)
  queue.push({ prompt, durationSec: Number.isFinite(d) && d > 0 ? d : undefined, ...(poseName ? { poseName } : {}), ...(quiet ? { quiet: true } : {}) })
  void pump()
}

/**
 * 「とって」: 覚えない。(1) 覚えているポーズの名前が入っていれば、それを再生する(通信しない)
 * (2) 「ポーズをとって: 両手を上げる」なら、その説明で、動きを作って、再生する(覚えない)
 */
async function takePose(message, rest, durationSec) {
  const text = String(message ?? '')
  if (text.includes('ポーズを覚えて')) return // 「覚えて」の入力は、覚える側で扱う
  const poses = await readPoses()
  const flat = squash(text)
  const hit = Object.keys(poses)
    .filter((n) => squash(n) !== '' && flat.includes(squash(n)))
    .sort((a, b) => squash(b).length - squash(a).length)[0]
  if (hit) return void host.motion.play(poses[hit].name)
  if (text.includes('ポーズをとって')) {
    const prompt = normalize(rest)
    if (prompt !== '') return enqueue(prompt, durationSec)
    const names = Object.keys(poses)
    return host.say(`「ポーズをとって: 両手を上げる」のように、動きを書いてください${names.length > 0 ? `。覚えているポーズ: ${names.slice(0, 10).join('、')}` : ''}`)
  }
  // 「写真をとって」などの、ふつうの会話には、何も言わない(AI が、ふつうに答える)
}

/** 「覚えて」: 「ポーズを覚えて「万歳」両手を上げて喜ぶ」→ 動きを作って、「万歳」という名前で、覚える */
async function learn(message, durationSec) {
  const d = parseDefine(message)
  if (!d) return host.say('「ポーズを覚えて「万歳」両手を上げて喜ぶ」のように、ポーズ名を「」で囲んで、そのあとに動きの説明を書いてください')
  if ([...d.name].length > MAX_POSE_NAME) return host.say(`ポーズ名が長すぎます(${MAX_POSE_NAME}文字まで)`)
  const poses = await readPoses()
  if (!(d.name in poses) && Object.keys(poses).length >= MAX_POSES) return host.say(`覚えられるポーズは ${MAX_POSES} 個までです(同じ名前なら、上書きできます)`)
  enqueue(d.prompt, durationSec, d.name)
}

host.onAction((action, params) => {
  if (action === 'takePose') return void takePose(params.message, params.rest, params.durationSec)
  if (action === 'learnPose') return void learn(params.message, params.durationSec)
  if (action !== 'generateMotion') return
  enqueue(normalize(params.prompt), params.durationSec, undefined, params.quiet === true)
})
