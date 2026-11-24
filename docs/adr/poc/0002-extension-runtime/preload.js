// 拡張ウィンドウ用 preload: 許可リスト方式。ipcRenderer そのものは公開しない
const { contextBridge, ipcRenderer, webFrame } = require('electron')
// WebRTC は CSP の対象外(UDPが出る)ので、拡張のコードが動く前に、メインワールドから消す(試験)
if (process.argv.includes('--strip-webrtc')) {
  webFrame.executeJavaScript(`for (const k of ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','RTCSessionDescription','mediaDevices']) { try { delete window[k] } catch {} } try { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }) } catch {}`)
}
const listeners = []
ipcRenderer.on('cmd', async (_e, id, cmd) => {
  let result
  try { result = await listeners[0]?.(cmd) } catch (e) { result = { error: String(e) } }
  ipcRenderer.send('cmd-result', id, result)
})
contextBridge.exposeInMainWorld('host', {
  http: (method, url) => ipcRenderer.invoke('host:http', { method, url }),
  whoami: () => ipcRenderer.invoke('host:whoami'),
  onCommand: (fn) => listeners.push(fn)
})
contextBridge.exposeInMainWorld('__TARGET', process.argv.find((a) => a.startsWith('--target='))?.slice(9))
contextBridge.exposeInMainWorld('__UDP', process.argv.find((a) => a.startsWith('--udp='))?.slice(6))
