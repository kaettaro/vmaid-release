// 拡張のコード(サンドボックスの中で動く側)。直接ネットワークに出られるか、あらゆる経路で試す。
const report = {}
const rec = (name, ok, detail) => { report[name] = { escaped: ok, detail: String(detail ?? '').slice(0, 120) } }
const TARGET = globalThis.__TARGET // preload から渡される「攻撃先」(テスト用のローカルサーバー)
async function attempts() {
  try { const r = await fetch(TARGET + '/fetch'); rec('fetch', true, r.status) } catch (e) { rec('fetch', false, e.message) }
  try {
    await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', TARGET + '/xhr'); x.onload = res; x.onerror = () => rej(new Error('xhr error')); x.send() })
    rec('xhr', true)
  } catch (e) { rec('xhr', false, e.message) }
  try {
    await new Promise((res, rej) => { const w = new WebSocket(TARGET.replace('http', 'ws') + '/ws'); w.onopen = res; w.onerror = () => rej(new Error('ws error')); setTimeout(() => rej(new Error('ws timeout')), 1500) })
    rec('websocket', true)
  } catch (e) { rec('websocket', false, e.message) }
  try { rec('sendBeacon', navigator.sendBeacon(TARGET + '/beacon', 'x'), 'returned') } catch (e) { rec('sendBeacon', false, e.message) }
  try {
    await new Promise((res, rej) => { const i = new Image(); i.onload = res; i.onerror = () => rej(new Error('img error')); i.src = TARGET + '/img' })
    rec('img', true)
  } catch (e) { rec('img', false, e.message) }
  try { const s = document.createElement('script'); s.src = TARGET + '/script.js'; await new Promise((res, rej) => { s.onload = res; s.onerror = () => rej(new Error('script error')); document.head.appendChild(s) }); rec('script-tag', true) } catch (e) { rec('script-tag', false, e.message) }
  try { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = TARGET + '/css'; await new Promise((res, rej) => { l.onload = res; l.onerror = () => rej(new Error('css error')); document.head.appendChild(l) }); rec('css-link', true) } catch (e) { rec('css-link', false, e.message) }
  try { const f = document.createElement('iframe'); f.src = TARGET + '/iframe'; document.body.appendChild(f); await new Promise((r) => setTimeout(r, 600)); rec('iframe', 'unknown(see main log)', 'appended') } catch (e) { rec('iframe', false, e.message) }
  try { const w = window.open(TARGET + '/open'); rec('window.open', !!w, w ? 'opened' : 'null') } catch (e) { rec('window.open', false, e.message) }
  try { eval('1+1'); rec('eval', true) } catch (e) { rec('eval', false, e.message) }
  try { new Function('return 1')(); rec('new Function', true) } catch (e) { rec('new Function', false, e.message) }
  try { await import(TARGET + '/mod.js'); rec('dynamic import', true) } catch (e) { rec('dynamic import', false, e.message) }
  try { const w = new Worker(TARGET + '/w.js'); rec('worker(remote)', true, 'created') } catch (e) { rec('worker(remote)', false, e.message) }
  try { typeof require; rec('require available', typeof require !== 'undefined') } catch { rec('require available', false) }
  try { rec('process available', typeof process !== 'undefined') } catch { rec('process available', false) }
  try { rec('electron api', typeof globalThis.electron !== 'undefined' || typeof globalThis.ipcRenderer !== 'undefined') } catch { rec('electron api', false) }
  try { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:1' }] }); pc.createDataChannel('x'); rec('RTCPeerConnection', true, 'constructed') } catch (e) { rec('RTCPeerConnection', false, e.message) }
  return report
}
// ホストAPI: preload が公開した host.* だけが外との出入口
async function viaHost() {
  const out = {}
  out.http_allowed = await host.http('GET', TARGET + '/ok')
  out.http_otherPort = await host.http('GET', 'http://127.0.0.1:1/ok')
  out.http_redirect = await host.http('GET', TARGET + '/redirect')
  out.http_big = await host.http('GET', TARGET + '/big')
  out.http_evilname = await host.http('GET', 'http://localhost.evil.example:1/ok')
  out.http_badscheme = await host.http('GET', 'file:///etc/hosts')
  out.http_slow = await host.http('GET', TARGET + '/slow')
  out.http_prefix = await host.http('GET', TARGET + '.evil.example/ok')
  out.identity = await host.whoami()
  return out
}
host.onCommand(async (cmd) => {
  if (cmd === 'attempt') return await attempts()
  if (cmd === 'host') return await viaHost()
  if (cmd === 'webrtc') {
    const out = {}
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:' + globalThis.__UDP }] })
      pc.createDataChannel('x')
      await pc.setLocalDescription(await pc.createOffer())
      await new Promise((r) => setTimeout(r, 2000))
      out.constructed = true
    } catch (e) { out.constructed = false; out.error = e.message }
    return out
  }
  if (cmd === 'loop') { const t = Date.now(); while (Date.now() - t < 60000) {} return 'unreachable' }
  if (cmd === 'ping') return 'pong'
  return 'unknown'
})
