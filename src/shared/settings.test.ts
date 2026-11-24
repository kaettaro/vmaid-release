import { describe, expect, it } from 'vitest'
import { defaultSettings, parseSettings } from './settings'

describe('parseSettings', () => {
  it('空でも既定値が入る', () => {
    const s = defaultSettings()
    expect(s.display).toEqual({ scale: 1, clickThrough: true, alwaysOnTop: true, showOnStartup: true, resetShortcut: 'CommandOrControl+Alt+Shift+R', previewInWindow: false, confirmReset: true })
    expect(s.window).toEqual({ x: null, y: null })
    expect(s.characters).toHaveLength(1)
    expect(s.characters[0].modelPath).toBeNull()
    expect(s.activeCharacterId).toBe(s.characters[0].id)
    expect(s.motion).toEqual({ library: [], maxImportFiles: 0, idle: 'idle', footLock: false })
  })
  it('llm / character は既定値(Ollamaの既定URL・既定のキャラ設定)で始まる', () => {
    const s = defaultSettings()
    expect(s.llm).toEqual({
      backend: 'builtin',
      builtin: { modelId: null, customPath: null },
      baseUrl: 'http://localhost:11434/v1',
      model: '',
      apiKeyEnc: null,
      maxTurns: 10
    })
    expect(s.characters[0].name).toBe('ユメ')
    expect(s.characters[0].systemPrompt).not.toBe('')
  })
  it('履歴の保存は既定でオン。不正な値は既定に戻し、オフは尊重する', () => {
    expect(defaultSettings().history.enabled).toBe(true)
    expect(parseSettings({ history: { enabled: 'no' } }).history.enabled).toBe(true)
    expect(parseSettings({ history: { enabled: false } }).history.enabled).toBe(false)
  })
  it('llm の不正な値は項目ごとに既定値へ戻す', () => {
    const s = parseSettings({ llm: { backend: 'cloud', model: 5, maxTurns: 999, baseUrl: 'http://x/v1' } })
    expect(s.llm.backend).toBe('builtin')
    expect(s.llm.model).toBe('')
    expect(s.llm.maxTurns).toBe(10)
    expect(s.llm.baseUrl).toBe('http://x/v1')
  })
  it('保存済みの方式(openai)は尊重し、builtin の不正値は既定に戻す', () => {
    expect(parseSettings({ llm: { backend: 'openai' } }).llm.backend).toBe('openai')
    expect(parseSettings({ llm: { builtin: { modelId: 5, customPath: ['x'] } } }).llm.builtin).toEqual({ modelId: null, customPath: null })
    expect(parseSettings({ llm: { builtin: { modelId: 'a', customPath: '/m.gguf' } } }).llm.builtin).toEqual({ modelId: 'a', customPath: '/m.gguf' })
  })
  it('motion の不正な値は既定値に戻す', () => {
    expect(parseSettings({ motion: { library: 'x', idle: 5 } }).motion).toEqual({ library: [], maxImportFiles: 0, idle: 'idle', footLock: false })
    // 「待機なし」を明示した null は保持する
    expect(parseSettings({ motion: { idle: null } }).motion.idle).toBeNull()
    const ok = { library: [{ name: 'a', path: '/a.vrma' }], maxImportFiles: 500, idle: 'a', footLock: true }
    expect(parseSettings({ motion: ok }).motion).toEqual(ok)
    // 取り込み上限: 不正な値は 0(無制限)に戻す
    for (const bad of [-1, 1.5, 'x', null, 2_000_000]) expect(parseSettings({ motion: { maxImportFiles: bad } }).motion.maxImportFiles).toBe(0)
    // library は、壊れた1件だけを捨てる(全件が消えない)
    const mixed = parseSettings({ motion: { library: [{ name: 'a', path: '/a' }, 5, { name: 'b' }, { name: '', path: '/c' }, { name: 'd', path: '/d' }] } }).motion.library
    expect(mixed).toEqual([{ name: 'a', path: '/a' }, { name: 'd', path: '/d' }])
    expect(parseSettings({ motion: { footLock: 'x' } }).motion.footLock).toBe(false)
  })
  it('null や配列など不正な入力でも既定値', () => {
    expect(parseSettings(null)).toEqual(defaultSettings())
    expect(parseSettings('x')).toEqual(defaultSettings())
    expect(parseSettings([])).toEqual(defaultSettings())
  })
  it('正しい値は保持し、不正な項目だけ既定値に戻す', () => {
    const s = parseSettings({
      display: { scale: 2, clickThrough: 'yes', alwaysOnTop: false },
      window: { x: 10, y: 1.5 }
    })
    expect(s.display.scale).toBe(2)
    expect(s.display.clickThrough).toBe(true)
    expect(s.display.alwaysOnTop).toBe(false)
    expect(s.window).toEqual({ x: 10, y: null })
  })
  it('範囲外の倍率は丸める', () => {
    expect(parseSettings({ display: { scale: 100 } }).display.scale).toBe(3)
  })
  it('未知の項目は無視する', () => {
    expect(parseSettings({ future: { a: 1 } })).toEqual(defaultSettings())
  })
})

describe('キャラクターの設定(旧設定からの移行)', () => {
  it('古い設定(character + model.lastPath)は、キャラ1人(id default)に移行する', () => {
    const s = parseSettings({
      character: { name: 'ミオ', tone: '元気なタメ口', systemPrompt: '明るい', userCallName: '先輩' },
      model: { lastPath: '/m/mio.vrm' }
    })
    expect(s.characters).toEqual([
      {
        id: 'default',
        name: 'ミオ',
        modelPath: '/m/mio.vrm',
        tone: '元気なタメ口',
        systemPrompt: '明るい',
        userCallName: '先輩',
        voice: { speaker: null, systemVoice: null, speed: 1, pitch: 0 }
      }
    ])
    expect(s.activeCharacterId).toBe('default')
  })
  it('characters があれば、古い項目は無視する。不正な要素・IDの重複は捨て、activeCharacterId が無効なら先頭にする', () => {
    const s = parseSettings({
      character: { name: '旧' },
      characters: [{ id: 'a', name: 'A', modelPath: '/a.vrm' }, 5, { id: 'a', name: '重複' }, { id: 'b', name: 'B' }],
      activeCharacterId: 'zzz'
    })
    expect(s.characters.map((c) => c.id)).toEqual(['a', 'b'])
    expect(s.characters[0].name).toBe('A')
    expect(s.characters[1].modelPath).toBeNull()
    expect(s.activeCharacterId).toBe('a')
    expect(parseSettings({ characters: [{ id: 'b', name: 'B' }], activeCharacterId: 'b' }).activeCharacterId).toBe('b')
  })
  it('一覧が空・壊れていても、既定のキャラが1人入る', () => {
    expect(parseSettings({ characters: [] }).characters).toHaveLength(1)
    expect(parseSettings({ characters: 'x' }).characters).toHaveLength(1)
    expect(parseSettings({ characters: [null, 3] }).characters).toHaveLength(1)
  })
})

describe('音声合成の設定', () => {
  it('既定はオフ・OSの音声。接続先・音量は、不正な値を既定へ戻し、範囲外は丸める', () => {
    expect(defaultSettings().tts).toEqual({ enabled: false, backend: 'system', endpoint: 'http://127.0.0.1:50021', volume: 1, speakSay: true, autoStart: false, enginePath: null })
    const t = parseSettings({ tts: { enabled: true, backend: 'voicevox', endpoint: 'http://localhost:50021/x/', volume: 9, speakSay: 'x' } }).tts
    expect(t).toEqual({ enabled: true, backend: 'voicevox', endpoint: 'http://localhost:50021', volume: 1, speakSay: true, autoStart: false, enginePath: null })
    expect(parseSettings({ tts: { backend: 'cloud', endpoint: 'ftp://x', volume: -1 } }).tts).toMatchObject({ backend: 'system', endpoint: 'http://127.0.0.1:50021', volume: 0 })
    expect(parseSettings({ tts: 'x' }).tts.enabled).toBe(false)
  })
  it('キャラごとの声: 古い設定(声なし)は既定になり、範囲外・不正な値は丸める/既定に戻す', () => {
    expect(parseSettings({}).characters[0].voice).toEqual({ speaker: null, systemVoice: null, speed: 1, pitch: 0 })
    const v = parseSettings({ characters: [{ id: 'a', voice: { speaker: 3, systemVoice: 'Kyoko', speed: 9, pitch: 'x' } }] }).characters[0].voice
    expect(v).toEqual({ speaker: 3, systemVoice: 'Kyoko', speed: 2, pitch: 0 })
    expect(parseSettings({ characters: [{ id: 'a', voice: { speaker: -1 } }] }).characters[0].voice.speaker).toBeNull()
    expect(parseSettings({ characters: [{ id: 'a', voice: 5 }] }).characters[0].voice).toEqual({ speaker: null, systemVoice: null, speed: 1, pitch: 0 })
  })
})


describe('機能 Mod の統合', () => {
  it('保存済みの「VMD インポーター」(vmd-import)は、「MMD 対応」(mmd)として読む。重複しない', () => {
    expect(parseSettings({ mods: { features: ['vmd-import', 'foot-lock'] } }).mods.features).toEqual(['mmd', 'foot-lock'])
    expect(parseSettings({ mods: { features: ['mmd', 'vmd-import'] } }).mods.features).toEqual(['mmd'])
    expect(parseSettings({ mods: { features: ['music'] } }).mods.features).toEqual(['se'])
  })
})
