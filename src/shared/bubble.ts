// 機能 Mod「吹き出し拡張」の設定と、純粋なロジック(Electron・DOM に依存しない)。
// 吹き出し(キャラのセリフ・自分の入力)の、形・色・フォントを変える。キャラごとの上書き、感情・発言の内容による漫画のような変化も。
// 見た目は、CSS の変数と data 属性で表す(resolveBubbleStyle が返す)。形そのものは、style.css が data-shape ごとに描く。

import { z } from 'zod'

export const BUBBLE_ID = 'bubble-style'

export const BUBBLE_SHAPES = ['normal', 'round', 'square', 'cloud', 'comic', 'think'] as const
export type BubbleShape = (typeof BUBBLE_SHAPES)[number]
export const BUBBLE_SHAPE_LABEL: Record<BubbleShape, string> = {
  normal: 'ふつう',
  round: '丸い',
  square: '四角',
  cloud: 'ふわふわ',
  comic: 'ギザギザ(叫び)',
  think: '考え中(もこもこ)'
}

export const BUBBLE_FONTS = ['system', 'gothic', 'mincho', 'maru', 'hand', 'custom'] as const
export type BubbleFont = (typeof BUBBLE_FONTS)[number]
export const BUBBLE_FONT_LABEL: Record<BubbleFont, string> = {
  system: '標準',
  gothic: 'ゴシック',
  mincho: '明朝',
  maru: '丸ゴシック',
  hand: '手書き風(教科書体など)',
  custom: '自分で指定(パソコンに入っているフォントの名前)'
}

/** フォントのプリセット。パソコンに無いフォントは、次の候補に落ちる(同梱はしない) */
const FONT_STACKS: Record<Exclude<BubbleFont, 'custom'>, string> = {
  system: "system-ui, 'Hiragino Sans', 'Yu Gothic UI', sans-serif",
  gothic: "'Yu Gothic UI', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif",
  mincho: "'Yu Mincho', 'Hiragino Mincho ProN', 'MS PMincho', serif",
  maru: "'Hiragino Maru Gothic ProN', 'BIZ UDPGothic', 'Meiryo UI', sans-serif",
  hand: "'UD Digi Kyokasho N-R', 'UD デジタル 教科書体 N-R', 'Yu Kyokasho', 'HGP教科書体', 'Comic Sans MS', cursive"
}

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const clamp = (n: number, lo: number, hi: number): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)

/** 吹き出し 1 つ分(キャラ側・自分側)の色 */
const SideSchema = (bg: string, fg: string) => z.object({ bg: Color.catch(bg), fg: Color.catch(fg), border: Color.nullable().catch(null) })
export type BubbleSide = z.infer<ReturnType<typeof SideSchema>>

const FontNameSchema = z
  .string()
  .catch('')
  .transform((s) => s.trim().slice(0, 60))
  // フォント名に使える文字だけ(引用符・括弧・セミコロンなど、CSS を壊す文字は、捨てる)
  .transform((s) => s.replace(/[^\p{L}\p{N} _.-]/gu, ''))

/** 基本の見た目 */
const BaseShape = {
  shape: z.enum(BUBBLE_SHAPES).catch('normal'),
  userShape: z.enum(BUBBLE_SHAPES).catch('normal'),
  character: SideSchema('#ffffff', '#2a2a35').catch({ bg: '#ffffff', fg: '#2a2a35', border: null }),
  user: SideSchema('#cee0ff', '#2a2a35').catch({ bg: '#cee0ff', fg: '#2a2a35', border: null }),
  font: z.enum(BUBBLE_FONTS).catch('system'),
  customFont: FontNameSchema,
  /** 文字の大きさの倍率 */
  fontScale: z.number().catch(1).transform((n) => clamp(n, 0.7, 1.8)),
  /** 背景の濃さ(1 = 不透明) */
  opacity: z.number().catch(0.96).transform((n) => clamp(n, 0.3, 1))
}
export const BubbleBaseSchema = z.object(BaseShape)
export type BubbleBase = z.infer<typeof BubbleBaseSchema>

/** キャラごとの上書き(書いた項目だけ、基本に勝つ) */
export const BubbleOverrideSchema = z.object({
  // 不正な項目は、「上書きしない」(基本のまま)にする
  shape: z.enum(BUBBLE_SHAPES).optional().catch(undefined),
  userShape: z.enum(BUBBLE_SHAPES).optional().catch(undefined),
  character: z.object({ bg: Color.optional().catch(undefined), fg: Color.optional().catch(undefined), border: Color.nullable().optional().catch(undefined) }).optional().catch(undefined),
  user: z.object({ bg: Color.optional().catch(undefined), fg: Color.optional().catch(undefined), border: Color.nullable().optional().catch(undefined) }).optional().catch(undefined),
  font: z.enum(BUBBLE_FONTS).optional().catch(undefined),
  customFont: FontNameSchema.optional(),
  fontScale: z.number().optional().catch(undefined).transform((n) => (n === undefined ? undefined : clamp(n, 0.7, 1.8))),
  opacity: z.number().optional().catch(undefined).transform((n) => (n === undefined ? undefined : clamp(n, 0.3, 1)))
})
export type BubbleOverride = z.infer<typeof BubbleOverrideSchema>

/** 感情・発言の内容による、一時的な変化(書いた項目だけ) */
export const BubblePatchSchema = z.object({
  shape: z.enum(BUBBLE_SHAPES).optional(),
  bg: Color.optional(),
  fg: Color.optional(),
  border: Color.optional(),
  /** 文字の大きさの倍率(基本の倍率に掛ける) */
  scale: z.number().min(0.5).max(2).optional(),
  bold: z.boolean().optional(),
  /** ふるえる */
  shake: z.boolean().optional()
})
export type BubblePatch = z.infer<typeof BubblePatchSchema>

/** 感情の区分(AI が返す感情名を、まとめたもの) */
export const EMOTION_CATEGORIES = ['joy', 'love', 'shy', 'sad', 'angry', 'surprised'] as const
export type EmotionCategory = (typeof EMOTION_CATEGORIES)[number]
export const EMOTION_CATEGORY_LABEL: Record<EmotionCategory, string> = { joy: 'うれしい', love: '好き', shy: 'はずかしい', sad: 'かなしい', angry: 'おこっている', surprised: 'おどろき' }

const EMOTION_ALIASES: Record<string, EmotionCategory> = {
  joy: 'joy', happy: 'joy', excited: 'joy', proud: 'joy',
  love: 'love',
  shy: 'shy', embarrassed: 'shy',
  sad: 'sad', sleepy: 'sad',
  angry: 'angry',
  surprised: 'surprised', fear: 'surprised'
}

/** AI の感情名 → 区分(対応しなければ null。calm / neutral は、変えない) */
export function emotionCategory(name: string | null | undefined): EmotionCategory | null {
  if (!name) return null
  return EMOTION_ALIASES[name.trim().toLowerCase()] ?? null
}

export const DEFAULT_EMOTION_TABLE: Record<EmotionCategory, BubblePatch> = {
  joy: { shape: 'round', bg: '#fff0f5', border: '#ff8fb1', scale: 1.05 },
  love: { shape: 'round', bg: '#ffe3ee', border: '#ff5c8a', fg: '#9d2450' },
  shy: { shape: 'cloud', bg: '#fff5f5', fg: '#b0607a', scale: 0.9, shake: true },
  sad: { shape: 'think', bg: '#e6ecf5', fg: '#4a5a7a', scale: 0.92 },
  angry: { shape: 'comic', bg: '#ffe9e5', fg: '#b3141c', border: '#d9222a', scale: 1.12, bold: true },
  surprised: { shape: 'comic', bg: '#fffbe0', border: '#f0b400', scale: 1.1 }
}

/** 発言の内容の区分(叫び: 「!」が 2 つ以上 / 疑問: 「?」で終わる / 小声: 「…」で終わる) */
export const CONTENT_CATEGORIES = ['shout', 'question', 'faint'] as const
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number]
export const CONTENT_CATEGORY_LABEL: Record<ContentCategory, string> = { shout: '叫び(「!」が 2 つ以上)', question: '疑問(「?」で終わる)', faint: '小声(「…」で終わる)' }

export const DEFAULT_CONTENT_TABLE: Record<ContentCategory, BubblePatch> = {
  shout: { shape: 'comic', scale: 1.12, bold: true, border: '#444444' },
  question: { shape: 'round' },
  faint: { scale: 0.92, fg: '#7a8399' }
}

/** キーワードの規則: 発言に、どれかの語が含まれるとき、その見た目を当てる */
export const MAX_CONTENT_RULES = 20
export const MAX_RULE_WORDS = 8
export const MAX_WORD_LENGTH = 20
export const ContentRuleSchema = z.object({
  words: z
    .array(z.string())
    .transform((l) => l.map((w) => w.trim().slice(0, MAX_WORD_LENGTH)).filter((w) => w !== '').slice(0, MAX_RULE_WORDS)),
  patch: BubblePatchSchema.catch({})
})
export type ContentRule = z.infer<typeof ContentRuleSchema>

const ContentTableSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((raw) => {
    const out = {} as Record<ContentCategory, BubblePatch>
    for (const c of CONTENT_CATEGORIES) {
      const r = BubblePatchSchema.safeParse(raw[c])
      out[c] = r.success ? r.data : DEFAULT_CONTENT_TABLE[c]
    }
    return out
  })

const ContentRulesSchema = z
  .array(z.unknown())
  .catch([])
  .transform((list) => {
    const out: ContentRule[] = []
    for (const v of list) {
      const r = ContentRuleSchema.safeParse(v)
      if (r.success && r.data.words.length > 0) out.push(r.data)
      if (out.length >= MAX_CONTENT_RULES) break
    }
    return out
  })

const EmotionTableSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((raw) => {
    const out: Partial<Record<EmotionCategory, BubblePatch>> = {}
    for (const c of EMOTION_CATEGORIES) {
      const r = BubblePatchSchema.safeParse(raw[c])
      out[c] = r.success ? r.data : DEFAULT_EMOTION_TABLE[c]
    }
    return out as Record<EmotionCategory, BubblePatch>
  })

export const BubbleSchema = z.object({
  base: BubbleBaseSchema.catch(BubbleBaseSchema.parse({})),
  /** キャラ id → そのキャラだけの上書き。1 件が壊れていても、ほかを道連れにしない */
  byCharacter: z
    .record(z.string().max(80), z.unknown())
    .catch({})
    .transform((raw) => {
      const out: Record<string, BubbleOverride> = {}
      for (const [id, v] of Object.entries(raw)) {
        const r = BubbleOverrideSchema.safeParse(v)
        if (r.success) out[id] = r.data
      }
      return out
    }),
  /** 感情によって、吹き出しを変える(AI に感情タグを頼む。タグは、返答の最初に付くので、言い始めから変わる) */
  emotion: z.object({ enabled: z.boolean().catch(true), table: EmotionTableSchema }).catch({ enabled: true, table: DEFAULT_EMOTION_TABLE }),
  /** 発言の内容によって、吹き出しを変える: 区分の表(叫び・疑問・小声)と、キーワードの規則(語 → 見た目。上から順に、当てはまるものをすべて重ねる) */
  content: z
    .object({ enabled: z.boolean().catch(true), table: ContentTableSchema, rules: ContentRulesSchema })
    .catch({ enabled: true, table: DEFAULT_CONTENT_TABLE, rules: [] })
})
export type BubbleSettings = z.infer<typeof BubbleSchema>

/** 設定のうち、変えた項目だけ(保存の更新用)。base と byCharacter は、まるごと渡す */
export const BubblePatchInputSchema = z.object({
  base: z.unknown().optional(),
  byCharacter: z.unknown().optional(),
  emotion: z.unknown().optional(),
  content: z.unknown().optional()
})

export type BubblePatchInput = z.infer<typeof BubblePatchInputSchema>

export interface BubbleView extends BubbleSettings {
  /** Mod が ON か */
  enabled: boolean
}

// ------------------------------------------------------------ 見た目の決定
/** 発言の内容の区分。当てはまらなければ null */
export function contentCategory(text: string): ContentCategory | null {
  const t = text.trim()
  if (t === '') return null
  if ((t.match(/[!！]/g) ?? []).length >= 2) return 'shout'
  if (/[?？]\s*$/.test(t)) return 'question'
  if (/(…|\.{3}|。。。)\s*$/.test(t)) return 'faint'
  return null
}

/** 発言に含まれる語が当てはまる規則(上から順。大文字小文字は区別しない) */
export function matchContentRules(rules: readonly ContentRule[], text: string): ContentRule[] {
  const t = text.toLowerCase()
  return rules.filter((r) => r.words.some((w) => t.includes(w.toLowerCase())))
}

/** ギザギザ(吹き出しの縁)の clip-path の多角形。楕円の上に、外側と内側の点を、交互に並べる(百分率) */
export function burstPolygon(points = 18, inner = 0.86): string {
  const pts: string[] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 50 : 50 * inner
    const a = (Math.PI * i) / points
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)}% ${(50 + r * Math.sin(a)).toFixed(1)}%`)
  }
  return `polygon(${pts.join(', ')})`
}
const BURST = burstPolygon()

/** フォント指定 → font-family の値 */
export function fontFamily(font: BubbleFont, customFont: string): string {
  if (font === 'custom') {
    const name = customFont.trim()
    return name === '' ? FONT_STACKS.system : `"${name}", ${FONT_STACKS.system}`
  }
  return FONT_STACKS[font]
}

const rgba = (hex: string, alpha: number): string => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export interface ResolvedBubble {
  shape: BubbleShape
  /** 吹き出しの要素に、インラインで付ける CSS の変数 */
  css: Record<string, string>
  shake: boolean
  /** 変化の理由(確認用。感情の区分 / 発言の内容の区分 / null) */
  mood: string | null
}

export interface ResolveInput {
  settings: BubbleSettings
  characterId: string
  side: 'character' | 'user'
  /** AI が最後に返した感情名(キャラ側の吹き出しだけ) */
  emotion?: string | null
  /** 吹き出しの本文(キャラ側の吹き出しだけ。内容による変化に使う) */
  text?: string
}

/**
 * 吹き出しの見た目を決める。順序: 基本 → キャラごとの上書き → 発言の内容 → 感情(あとのものが勝つ)。
 * 感情・内容による変化は、キャラ側の吹き出しだけ(自分の入力は、変えない)。
 */
export function resolveBubbleStyle(input: ResolveInput): ResolvedBubble {
  const { settings, characterId, side } = input
  const o = settings.byCharacter[characterId]
  const base = settings.base
  const sideBase = base[side]
  const sideOver = o?.[side]
  let bg = sideOver?.bg ?? sideBase.bg
  let fg = sideOver?.fg ?? sideBase.fg
  let border: string | null = sideOver?.border !== undefined ? sideOver.border : sideBase.border
  let shape: BubbleShape = side === 'user' ? (o?.userShape ?? base.userShape) : (o?.shape ?? base.shape)
  const font = o?.font ?? base.font
  const customFont = o?.customFont ?? base.customFont
  let scale = o?.fontScale ?? base.fontScale
  const opacity = o?.opacity ?? base.opacity
  let bold = false
  let shake = false
  let mood: string | null = null

  const apply = (p: BubblePatch): void => {
    if (p.shape) shape = p.shape
    if (p.bg) bg = p.bg
    if (p.fg) fg = p.fg
    if (p.border) border = p.border
    if (p.scale) scale *= p.scale
    if (p.bold) bold = true
    if (p.shake) shake = true
  }
  if (side === 'character') {
    if (settings.content.enabled && input.text) {
      const content = contentCategory(input.text)
      if (content) {
        apply(settings.content.table[content])
        mood = content
      }
      for (const rule of matchContentRules(settings.content.rules, input.text)) {
        apply(rule.patch)
        mood = 'rule'
      }
    }
    const emotion = settings.emotion.enabled ? emotionCategory(input.emotion) : null
    if (emotion) {
      apply(settings.emotion.table[emotion])
      mood = emotion
    }
  }

  const css: Record<string, string> = {
    '--b-bg': rgba(bg, opacity),
    '--b-fg': fg,
    '--b-font': fontFamily(font, customFont),
    '--b-scale': String(Math.round(scale * 100) / 100),
    '--b-weight': bold ? '700' : '400'
  }
  if (border) css['--b-border'] = border
  if (shape === 'comic') css['--b-clip'] = BURST
  return { shape, css, shake, mood }
}

/** 既定の設定(吹き出し拡張を、まだ触っていないとき) */
export const DEFAULT_BUBBLE: BubbleSettings = BubbleSchema.parse({})
