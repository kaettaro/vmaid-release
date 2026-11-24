import { describe, expect, it } from 'vitest'
import { BubbleSchema, burstPolygon, contentCategory, DEFAULT_BUBBLE, emotionCategory, fontFamily, resolveBubbleStyle, type BubbleSettings } from './bubble'

const settings = (raw: unknown = {}): BubbleSettings => BubbleSchema.parse(raw)
const style = (s: BubbleSettings, extra: { emotion?: string | null; text?: string; side?: 'character' | 'user'; characterId?: string } = {}) =>
  resolveBubbleStyle({ settings: s, characterId: extra.characterId ?? 'c1', side: extra.side ?? 'character', emotion: extra.emotion, text: extra.text })

describe('吹き出しの設定の読み込み', () => {
  it('何も無いとき・壊れているときは、いまの見た目(白・水色・ふつうの形・標準のフォント)', () => {
    for (const raw of [{}, null, { base: 5, emotion: 3, byCharacter: [] }]) {
      const s = BubbleSchema.parse(raw ?? {})
      expect(s.base.shape).toBe('normal')
      expect(s.base.character.bg).toBe('#ffffff')
      expect(s.base.user.bg).toBe('#cee0ff')
      expect(s.base.font).toBe('system')
    }
    expect(DEFAULT_BUBBLE.emotion.enabled).toBe(true)
  })

  it('不正な色・範囲外の値は、既定・範囲内に直す。キャラごとの上書きは、1 件が壊れていても、ほかが残る', () => {
    const s = settings({
      base: { character: { bg: 'red', fg: '#112233' }, fontScale: 99, opacity: -1, shape: 'ない形' },
      byCharacter: { ok: { shape: 'cloud' }, bad: { shape: 'ない形' } }
    })
    expect(s.base.character).toEqual({ bg: '#ffffff', fg: '#112233', border: null }) // 不正な項目だけ、既定に戻る
    expect(s.base.fontScale).toBe(1.8)
    expect(s.base.opacity).toBe(0.3)
    expect(s.base.shape).toBe('normal')
    expect(s.byCharacter.ok.shape).toBe('cloud')
    expect(s.byCharacter.bad?.shape).toBeUndefined() // 不正な項目は「上書きしない」
  })

  it('フォント名は、CSS を壊す文字(引用符・括弧・セミコロンなど)を捨てて、60 文字までにする', () => {
    const s = settings({ base: { font: 'custom', customFont: 'My"Font; } body {x' } })
    expect(s.base.customFont).toBe('MyFont  body x')
    expect(fontFamily('custom', 'Yu Gothic UI')).toBe('"Yu Gothic UI", system-ui, \'Hiragino Sans\', \'Yu Gothic UI\', sans-serif')
    expect(fontFamily('custom', '')).toContain('system-ui')
    expect(settings({ base: { customFont: 'a'.repeat(100) } }).base.customFont).toHaveLength(60)
  })
})

describe('見た目の決定', () => {
  it('初期設定では、いまの見た目と同じ(キャラ側は白・濃いグレーの文字、自分側は水色)', () => {
    const c = style(settings())
    expect(c.shape).toBe('normal')
    expect(c.css['--b-bg']).toBe('rgba(255, 255, 255, 0.96)')
    expect(c.css['--b-fg']).toBe('#2a2a35')
    expect(c.css['--b-scale']).toBe('1')
    expect(style(settings(), { side: 'user' }).css['--b-bg']).toBe('rgba(206, 224, 255, 0.96)')
  })

  it('キャラごとの上書きは、基本に勝つ(書いた項目だけ)。ほかのキャラには、効かない', () => {
    const s = settings({ base: { shape: 'round' }, byCharacter: { c1: { shape: 'square', character: { bg: '#112233' } } } })
    expect(style(s).shape).toBe('square')
    expect(style(s).css['--b-bg']).toContain('17, 34, 51')
    expect(style(s).css['--b-fg']).toBe('#2a2a35') // 書いていない項目は、基本のまま
    expect(style(s, { characterId: 'c2' }).shape).toBe('round')
  })

  it('感情: 別名を区分にまとめて、その見た目にする。calm・不明は、変えない。オフなら、変えない', () => {
    expect(emotionCategory('Happy')).toBe('joy')
    expect(emotionCategory('embarrassed')).toBe('shy')
    expect(emotionCategory('fear')).toBe('surprised')
    expect(emotionCategory('calm')).toBeNull()
    expect(emotionCategory(null)).toBeNull()
    const s = settings()
    const angry = style(s, { emotion: 'angry', text: 'もう!' })
    expect(angry.shape).toBe('comic')
    expect(angry.css['--b-weight']).toBe('700')
    expect(angry.css['--b-scale']).toBe('1.12')
    expect(angry.css['--b-clip']).toContain('polygon(')
    expect(angry.mood).toBe('angry')
    expect(style(s, { emotion: 'calm' }).shape).toBe('normal')
    expect(style(settings({ emotion: { enabled: false } }), { emotion: 'angry' }).shape).toBe('normal')
    expect(style(s, { emotion: 'shy' }).shake).toBe(true)
  })

  it('感情の表は、設定で書き換えられる(壊れた項目は、既定に戻る)', () => {
    const s = settings({ emotion: { enabled: true, table: { joy: { shape: 'cloud', bg: '#00ff00' }, sad: { shape: 'ない形' } } } })
    expect(style(s, { emotion: 'joy' }).shape).toBe('cloud')
    expect(style(s, { emotion: 'sad' }).css['--b-bg']).toContain('230, 236, 245') // sad の既定
  })

  it('発言の内容: 「!」が 2 つ以上は叫び、「?」で終わるのは丸く、「…」で終わるのは小声。感情が優先', () => {
    expect(contentCategory('やったー!!')).toBe('shout')
    expect(contentCategory('すごい！！！')).toBe('shout')
    expect(contentCategory('これなに?')).toBe('question')
    expect(contentCategory('えっと…')).toBe('faint')
    expect(contentCategory('ふつうの文。')).toBeNull()
    expect(contentCategory('')).toBeNull()
    const s = settings()
    expect(style(s, { text: 'わあ!!' }).shape).toBe('comic')
    expect(style(s, { text: 'ええと…' }).css['--b-scale']).toBe('0.92')
    // 内容と感情の両方があれば、感情が勝つ
    expect(style(s, { text: 'わあ!!', emotion: 'sad' }).shape).toBe('think') // sad は「考え中」の形(感情が勝つ)
    expect(style(s, { text: 'わあ!!', emotion: 'calm' }).shape).toBe('comic') // 感情が当てはまらなければ、内容の形が残る
    expect(style(s, { text: 'わあ!!', emotion: 'joy' }).shape).toBe('round')
    expect(style(settings({ content: { enabled: false } }), { text: 'わあ!!' }).shape).toBe('normal')
  })

  it('内容の表は、設定で書き換えられる(壊れた項目は、既定に戻る)', () => {
    const s = settings({ content: { enabled: true, table: { shout: { shape: 'cloud', bg: '#00ff00' }, question: { shape: 'ない形' } } } })
    expect(style(s, { text: 'わあ!!' }).shape).toBe('cloud')
    expect(style(s, { text: 'なに?' }).shape).toBe('round') // 既定
  })

  it('キーワードの規則: 語が含まれると見た目を当てる。上から順に重なり、感情が最後に勝つ。壊れた規則は捨て、20 件まで', () => {
    const s = settings({
      content: {
        enabled: true,
        rules: [
          { words: ['ありがとう', 'Thanks'], patch: { shape: 'cloud', bg: '#ffeecc' } },
          { words: ['ありがとう'], patch: { fg: '#112233' } },
          { words: [], patch: { shape: 'comic' } },
          { words: ['x'], patch: { shape: 'ない形' } },
          'こわれた'
        ]
      }
    })
    expect(s.content.rules).toHaveLength(3) // 語が空の規則・文字列は捨てる(patch が不正な規則は、空の patch で残る)
    const r = style(s, { text: 'ありがとう、THANKS' })
    expect(r.shape).toBe('cloud')
    expect(r.css['--b-fg']).toBe('#112233')
    expect(r.css['--b-bg']).toContain('255, 238, 204')
    expect(r.mood).toBe('rule')
    expect(style(s, { text: 'べつの言葉' }).shape).toBe('normal')
    expect(style(s, { text: 'ありがとう', emotion: 'angry' }).shape).toBe('comic') // 感情が勝つ
    // 自分の吹き出しには、効かない
    expect(style(s, { side: 'user', text: 'ありがとう' }).shape).toBe('normal')
    const many = settings({ content: { rules: Array.from({ length: 40 }, (_, i) => ({ words: [`w${i}`], patch: {} })) } })
    expect(many.content.rules).toHaveLength(20)
    expect(settings({ content: { rules: [{ words: Array.from({ length: 20 }, (_, i) => `word${i}`), patch: {} }] } }).content.rules[0]?.words).toHaveLength(8)
  })

  it('自分の吹き出しは、感情・内容では変わらない。自分用の形は、別に決められる', () => {
    const s = settings({ base: { userShape: 'square' } })
    const u = style(s, { side: 'user', emotion: 'angry', text: 'わあ!!' })
    expect(u.shape).toBe('square')
    expect(u.mood).toBeNull()
  })

  it('背景の濃さは、背景色だけに効く。文字の大きさの倍率は、基本の倍率に、変化の倍率が掛かる', () => {
    const s = settings({ base: { opacity: 0.5, fontScale: 1.5 } })
    expect(style(s).css['--b-bg']).toBe('rgba(255, 255, 255, 0.5)')
    expect(style(s, { emotion: 'sad' }).css['--b-scale']).toBe('1.38') // 1.5 × 0.92
  })

  it('ギザギザの縁: 外側と内側の点が交互に並び、すべて 0〜100% に収まる', () => {
    const p = burstPolygon(10)
    const nums = [...p.matchAll(/([\d.]+)%/g)].map((m) => Number(m[1]))
    expect(nums).toHaveLength(10 * 2 * 2)
    expect(nums.every((n) => n >= 0 && n <= 100)).toBe(true)
  })
})
