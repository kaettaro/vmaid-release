import { describe, expect, it } from 'vitest'
import { PrefetchQueue } from './prefetchQueue'
import { prepareForSpeech } from './prepare'
import { SentenceSplitter } from './sentences'
import {
  applyVoiceParams,
  audioQueryUrl,
  isLoopbackEndpoint,
  looksLikeWav,
  normalizeTtsEndpoint,
  parseSpeakers,
  synthesisUrl
} from './voicevox'

const feed = (chunks: string[]): string[] => {
  const sp = new SentenceSplitter()
  return [...chunks.flatMap((c) => sp.push(c)), ...sp.flush()]
}

describe('SentenceSplitter(文の区切り)', () => {
  it('断片が小さくても、文の終わりで区切る', () => {
    expect(feed(['こん', 'にちは。', '今日は', 'いい天気', 'だね!', 'また']).join('|')).toBe('こんにちは。|今日はいい天気だね!|また')
  })
  it('終わりの直後の閉じ括弧・記号は、同じ文に含める(断片が別でも)', () => {
    expect(feed(['「いいよ。', '」と言った。'])).toEqual(['「いいよ。」', 'と言った。'])
    expect(feed(['すごい!!', 'ね'])).toEqual(['すごい!!', 'ね'])
  })
  it('改行でも区切る。空の文は出さない', () => {
    expect(feed(['一つ目\n\n二つ目\n'])).toEqual(['一つ目', '二つ目'])
  })
  it('小数点のピリオドでは区切らない', () => {
    expect(feed(['円周率は3.14です。'])).toEqual(['円周率は3.14です。'])
  })
  it('区切りのない長い文は、読点で区切る。それも無ければ、上限で切る', () => {
    const long = `${'あ'.repeat(40)}、${'い'.repeat(40)}`
    const out = feed([long])
    expect(out).toHaveLength(2)
    expect(out.join('')).toBe(long)
    const noComma = 'う'.repeat(300)
    const out2 = feed([noComma])
    expect(out2.every((s) => s.length <= 120)).toBe(true)
    expect(out2.join('')).toBe(noComma)
  })
  it('flush で残りが出る。reset で捨てる', () => {
    const sp = new SentenceSplitter()
    expect(sp.push('途中まで')).toEqual([])
    expect(sp.flush()).toEqual(['途中まで'])
    sp.push('捨てる')
    sp.reset()
    expect(sp.flush()).toEqual([])
  })
})

describe('prepareForSpeech(読み上げ用の整形)', () => {
  it('URL・コード・括弧書き・絵文字・装飾記号を除く', () => {
    expect(prepareForSpeech('これは https://example.com です(笑)')).toBe('これは です')
    expect(prepareForSpeech('**大事**だよ★')).toBe('大事だよ')
    expect(prepareForSpeech('`code`を使って😀ね')).toBe('を使ってね')
    expect(prepareForSpeech('えっと……そうだね')).toBe('えっと…そうだね')
  })
  it('読める文字が残らなければ空文字。長すぎれば切る', () => {
    expect(prepareForSpeech('★★★ ~~ ♪')).toBe('')
    expect(prepareForSpeech('😀')).toBe('')
    expect(prepareForSpeech('あ'.repeat(500), 50)).toHaveLength(50)
  })
})

describe('VOICEVOX の要求', () => {
  it('接続先を正規化する(パス・末尾スラッシュを除く)。不正な形は null', () => {
    expect(normalizeTtsEndpoint(' http://127.0.0.1:50021/ ')).toBe('http://127.0.0.1:50021')
    expect(normalizeTtsEndpoint('http://localhost:50021/audio_query?x=1')).toBe('http://localhost:50021')
    expect(normalizeTtsEndpoint('ftp://x')).toBeNull()
    expect(normalizeTtsEndpoint('http://user:pw@localhost')).toBeNull()
    expect(normalizeTtsEndpoint('')).toBeNull()
    expect(normalizeTtsEndpoint('not a url')).toBeNull()
  })
  it('ループバックかどうか(localhost 以外は警告するため)', () => {
    expect(isLoopbackEndpoint('http://127.0.0.1:50021')).toBe(true)
    expect(isLoopbackEndpoint('http://localhost:50021')).toBe(true)
    expect(isLoopbackEndpoint('http://[::1]:50021')).toBe(true)
    expect(isLoopbackEndpoint('http://localhost.evil.example')).toBe(false)
    expect(isLoopbackEndpoint('http://192.168.0.5:50021')).toBe(false)
    expect(isLoopbackEndpoint('x')).toBe(false)
  })
  it('URL: 日本語・記号を含む文でも、クエリとして正しくエンコードされる', () => {
    const u = new URL(audioQueryUrl('http://127.0.0.1:50021', 'こんにちは&speaker=9', 3))
    expect(u.pathname).toBe('/audio_query')
    expect(u.searchParams.get('text')).toBe('こんにちは&speaker=9')
    expect(u.searchParams.get('speaker')).toBe('3')
    expect(synthesisUrl('http://127.0.0.1:50021', 3)).toBe('http://127.0.0.1:50021/synthesis?speaker=3')
  })
  it('声の調整を、範囲内に収めてクエリへ反映する。他の項目は変えない', () => {
    const q = applyVoiceParams({ accent_phrases: [1], speedScale: 1 }, { speed: 9, pitch: -5 }, 0.5)!
    expect(q).toMatchObject({ accent_phrases: [1], speedScale: 2, pitchScale: -0.15, volumeScale: 0.5 })
    expect(applyVoiceParams('x', { speed: 1, pitch: 0 })).toBeNull()
    expect(applyVoiceParams([1], { speed: 1, pitch: 0 })).toBeNull()
  })
  it('/speakers から声の一覧を作る。形の違う要素は読み飛ばす', () => {
    const list = parseSpeakers([
      { name: 'A', styles: [{ id: 1, name: 'ノーマル' }, { id: 2, name: 'あまあま' }, { id: 'x', name: '不正' }] },
      { name: 5, styles: [] },
      null,
      { name: 'B', styles: 'x' }
    ])
    expect(list).toEqual([
      { id: 1, label: 'A(ノーマル)' },
      { id: 2, label: 'A(あまあま)' }
    ])
    expect(parseSpeakers({})).toEqual([])
  })
  it('WAV の簡易検査', () => {
    const wav = new Uint8Array(44)
    wav.set([0x52, 0x49, 0x46, 0x46], 0)
    wav.set([0x57, 0x41, 0x56, 0x45], 8)
    expect(looksLikeWav(wav)).toBe(true)
    expect(looksLikeWav(new Uint8Array(10))).toBe(false)
    expect(looksLikeWav(new Uint8Array(44))).toBe(false)
  })
})

// 偽の合成・再生: 完了を手動で進められる
function harness(opts: { ahead?: number; maxPending?: number } = {}) {
  const log: string[] = []
  const synthPending = new Map<string, () => void>()
  const playPending = new Map<string, () => void>()
  const busy: boolean[] = []
  const errors: string[] = []
  const q = new PrefetchQueue<string>({
    ...opts,
    synth: (text, signal) =>
      new Promise((resolve, reject) => {
        log.push(`synth:${text}`)
        synthPending.set(text, () => (text.startsWith('bad') ? reject(new Error('x')) : resolve(`audio-${text}`)))
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    play: (audio, signal) =>
      new Promise((resolve) => {
        log.push(`play:${audio}`)
        playPending.set(audio, resolve)
        signal.addEventListener('abort', () => resolve())
      }),
    onError: (_e, text) => errors.push(text),
    onBusyChange: (b) => busy.push(b)
  })
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  return { q, log, synthPending, playPending, busy, errors, tick }
}

describe('PrefetchQueue(読み上げのキュー)', () => {
  it('順番に再生しながら、次の文を先に合成する。全部終わると、忙しくない状態に戻る', async () => {
    const h = harness()
    h.q.enqueue('a')
    h.q.enqueue('b')
    await h.tick()
    expect(h.log).toEqual(['synth:a', 'synth:b']) // 再生前に、次の合成も始まっている
    h.synthPending.get('a')!()
    await h.tick()
    expect(h.log).toContain('play:audio-a')
    expect(h.log).not.toContain('play:audio-b') // a の再生が終わるまで b は再生しない
    h.synthPending.get('b')!()
    h.playPending.get('audio-a')!()
    await h.tick()
    expect(h.log.at(-1)).toBe('play:audio-b')
    h.playPending.get('audio-b')!()
    await h.tick()
    expect(h.busy).toEqual([true, false])
    expect(h.q.isBusy).toBe(false)
  })
  it('合成に失敗した文は飛ばして、続きを再生する', async () => {
    const h = harness()
    h.q.enqueue('bad1')
    h.q.enqueue('ok')
    await h.tick()
    h.synthPending.get('bad1')!()
    h.synthPending.get('ok')!()
    await h.tick()
    expect(h.errors).toEqual(['bad1'])
    expect(h.log).toContain('play:audio-ok')
  })
  it('cancel で、待ち行列・合成・再生が止まり、あとから届く結果は再生されない。続けて新しい文を積める', async () => {
    const h = harness()
    h.q.enqueue('a')
    h.q.enqueue('b')
    await h.tick()
    h.q.cancel()
    await h.tick()
    h.synthPending.get('a')?.() // 遅れて届いても
    await h.tick()
    expect(h.log.filter((l) => l.startsWith('play:'))).toEqual([])
    expect(h.errors).toEqual([]) // 中断による失敗は、エラー扱いにしない
    expect(h.q.isBusy).toBe(false)
    h.q.enqueue('c')
    await h.tick()
    h.synthPending.get('c')!()
    await h.tick()
    expect(h.log).toContain('play:audio-c')
  })
  it('待ち行列の上限を超えたら、古い文を捨てる。空の文は積まない', async () => {
    const h = harness({ maxPending: 2, ahead: 0 })
    h.q.enqueue('  ')
    h.q.enqueue('a')
    h.q.enqueue('b')
    h.q.enqueue('c')
    await h.tick()
    expect(h.log.filter((l) => l.startsWith('synth:'))).not.toContain('synth:c')
    h.synthPending.get('a')?.()
    await h.tick()
    h.playPending.get('audio-a')?.()
    await h.tick()
    h.synthPending.get('b')?.()
    await h.tick()
    // a は上限で捨てられている: 先頭は b
    expect(h.log.some((l) => l === 'play:audio-a')).toBe(false)
  })
})
