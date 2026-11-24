const { app, BrowserWindow, session, protocol, ipcMain, net } = require('electron')
const http = require('node:http')
const dns = require('node:dns').promises
const fs = require('node:fs')
const path = require('node:path')

const dgram = require('node:dgram')
const udpHits = []
const OUT = {}
const t0 = Date.now()
const hits = [] // テスト用サーバーに届いた要求(= 外に出られた証拠)

// ---- 攻撃先(本体の外のローカルサーバー。ここに届いたら「直接通信できた」) ----
const server = http.createServer((req, res) => {
  hits.push(req.url)
  if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/redirected' }); return res.end() }
  if (req.url === '/big') { res.writeHead(200); return res.end(Buffer.alloc(5 * 1024 * 1024)) }
  if (req.url === '/slow') { return setTimeout(() => res.end('late'), 4000) }
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
  res.end('ok')
})

// ---- host.http のゲート(本体側の実装案) ----
const LIMITS = { timeoutMs: 1500, maxBytes: 1024 * 1024 }
const isLoopback = (a) => a === '::1' || a.startsWith('127.') || a === '::ffff:127.0.0.1'
async function gateFetch(allowedOrigins, method, rawUrl) {
  let u
  try { u = new URL(rawUrl) } catch { return { ok: false, reason: 'bad-url' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'scheme' }
  if (!['GET', 'POST'].includes(method)) return { ok: false, reason: 'method' }
  if (!allowedOrigins.includes(u.origin)) return { ok: false, reason: 'origin-not-allowed' }   // 完全一致
  // 宣言が localhost / 127.0.0.1 の場合は、名前解決の結果もループバックであることを確認する
  const declaredLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (declaredLoopback) {
    const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => [])
    if (addrs.length === 0 || !addrs.every((a) => isLoopback(a.address))) return { ok: false, reason: 'not-loopback' }
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), LIMITS.timeoutMs)
  try {
    const res = await fetch(u, { method, redirect: 'manual', signal: ctl.signal })
    if (res.status >= 300 && res.status < 400) return { ok: false, reason: 'redirect-refused', status: res.status }
    const reader = res.body.getReader(); let size = 0
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > LIMITS.maxBytes) { ctl.abort(); return { ok: false, reason: 'too-big' } } }
    return { ok: true, status: res.status, bytes: size }
  } catch (e) { return { ok: false, reason: ctl.signal.aborted ? 'timeout' : 'error:' + e.message } } finally { clearTimeout(timer) }
}

const extWindows = new Map() // webContents.id → extension id(識別は main が窓から決める)
const pending = new Map(); let seq = 0
ipcMain.on('cmd-result', (_e, id, result) => pending.get(id)?.(result))
function command(win, cmd, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); resolve({ timeout: true }) }, timeoutMs)
    pending.set(id, (r) => { clearTimeout(timer); pending.delete(id); resolve(r) })
    win.webContents.send('cmd', id, cmd)
  })
}

let TARGET, allowed, UDP_PORT
ipcMain.handle('host:http', (e, { method, url }) => {
  const extId = extWindows.get(e.sender.id)
  if (!extId) return { ok: false, reason: 'unknown-sender' }
  return gateFetch(allowed, method, url)
})
ipcMain.handle('host:whoami', (e) => extWindows.get(e.sender.id) ?? null)

async function createExtWindow(id, opts = {}) {
  const partition = `ext-${id}`
  const ses = session.fromPartition(partition)
  // (1) 専用プロトコル: 拡張のファイルだけを返す(HTMLは本体が生成。拡張は持たない)
  const extDir = path.join(__dirname, 'ext')
  if (!ses.protocol.isProtocolHandled('vmaid-ext')) ses.protocol.handle('vmaid-ext', async (req) => {
    const u = new URL(req.url)
    if (u.hostname !== id) return new Response('forbidden', { status: 403 })
    if (u.pathname === '/__host.html') {
      return new Response(`<!doctype html><meta charset="utf-8"><script src="vmaid-ext://${id}/main.js"></script>`, {
        headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': `default-src 'none'; script-src vmaid-ext://${id}; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'` }
      })
    }
    const file = path.normalize(path.join(extDir, u.pathname))
    if (!file.startsWith(extDir + path.sep)) return new Response('forbidden', { status: 403 })
    try { return new Response(fs.readFileSync(file), { headers: { 'Content-Type': 'text/javascript' } }) } catch { return new Response('not found', { status: 404 }) }
  })
  // (2) 多重防御: このセッションからの本体プロトコル以外のネットワーク要求は、すべて遮断して記録する
  const blocked = []
  ses.webRequest.onBeforeRequest((details, cb) => {  // (同じ partition を作り直すと、前の handler を置き換える)
    if (details.url.startsWith('vmaid-ext://') || details.url.startsWith('devtools://')) return cb({})
    blocked.push(details.url); cb({ cancel: true })
  })
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition, preload: path.join(__dirname, 'preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      additionalArguments: [`--target=${TARGET}`, `--udp=${UDP_PORT}`, ...(opts.strip ? ['--strip-webrtc'] : [])], backgroundThrottling: false
    }
  })
  if (opts.webrtcPolicy) win.webContents.setWebRTCIPHandlingPolicy(opts.webrtcPolicy)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  extWindows.set(win.webContents.id, id)
  const tLoad = Date.now()
  await win.loadURL(`vmaid-ext://${id}/__host.html`)
  return { win, blocked, loadMs: Date.now() - tLoad }
}

const metrics = (label) => app.getAppMetrics().map((m) => ({ label, type: m.type, name: m.name, pid: m.pid, workingSetMB: Math.round(m.memory.workingSetSize / 1024), privateMB: Math.round((m.memory.privateBytes ?? 0) / 1024) }))

process.on('uncaughtException', (e) => { console.log('UNCAUGHT', e); app.exit(1) })
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e); app.exit(1) })
protocol.registerSchemesAsPrivileged([{ scheme: 'vmaid-ext', privileges: { standard: true, secure: true } }]) // ready 前に必要
console.log('poc start')
app.on('window-all-closed', () => {}) // 常駐アプリと同じ
app.whenReady().then(async () => {
  OUT.bootMs = Date.now() - t0
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  TARGET = `http://127.0.0.1:${server.address().port}`
  allowed = [TARGET]
  const udp = dgram.createSocket('udp4'); udp.on('message', (m, r) => udpHits.push(`${r.address}:${r.port} ${m.length}B`))
  await new Promise((r) => udp.bind(0, '127.0.0.1', r)); UDP_PORT = udp.address().port
  OUT.baseline = metrics('baseline(窓なし)')

  const t1 = Date.now()
  const { win, blocked, loadMs } = await createExtWindow('poc-ext')
  OUT.extStartupMs = Date.now() - t1
  OUT.extLoadMs = loadMs
  await new Promise((r) => setTimeout(r, 500))
  OUT.afterOne = metrics('拡張1つ')

  // (A) 直接通信の試み
  hits.length = 0
  OUT.attempts = await command(win, 'attempt')
  await new Promise((r) => setTimeout(r, 800))
  OUT.serverHitsFromDirectAttempts = [...hits]
  OUT.blockedByWebRequest = [...blocked]

  // (B) ホストAPI(main 代行)経由
  hits.length = 0
  OUT.viaHost = await command(win, 'host', 20000)
  OUT.serverHitsFromHost = [...hits]

  // (C) 識別: 別名乗りができない(whoami は main が窓から決める)
  // (D) 無限ループ: 本体が影響を受けず、窓を切り離せる
  const tl = Date.now()
  const loopPromise = command(win, 'loop', 2000)
  const mainAlive = await new Promise((r) => setTimeout(() => r(Date.now() - tl), 300)) // main のタイマーが回るか
  OUT.loop = { mainTimerDelayMs: mainAlive - 300, result: await loopPromise }
  win.destroy()
  await new Promise((r) => setTimeout(r, 300))
  OUT.afterDestroy = metrics('拡張を破棄後')
  // 再起動できる
  const t2 = Date.now()
  const again = await createExtWindow('poc-ext')
  OUT.restart = { ms: Date.now() - t2, ping: await command(again.win, 'ping') }
  // (E) WebRTC(CSPの対象外): 条件ごとに窓を作り直して、UDP(STUN)が外に出るかを見る
  OUT.webrtc = {}
  for (const [name, opts] of [['default', {}], ['policy:disable_non_proxied_udp', { webrtcPolicy: 'disable_non_proxied_udp' }], ['stripped-by-preload', { strip: true }], ['stripped+policy', { strip: true, webrtcPolicy: 'disable_non_proxied_udp' }]]) {
    await new Promise((r) => setTimeout(r, 1500))
    udpHits.length = 0
    const w = await createExtWindow('poc-rtc-' + name.replace(/[^a-z]/g, ''), opts)
    const result = await command(w.win, 'webrtc')
    OUT.webrtc[name] = { result, udpPacketsReceived: udpHits.length }
    w.win.destroy()
  }
  // (F) 接続時の名前解決チェック(DNSリバインディング対策): http.request の lookup で、ループバック以外を接続前に拒否
  const guarded = (host, fakeAddr) => new Promise((resolve) => {
    const req = http.request({ host, port: 9, path: '/', method: 'GET', timeout: 1000,
      lookup: (h, o, cb) => { const a = fakeAddr ?? '127.0.0.1'; if (!isLoopback(a)) return cb(new Error('not-loopback:' + a)); o && o.all ? cb(null, [{ address: a, family: 4 }]) : cb(null, a, 4) } },
      () => resolve('connected')); req.on('error', (e) => resolve(e.message)); req.end()
  })
  OUT.rebinding = { rebindName_to_10_0_0_1: await guarded('rebind.test', '10.0.0.1'), localhost_loopback: await guarded('localhost') }
  // 5つ同時のときのメモリ
  const many = []
  for (let i = 0; i < 4; i++) many.push(await createExtWindow(`poc-ext-${i}`))
  await new Promise((r) => setTimeout(r, 500))
  OUT.afterFive = metrics('拡張5つ')
  fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify(OUT, null, 2))
  app.quit()
})
