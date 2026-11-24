/* global host, setTimeout */
// 状態表示ウィンドウ Mod のスクリプト。ルールから届く出来事(note)をもとに、一覧の窓(host.ui.list)に、状態を出す。
// 窓の中身は、「文字だけ」(ホストが検査して描く)。通信はしない。履歴と回数は、この Mod 専用の保存領域に、少しだけ残す。

const MAX_LOG = 12
/** 動きの指定のあと、この時間(ミリ秒)のうちに、生成も再利用も始まらなければ、「見送り」とみなす */
const SKIP_AFTER_MS = 3500
/** 返答の完了が来ないまま、考え中が続いたときに、あきらめる時間(中断された返答などで、表示が残らないように) */
const CHAT_GIVE_UP_MS = 180_000
const GEN_GIVE_UP_MS = 15 * 60_000

const state = {
  chat: null, // { since, user }
  gen: null, // { since, pose }
  pending: null, // { text, at, resolved }
  replyHadPose: false,
  lastReply: '',
  lastGen: '',
  tick: null
}
let stat = { replies: 0, withPose: 0, log: [] } // 保存するもの
let loaded = false

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return [...t].length > n ? `${[...t].slice(0, n).join('')}…` : t
}
const hhmmss = (at) => new Date(at).toTimeString().slice(0, 8)
const secs = (since) => Math.max(0, Math.round((Date.now() - since) / 1000))

async function load() {
  if (loaded) return
  loaded = true
  const v = await host.storage.get('stat')
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    stat = {
      replies: Number(v.replies) || 0,
      withPose: Number(v.withPose) || 0,
      log: Array.isArray(v.log) ? v.log.filter((x) => x && typeof x.text === 'string' && Number.isFinite(x.at)).slice(0, MAX_LOG) : []
    }
  }
}

async function save() {
  await host.storage.set('stat', stat)
}

function addLog(text) {
  stat.log.unshift({ at: Date.now(), text: clip(text, 120) })
  if (stat.log.length > MAX_LOG) stat.log.length = MAX_LOG
}

/** 窓に出す一覧を作って、渡す */
function render() {
  if (!host.ui || !host.ui.list) return
  const now = Date.now()
  // 古い「考え中」「生成中」が残らないように
  if (state.chat && now - state.chat.since > CHAT_GIVE_UP_MS) state.chat = null
  if (state.gen && now - state.gen.since > GEN_GIVE_UP_MS) state.gen = null
  const rate = stat.replies > 0 ? `${Math.round((stat.withPose / stat.replies) * 100)}%` : '-'
  const items = [
    {
      id: 'chat',
      title: state.chat ? `会話: 考え中… ${secs(state.chat.since)}秒` : '会話: 待機中',
      subtitle: state.chat ? (state.chat.user ? `あなた: ${clip(state.chat.user, 40)}` : '(裏の指示)') : state.lastReply ? `直近の返答: ${clip(state.lastReply, 40)}` : '',
      unread: state.chat !== null
    },
    {
      id: 'gen',
      title: state.gen ? `モーション: 生成中… ${secs(state.gen.since)}秒` : 'モーション: 待機中',
      subtitle: state.gen ? clip(state.gen.pose || '(説明は、この窓には伝わっていません)', 40) : state.lastGen,
      unread: state.gen !== null
    },
    { id: 'stat', title: `ポーズ指定: 返答 ${stat.replies} 回中 ${stat.withPose} 回(${rate})`, subtitle: '低いと、AI が [pose:…] を付けず、動きは作られません', unread: false },
    ...stat.log.map((e, i) => ({ id: `log-${e.at}-${i}`, title: e.text, subtitle: hhmmss(e.at), unread: false }))
  ]
  host.ui.list.set({ title: '状態', empty: 'まだ何も起きていません', icons: {}, items })
}

/** 考え中・生成中の間は、1 秒ごとに、経過秒を更新する */
function schedule() {
  if (state.tick || (!state.chat && !state.gen)) return
  state.tick = setTimeout(() => {
    state.tick = null
    render()
    schedule()
  }, 1000)
}

/** 動きの指定のあと、生成も再利用も始まらなかったら、「見送り」と書く */
function watchSkip(p) {
  setTimeout(async () => {
    if (state.pending !== p || p.resolved) return
    state.pending = null
    addLog(`見送り: ${clip(p.text, 30)}(確率・間隔・「モーション生成」Mod が OFF のどれか)`)
    await save()
    render()
  }, SKIP_AFTER_MS)
}

async function note(kind, text) {
  await load()
  const t = clip(text, 100)
  switch (kind) {
    case 'user':
      state.chat = { since: Date.now(), user: t }
      state.replyHadPose = false
      break
    case 'reply':
      state.chat = null
      stat.replies += 1
      if (state.replyHadPose) stat.withPose += 1
      else addLog('動きの指定なし(AI が [pose:…] を付けなかった)')
      state.lastReply = t
      addLog(`返答: ${clip(t, 40)}`)
      break
    case 'pose': {
      state.replyHadPose = true
      const p = { text: t, at: Date.now(), resolved: false }
      state.pending = p
      addLog(`AI が動きを指定: ${clip(t, 40)}`)
      watchSkip(p)
      break
    }
    case 'genStart':
      state.gen = { since: Date.now(), pose: state.pending ? state.pending.text : '' }
      if (state.pending) state.pending.resolved = true
      break
    case 'genCached': {
      const what = state.pending ? state.pending.text : ''
      if (state.pending) state.pending.resolved = true
      state.lastGen = `前の動きを使った: ${clip(what, 30)}`
      addLog(`作らずに、前の動きを再生${what ? `: ${clip(what, 30)}` : ''}`)
      break
    }
    case 'genDone': {
      const g = state.gen
      state.gen = null
      state.lastGen = `生成完了${g ? ` ${secs(g.since)}秒` : ''}: ${clip(g ? g.pose : '', 30)}`
      addLog(`動きを生成しました${g ? `(${secs(g.since)}秒)` : ''}${g && g.pose ? `: ${clip(g.pose, 30)}` : ''}`)
      break
    }
    case 'genFail': {
      const g = state.gen
      state.gen = null
      state.lastGen = '生成に失敗'
      addLog(`動きの生成に失敗${g && g.pose ? `: ${clip(g.pose, 30)}` : ''}`)
      break
    }
    default:
      return
  }
  await save()
  render()
  schedule()
}

host.onAction((action, params) => {
  if (action !== 'note') return
  const kind = String(params && params.kind)
  note(kind, params && params.text).catch((e) => host.log('error', String(e)))
})

// 窓を開いたとき(スクリプトが起きたとき)にも、保存してある状態を出す
load()
  .then(() => render())
  .catch((e) => host.log('error', String(e)))
