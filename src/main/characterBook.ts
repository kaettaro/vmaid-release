import { existsSync } from 'node:fs'
import {
  activeCharacter,
  addCharacter,
  duplicateCharacter,
  findByModelPath,
  nameFromModelPath,
  normalizeCharacterName,
  removeCharacter,
  type Character
} from '../shared/characters'
import type { CharacterChange, CharacterEdit, CharacterView } from '../shared/settingsApi'
import type { SettingsStore } from './settingsStore'

/**
 * キャラクターの一覧・切り替え・編集(設定ファイルの characters / activeCharacterId の読み書き)。
 * 変更のたびに onChange を呼ぶ(キャラウィンドウ・設定ウィンドウ・メニューへ知らせる)。
 * 判断の中身(IDの発番・複製・削除の規則)は shared/characters.ts の純粋関数。
 */
export class CharacterBook {
  constructor(
    private readonly store: SettingsStore,
    private readonly onChange: (change: CharacterChange) => void
  ) {}

  active(): Character {
    return activeCharacter(this.store.get())
  }

  list(): Character[] {
    return this.store.get().characters
  }

  /** 設定ウィンドウ向けの一覧。モデルのファイルが無いキャラには modelMissing を付ける */
  views(): CharacterView[] {
    return this.list().map((c) => ({
      id: c.id,
      name: c.name,
      modelPath: c.modelPath,
      modelMissing: c.modelPath !== null && !existsSync(c.modelPath),
      tone: c.tone,
      systemPrompt: c.systemPrompt,
      userCallName: c.userCallName,
      voice: { speaker: c.voice.speaker, systemVoice: c.voice.systemVoice, speed: c.voice.speed, pitch: c.voice.pitch }
    }))
  }

  change(): CharacterChange {
    return { activeId: this.active().id, characters: this.list().map((c) => ({ id: c.id, name: c.name })) }
  }

  private notify(): void {
    this.onChange(this.change())
  }

  /** キャラを切り替える。存在しないIDは false */
  setActive(id: string): boolean {
    if (!this.list().some((c) => c.id === id)) return false
    if (this.active().id !== id) {
      this.store.update((s) => (s.activeCharacterId = id))
      this.notify()
    }
    return true
  }

  /** 新しいキャラを作って、そのキャラに切り替える */
  add(name: string, modelPath: string | null): Character {
    let id = ''
    this.store.update((s) => {
      const r = addCharacter(s.characters, { name, modelPath })
      s.characters = r.characters
      s.activeCharacterId = r.id
      id = r.id
    })
    this.notify()
    return this.list().find((c) => c.id === id)!
  }

  duplicate(id: string): Character | null {
    let newId: string | null = null
    this.store.update((s) => {
      const r = duplicateCharacter(s.characters, id)
      if (!r) return
      s.characters = r.characters
      newId = r.id
    })
    if (!newId) return null
    this.notify()
    return this.list().find((c) => c.id === newId) ?? null
  }

  /** 消す(最後の1人は消せない)。消したのがいま使っているキャラなら、先頭のキャラに切り替わる */
  remove(id: string): boolean {
    let ok = false
    this.store.update((s) => {
      const r = removeCharacter(s, id)
      if (!r) return
      s.characters = r.characters
      s.activeCharacterId = r.activeCharacterId
      ok = true
    })
    if (ok) this.notify()
    return ok
  }

  /** 名前・口調・性格・呼び方の編集。名前が不正なら、その項目は変えない */
  edit(id: string, patch: CharacterEdit): boolean {
    let found = false
    this.store.update((s) => {
      const c = s.characters.find((x) => x.id === id)
      if (!c) return
      found = true
      if (patch.name !== undefined) c.name = normalizeCharacterName(patch.name) ?? c.name
      if (patch.tone !== undefined) c.tone = patch.tone
      if (patch.systemPrompt !== undefined) c.systemPrompt = patch.systemPrompt
      if (patch.userCallName !== undefined) c.userCallName = patch.userCallName
      if (patch.voice !== undefined) {
        const v = patch.voice
        if (v.speaker !== undefined) c.voice.speaker = v.speaker
        if (v.systemVoice !== undefined) c.voice.systemVoice = v.systemVoice
        if (v.speed !== undefined) c.voice.speed = v.speed
        if (v.pitch !== undefined) c.voice.pitch = v.pitch
      }
    })
    if (found) this.notify()
    return found
  }

  setModelPath(id: string, path: string): boolean {
    let found = false
    this.store.update((s) => {
      const c = s.characters.find((x) => x.id === id)
      if (!c) return
      found = true
      c.modelPath = path
    })
    if (found) this.notify()
    return found
  }

  /**
   * キャラウィンドウがモデルを読み込んだとき(「モデルを選ぶ」・切り替え・起動時)。
   * そのモデルのキャラがあれば、そのキャラを使う。無ければ、モデル未設定のキャラ(今のキャラ)にモデルを結びつけ、
   * それも無ければ、ファイル名の新しいキャラを作る(毎回ファイルを選び直さなくて済むように、登録しておく)。
   */
  noteModelLoaded(path: string): void {
    const found = findByModelPath(this.store.get(), path)
    if (found) {
      this.setActive(found.id)
      return
    }
    const active = this.active()
    if (active.modelPath === null) this.setModelPath(active.id, path)
    else this.add(nameFromModelPath(path), path)
  }
}
