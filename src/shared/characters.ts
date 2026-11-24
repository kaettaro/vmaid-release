import { z } from 'zod'
import { DEFAULT_CHARACTER } from './llm/prompt'
import { clamp, defaultVoice, VOICE_LIMITS } from './tts/voicevox'

// キャラクター(モデルのファイル + 人格)の保存・切り替えの純粋ロジック。Electron 非依存。
// 設定ファイルには characters(一覧)と activeCharacterId(いま使っているキャラ)を持つ。

/** 旧設定(キャラ1人 + 最後に開いたモデル)から移行したキャラのID */
export const DEFAULT_CHARACTER_ID = 'default'

/** キャラごとの声(音声合成をオンにしたときだけ使う)。壊れた項目は既定へ戻し、範囲外は丸める */
export const VoiceSchema = z.preprocess(
  (v) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}),
  z.object({
    speaker: z.number().int().min(0).max(1_000_000).nullable().catch(null),
    systemVoice: z.string().max(200).nullable().catch(null),
    speed: z.number().catch(VOICE_LIMITS.speed.default).transform((n) => clamp(n, VOICE_LIMITS.speed.min, VOICE_LIMITS.speed.max)),
    pitch: z.number().catch(VOICE_LIMITS.pitch.default).transform((n) => clamp(n, VOICE_LIMITS.pitch.min, VOICE_LIMITS.pitch.max))
  })
)

export const CharacterSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().catch(DEFAULT_CHARACTER.name),
  /** このキャラのモデル(VRM)のパス。未設定なら null */
  modelPath: z.string().nullable().catch(null),
  systemPrompt: z.string().catch(DEFAULT_CHARACTER.systemPrompt),
  tone: z.string().catch(DEFAULT_CHARACTER.tone),
  userCallName: z.string().catch(DEFAULT_CHARACTER.userCallName),
  voice: VoiceSchema
})

export type Character = z.infer<typeof CharacterSchema>

export function defaultCharacter(id = DEFAULT_CHARACTER_ID, modelPath: string | null = null): Character {
  return { id, modelPath, ...DEFAULT_CHARACTER, voice: defaultVoice() }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 古い設定(character: 人格1つ / model.lastPath)を、キャラ1人の一覧に移行する。
 * すでに characters があれば、そのまま(古い項目は無視される)。
 */
export function migrateLegacySettings(raw: unknown): unknown {
  if (!isObj(raw)) return raw
  if (Array.isArray(raw.characters) && raw.characters.length > 0) return raw
  const legacy = isObj(raw.character) ? raw.character : {}
  const lastPath = isObj(raw.model) && typeof raw.model.lastPath === 'string' ? raw.model.lastPath : null
  return { ...raw, characters: [{ ...legacy, id: DEFAULT_CHARACTER_ID, modelPath: lastPath }], activeCharacterId: DEFAULT_CHARACTER_ID }
}

/** 一覧を検証する。壊れた要素は捨て、IDの重複は後のものを捨てる。1人も残らなければ既定のキャラを1人入れる */
export function parseCharacterList(list: unknown[]): Character[] {
  const out: Character[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const r = CharacterSchema.safeParse(item)
    if (!r.success || seen.has(r.data.id)) continue
    seen.add(r.data.id)
    out.push(r.data)
  }
  return out.length > 0 ? out : [defaultCharacter()]
}

/** activeCharacterId が一覧に無ければ、先頭のキャラにする */
export function fixActiveId(characters: Character[], activeId: string): string {
  return characters.some((c) => c.id === activeId) ? activeId : characters[0].id
}

export interface CharacterState {
  characters: Character[]
  activeCharacterId: string
}

export function activeCharacter(s: CharacterState): Character {
  return s.characters.find((c) => c.id === s.activeCharacterId) ?? s.characters[0]
}

/** 使われていない新しいID(c2, c3, …) */
export function newCharacterId(existing: string[]): string {
  const used = new Set(existing)
  for (let n = existing.length + 1; ; n++) if (!used.has(`c${n}`)) return `c${n}`
}

/** キャラの名前: 前後の空白を除いて 1〜40文字。制御文字は不可 */
export function normalizeCharacterName(raw: string): string | null {
  const t = raw.trim()
  // eslint-disable-next-line no-control-regex
  if (t.length < 1 || t.length > 40 || /[\u0000-\u001f\u007f]/.test(t)) return null
  return t
}

/** モデルのパスから、キャラの名前の初期値(ファイル名の拡張子なし)。Windows / Mac どちらの区切りでもよい */
export function nameFromModelPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const name = base.replace(/\.[^.]+$/, '').trim()
  return normalizeCharacterName(name) ?? DEFAULT_CHARACTER.name
}

/** モデルのパスに対応するキャラ。同じパスが複数あれば、いま使っているキャラを優先する */
export function findByModelPath(s: CharacterState, path: string): Character | undefined {
  const active = activeCharacter(s)
  if (active.modelPath === path) return active
  return s.characters.find((c) => c.modelPath === path)
}

/** 新しいキャラ(人格は既定)を末尾に足す */
export function addCharacter(characters: Character[], opts: { name: string; modelPath: string | null }): { characters: Character[]; id: string } {
  const id = newCharacterId(characters.map((c) => c.id))
  const name = normalizeCharacterName(opts.name) ?? DEFAULT_CHARACTER.name
  return { characters: [...characters, { ...defaultCharacter(id, opts.modelPath), name }], id }
}

/** キャラを複製する(モデルも人格も同じ。名前に「のコピー」を付ける) */
export function duplicateCharacter(characters: Character[], id: string): { characters: Character[]; id: string } | null {
  const src = characters.find((c) => c.id === id)
  if (!src) return null
  const newId = newCharacterId(characters.map((c) => c.id))
  const name = normalizeCharacterName(`${src.name}のコピー`.slice(0, 40)) ?? src.name
  return { characters: [...characters, { ...src, id: newId, name }], id: newId }
}

/** キャラを消す。最後の1人は消せない(null)。消したのがいま使っているキャラなら、先頭のキャラに切り替える */
export function removeCharacter(s: CharacterState, id: string): CharacterState | null {
  if (s.characters.length <= 1 || !s.characters.some((c) => c.id === id)) return null
  const characters = s.characters.filter((c) => c.id !== id)
  return { characters, activeCharacterId: fixActiveId(characters, s.activeCharacterId === id ? '' : s.activeCharacterId) }
}
