import { contextBridge, ipcRenderer, webFrame } from 'electron'

// スクリプト Mod の窓(非表示・サンドボックス)専用の preload。ADR 0002。
// スクリプトに見せるのは、`host` だけ(許可リスト方式)。ipcRenderer・Node の API は出さない。
// どの Mod の窓か・何の権限があるかは、main が窓(webContents.id)から決める。ここで名乗った id は信用されない。

// WebRTC は CSP の対象外で、UDP が外に出る(ADR 0002 §3.2)。スクリプトが動く前に、メインワールドから消す
// (main 側でも、WebRTC のポリシー `disable_non_proxied_udp` を設定している。両方で守る)
void webFrame.executeJavaScript(
  `for (const k of ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','RTCSessionDescription','RTCIceCandidate','mediaDevices']) { try { delete window[k] } catch {} }
   try { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }) } catch {}`
)

type ActionHandler = (action: string, params: unknown) => unknown
let handler: ActionHandler | null = null
// スクリプトが onAction を登録する前に届いたアクションは、ためておいて、登録されたら渡す
const queue: Array<{ action: string; params: unknown }> = []

function deliver(msg: { action: string; params: unknown }): void {
  if (!handler) {
    queue.push(msg)
    return
  }
  try {
    void Promise.resolve(handler(msg.action, msg.params)).catch((e) => ipcRenderer.send('scriptmod:log', 'error', String(e)))
  } catch (e) {
    ipcRenderer.send('scriptmod:log', 'error', String(e))
  }
}
ipcRenderer.on('scriptmod:action', (_e, msg: { action: string; params: unknown }) => deliver(msg))

// 一覧窓の操作(利用者が項目を選んだ)。登録される前に届いたものは、ためておく
type UiHandler = (event: { type: string; id: string }) => unknown
let uiHandler: UiHandler | null = null
const uiQueue: Array<{ type: string; id: string }> = []
function deliverUi(ev: { type: string; id: string }): void {
  if (!uiHandler) {
    uiQueue.push(ev)
    return
  }
  try {
    void Promise.resolve(uiHandler(ev)).catch((e) => ipcRenderer.send('scriptmod:log', 'error', String(e)))
  } catch (e) {
    ipcRenderer.send('scriptmod:log', 'error', String(e))
  }
}
ipcRenderer.on('scriptmod:ui-event', (_e, ev: { type: string; id: string }) => deliverUi(ev))

const decoder = new TextDecoder('utf-8')

contextBridge.exposeInMainWorld('host', {
  /** ログ(設定画面の Mod の詳細で見られる) */
  log: (level: string, message: unknown) => ipcRenderer.send('scriptmod:log', String(level).slice(0, 10), String(message).slice(0, 2000)),
  /** ルールのアクションを受け取る。fn(アクション名, パラメータ) */
  onAction: (fn: ActionHandler) => {
    handler = fn
    while (queue.length > 0) deliver(queue.shift() as { action: string; params: unknown })
  },
  http: {
    /** main が代行して通信する。宣言して承認された接続先(オリジン完全一致)だけ。{ ok, status, text, bytes } か { ok: false, reason } */
    fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) => {
      const r = (await ipcRenderer.invoke('scriptmod:http', { url, method: init?.method ?? 'GET', headers: init?.headers, body: init?.body, timeoutMs: init?.timeoutMs })) as
        | { ok: true; status: number; contentType: string; body: Uint8Array }
        | { ok: false; reason: string }
      return r.ok ? { ok: true, status: r.status, contentType: r.contentType, bytes: r.body, text: decoder.decode(r.body) } : r
    }
  },
  settings: {
    /** 利用者が「Mod」タブで入れた設定の値(型つき。未設定なら、宣言の既定値か null) */
    get: (name: string) => ipcRenderer.invoke('scriptmod:settings-get', name)
  },
  storage: {
    get: (key: string) => ipcRenderer.invoke('scriptmod:storage-get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('scriptmod:storage-set', key, value)
  },
  motion: {
    /** 検査済みの VRMA だけ、一覧に足す。名前は <Mod の id>/<name> になる。足した名前を返す(失敗なら null) */
    add: (name: string, vrma: Uint8Array) => ipcRenderer.invoke('scriptmod:motion-add', name, vrma),
    play: (name: string) => ipcRenderer.send('scriptmod:motion-play', name),
    /** 自分が足したものだけ消せる */
    remove: (name: string) => ipcRenderer.invoke('scriptmod:motion-remove', name)
  },
  ui: {
    list: {
      /** 一覧の窓に出す一覧を、丸ごと渡す(権限 ui.list)。{ title, empty, icons: { 名前: data: 画像 }, items: [{ id, title, subtitle, icon(icons の名前), link(https), unread }] }。アプリが検査して整える */
      set: (list: unknown) => {
        let text: string | undefined
        try {
          text = JSON.stringify(list)
        } catch {
          return
        }
        if (text !== undefined && text.length <= 600_000) ipcRenderer.send('scriptmod:ui-list-set', JSON.parse(text))
      }
    },
    /** 一覧窓の操作を受け取る。fn({ type: 'select', id }) */
    onEvent: (fn: UiHandler) => {
      uiHandler = fn
      while (uiQueue.length > 0) deliverUi(uiQueue.shift() as { type: string; id: string })
    }
  },
  say: (text: string) => ipcRenderer.send('scriptmod:say', String(text).slice(0, 500)),
  ai: {
    /** 設定している AI に、指示を送り、返答だけを、キャラのセリフとして出す(権限 ai。30 秒に 1 回まで。会話中などは、何もしない)。save: 返答を、会話の文脈に残す(既定 true) */
    say: (instruction: string, opts?: { save?: boolean }) => ipcRenderer.send('scriptmod:ai-say', String(instruction).slice(0, 2000), opts?.save !== false)
  },
  context: {
    /** 会話に足す「最近の話題」(権限 context。600 文字まで。空・null で消す)。参考情報として扱われる */
    set: (text: string | null) => ipcRenderer.send('scriptmod:context-set', text === null ? '' : String(text).slice(0, 2000))
  },
  rules: {
    /** ルールのトリガー(この Mod が宣言したもの)を起こす */
    emit: (name: string) => ipcRenderer.send('scriptmod:emit', String(name).slice(0, 60))
  }
})
