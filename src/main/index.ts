import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray, utilityProcess } from 'electron'
import trayIconPath from '../../resources/tray.png?asset'
import { IPC, type AppInfo, type MotionImportResult, type MotionsView, type TtsSynthResult } from '../shared/ipc'
import { DEFAULT_CHARACTER_ID, nameFromModelPath, normalizeCharacterName } from '../shared/characters'
import { CharacterEditSchema, SettingsPatchSchema, type CharacterActionResult } from '../shared/settingsApi'
import { AdjustHub } from './adjustHub'
import type { WorkerEvent, WorkerRequest } from '../shared/llm/workerProtocol'
import { ChatService } from './chatService'
import { WorkerHost, type WorkerChannel } from './llm/workerHost'
import { clearAll, deleteLatest, deleteOlderThan, deleteSelected, exportHistory } from './history/historyActions'
import { entryKey, filterEntries, pageNewestFirst } from '../shared/history/format'
import { HistoryStore } from './history/historyStore'
import { ModelManager } from './models/modelManager'
import { exportRules, importRules } from './rulesActions'
import { RulesStore } from './rulesStore'
import { CharacterWindow } from './characterWindow'
import { buildMenuTemplate, type MenuActions } from './menu'
import { globalShortcut } from 'electron'
import { pickVrmPathSync, readModelFile, readModelFileSync, setPmxGate } from './models'
import { handleModelScheme } from './modelProtocol'
import { registerPrivilegedSchemes } from './schemes'
import { ScriptHost } from './scriptHost'
import { ScriptLauncher } from './scriptLauncher'
import { contextLayers } from '../shared/scripts/context'
import { effectiveOrigins, newOrigins, parseUrlList } from '../shared/scripts/origins'
import { readModSetting, setModFilePath, setModSetting } from './modSettings'
import { checkVrmaBytes, MAX_VRMA_BYTES } from '../shared/motionLibrary'
import { addTagsEach } from '../shared/motionMeta'
import { FEATURE_MODS, isFeatureModId } from '../shared/mods/features'
import { migrateFeatureMods } from '../shared/mods/migrate'
import type { ModsView } from '../shared/modsApi'
import { mergePackRules } from '../shared/packs/manifest'
import { exportUserMod, modExportInfo, ModExportRequestSchema } from './modExport'
import { parseRuleSetYaml } from '../shared/rules/yaml'
import { collectMotionRefs } from '../shared/rules/motionRefs'
import type { LegacyGroups } from '../shared/rules/legacyGroups'
import { MotionMetaStore } from './motionMetaStore'
import {
  deleteMotionTagEverywhere,
  editMotionTags,
  motionItems,
  pickAndAddMotionFolder,
  pickAndAddMotions,
  readMotionData,
  readMotionDataForVrm,
  pickAndAddMotionFaces,
  clearMotionFaces,
  vmdMotionReport,
  readMotionState,
  removeMotions,
  renameMotion,
  renameMotionTagEverywhere,
  sanitizeImportOptions,
  setIdleMotion,
  setMaxImportFiles,
  type ImportOutcome,
  type MotionDeps
} from './motions'
import { CharacterBook } from './characterBook'
import { CharStateStore } from './charStateStore'
import { exportIndividualMod, importCommunityMod } from './packActions'
import { PackStore } from './packStore'
import { SoundController } from './sound'
import { BeautifyController } from './beautify'
import { BasicPatchSchema, type BasicResult, type BasicView } from '../shared/basic'
import { RESET_DIALOG, makeResetSnapshot, type ResetSnapshot } from '../shared/resetSnapshot'
import { ChaseController } from './chase'
import { VmdImportPatchSchema, VmdImportSchema } from '../shared/vmdImport'
import { MOVE_MODES, MOVE_TARGETS } from '../shared/move'
import { windowSizeForScale } from '../shared/geometry'
import { MoveController } from './move'
import { MoveAreaWindow } from './moveAreaWindow'
import { TalkSchema, type TalkPatch, type TalkView } from '../shared/talk/gate'
import { BUBBLE_ID, BubblePatchInputSchema, BubbleSchema, type BubbleView } from '../shared/bubble'
import { GameController } from './game'
import { GameWindow } from './gameWindow'
import { ModListWindows } from './modListWindow'
import { parseGameMove } from '../shared/game/engine'
import { isGameId } from '../shared/game/registry'
import { exclusiveOff } from '../shared/beautify'
import { TtsEngineLauncher } from './ttsEngine'
import { TtsError, TtsService } from './ttsService'
import { OverlayWindows } from './overlayWindow'
import { PanelWindow } from './panelWindow'
import { OverlayEffectStore } from './overlayEffects'
import { parseEffectYaml, sanitizeOverlayRequest, toPayload } from '../shared/overlay'
import { ProfileStore } from './profileStore'
import { SettingsStore } from './settingsStore'
import { openSettingsWindow } from './settingsWindow'
import { openPreviewWindow, previewReady, sendPlaybackToPreview } from './previewWindow'
import { clampSeek, parsePlayback } from '../shared/motions/playback'

// 音声(読み上げ)の再生は、ユーザーの操作なしで始まることがある(起動時のあいさつなど)。再生の自動開始を許可する
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// Chromium のプロキシの自動検出(`wpad` という名前の、LAN での名前解決)を止める。画面側(レンダラー)は、外部へ通信しない。
// モデルのダウンロード・LLM・音声合成の通信は、Node の fetch / http で行い、Chromium のプロキシ設定を使わないので、影響しない
app.commandLine.appendSwitch('no-proxy-server')

// 二重起動を防ぐ(常駐アプリのため)
if (!app.requestSingleInstanceLock()) app.quit()
registerPrivilegedSchemes() // PMX(vmaid-model)とスクリプト Mod(vmaid-ext)の専用プロトコル。準備(ready)の前に、まとめて登録する

let character: CharacterWindow | null = null
let tray: Tray | null = null
let store: SettingsStore
let panel: PanelWindow
let overlay: OverlayWindows
let overlayEffects: OverlayEffectStore
let adjust: AdjustHub
let chat: ChatService
let models: ModelManager
let worker: WorkerHost
let historyStore: HistoryStore
let rulesStore: RulesStore
let book: CharacterBook
let tts: TtsService
let sound: SoundController
let beautify: BeautifyController
let chase: ChaseController
let move: MoveController
let moveArea: MoveAreaWindow
let game: GameController
let gameWindow: GameWindow
let ttsEngine: TtsEngineLauncher
let charStates: CharStateStore
let packs: PackStore
let scripts: ScriptHost
let scriptLauncher: ScriptLauncher
let modLists: ModListWindows
let motionMeta: MotionMetaStore

/**
 * 旧形式のモーショングループ(グループ名 → モーション名)を、モーションのタグにする(グループ名がタグ名になる)。
 * いま存在しないモーションの名前は、飛ばす
 */
function applyLegacyGroups(legacy: LegacyGroups | null): void {
  if (!legacy || legacy.tags.length === 0) return
  const known = new Set(motionItems(motionDeps()).map((i) => i.name))
  const pairs: Array<[string, string[]]> = []
  for (const [tag, members] of Object.entries(legacy.assignments)) for (const m of members) if (known.has(m)) pairs.push([m, [tag]])
  motionMeta.set(addTagsEach(motionMeta.get(), pairs))
  motionsChanged()
}

/** モーションの操作に渡す、保存先の組 */
const motionDeps = (): MotionDeps => ({ store, meta: motionMeta, packs })

/** ルールが変わったことを、キャラウィンドウと設定ウィンドウの両方へ知らせる */
function broadcastRules(): void {
  const file = { text: rulesStore.read(), path: rulesStore.path }
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.rulesChanged, file)
}

const actions: MenuActions = {
  switchCharacter: (id) => {
    const r = switchCharacter(id)
    if (!r.ok && r.message) dialog.showMessageBoxSync({ type: 'warning', message: r.message, buttons: ['OK'] })
  },
  openSettings: () => openSettingsWindow(),
  openMotionPreview: () => openPreviewWindow(),
  toggleTalkMuted: () => saveTalk({ muted: !store.get().talk.muted }),
  toggleModWindow: (modId) => modLists?.toggle(modId),
  toggleClickThrough: () => character?.toggleClickThrough(),
  toggleVisible: () => character?.toggleVisible(),
  resetCharacter: () => resetCharacter(),
  undoReset: () => undoReset(),
  togglePanel: () => togglePanel(),
  reloadRules: () => broadcastRules(),
  revealRules: () => {
    rulesStore.read() // 無ければプリセットを書き出してから表示する
    shell.showItemInFolder(rulesStore.path)
  },
  resetRules: () => {
    app.focus({ steal: true })
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      message: 'マイルールを空にします',
      detail: '今のルールは rules.yaml.bak に残します(1世代のみ)。',
      buttons: ['空にする', 'キャンセル'],
      defaultId: 1,
      cancelId: 1
    })
    if (choice !== 0) return
    rulesStore.reset()
    broadcastRules()
  },
  addMotions: () => {
    void pickAndAddMotions(motionDeps()).then((r) => {
      if (r.picked) motionsImported(r)
    })
  },
  addMotionFolder: () => {
    void pickAndAddMotionFolder(motionDeps()).then((r) => {
      if (r.picked) motionsImported(r)
    })
  },
  quit: () => app.quit()
}

function togglePanel(): void {
  panel.toggle()
  refreshTray()
}

/** 取り込みの結果を、通知で知らせる(メニューから取り込んだときも結果が分かるように) */
function motionsImported(r: ImportOutcome): void {
  motionsChanged()
  dialog.showMessageBoxSync({
    type: r.summary.rejected.length > 0 ? 'warning' : 'info',
    message: r.message,
    detail: r.summary.rejected.length > 0 ? `読み込めなかったファイル:\n${r.summary.rejected.slice(0, 10).map((x) => `${x.path}\n  → ${x.reason}`).join('\n')}${r.summary.rejected.length > 10 ? `\n…ほか ${r.summary.rejected.length - 10}件` : ''}` : undefined,
    buttons: ['OK']
  })
}

/**
 * キャラを切り替える。モデルのファイルを読んで、キャラウィンドウへ送る(そのキャラの話し方・履歴・ルールも切り替わる)。
 * モデルが未設定のキャラには切り替えるだけ(設定画面でモデルを選んでもらう)。ファイルが無いときは切り替えない。
 */
function switchCharacter(id: string): { ok: boolean; message: string } {
  const c = book.list().find((x) => x.id === id)
  if (!c) return { ok: false, message: 'キャラが見つかりません' }
  if (!c.modelPath) {
    book.setActive(id)
    return { ok: true, message: `「${c.name}」にはモデルが設定されていません。設定 → キャラクター でモデルを選んでください` }
  }
  const file = readModelFileSync(c.modelPath)
  if (!file) return { ok: false, message: `「${c.name}」のモデルのファイルが見つかりません:\n${c.modelPath}\n\n設定 → キャラクター で、モデルを選び直してください` }
  book.setActive(id)
  character?.sendModel(file)
  return { ok: true, message: '' }
}

function characterResult(ok: boolean, message: string): CharacterActionResult {
  return { ok, message, view: chat.view() }
}

/** パックが変わったとき(有効/無効・取り込み): モーションの一覧と、パックのルールを、キャラウィンドウ・設定ウィンドウへ送り直す */
/** いま登録しているリセットのショートカット(登録できたか) */
let resetShortcutOk = false
let registeredResetShortcut: string | null = null

/**
 * 緊急リセット: キャラを初期の表示に戻し(表示・位置・倍率・クリック透過)、向き・再生中のモーション・ルールの効果・表情・衣装セット・画面効果・ゲームを、初期に戻す。
 * 「キャラが消えて設定を開けない」「Mod の効果で動けない」ときの、最後の手段。保存済みの設定と、Mod の ON/OFF は、変えない
 */
function resetCharacter(): void {
  if (!character) return
  move?.stop()
  if (store.get().display.confirmReset && !confirmReset()) return
  // 直前の状態を記録しておく(「元に戻す」のため。止まった効果は、戻せない)
  lastReset = makeResetSnapshot({ ...character.captureState(), orientation: adjust.getOrientation(), layers: adjust.snapshotLayers() })
  character.resetToDefault()
  adjust.revert() // 重ねている表情・衣装セットを外す
  adjust.setOrientation(0, 0)
  overlay?.hide()
  game?.stop()
  if (!character.win.isDestroyed()) character.win.webContents.send(IPC.characterReset)
  refreshTray()
  broadcastBasic()
}

/** 緊急リセットの直前の記録(取り消せるのは、直前の 1 回だけ。次のリセットか、アプリの終了まで) */
let lastReset: ResetSnapshot | null = null

function confirmReset(): boolean {
  app.focus({ steal: true })
  return dialog.showMessageBoxSync({ type: 'question', message: RESET_DIALOG.message, detail: RESET_DIALOG.detail, buttons: [RESET_DIALOG.ok, RESET_DIALOG.cancel], defaultId: 0, cancelId: 1 }) === 0
}

/** 直前のリセットを取り消す: 位置・大きさ・倍率・クリック透過・表示/非表示・向き・重ねていた表情・衣装セットを、リセット前に戻す */
function undoReset(): void {
  const snap = lastReset
  if (!snap || !character) return
  lastReset = null
  character.restoreState(snap)
  adjust.restoreLayers(snap.layers)
  adjust.setOrientation(snap.orientation.yaw, snap.orientation.pitch)
  if (!character.win.isDestroyed()) character.win.webContents.send(IPC.characterRestore, snap.orientation)
  refreshTray()
  broadcastBasic()
}

/** リセットのショートカットを登録し直す。登録できなければ false(ほかのアプリが使っている・不正な形) */
function registerResetShortcut(): boolean {
  if (registeredResetShortcut) globalShortcut.unregister(registeredResetShortcut)
  registeredResetShortcut = null
  const accel = store.get().display.resetShortcut
  try {
    resetShortcutOk = globalShortcut.register(accel, resetCharacter)
  } catch {
    resetShortcutOk = false
  }
  if (resetShortcutOk) registeredResetShortcut = accel
  else console.warn(`[reset] ショートカット ${accel} を登録できませんでした(ほかのアプリが使っています)。トレイ/右クリックの「キャラを初期状態に戻す」、または設定 → 基本設定を使ってください`)
  return resetShortcutOk
}

function basicView(): BasicView {
  const d = store.get().display
  return { scale: d.scale, clickThrough: d.clickThrough, alwaysOnTop: d.alwaysOnTop, showOnStartup: d.showOnStartup, resetShortcut: d.resetShortcut, previewInWindow: d.previewInWindow, confirmReset: d.confirmReset, canUndoReset: lastReset !== null, resetShortcutOk }
}

/** 基本設定が変わったことを、設定ウィンドウなどへ知らせる(キャラ窓へは、別の経路で届く) */
function broadcastBasic(): void {
  const view = basicView()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w !== character?.win) w.webContents.send(IPC.basicChanged, view)
}

/** 基本設定を更新する(検証して、変えた項目だけ反映)。ショートカットは、登録できなければ、元に戻す */
function applyBasic(raw: unknown): BasicResult {
  const parsed = BasicPatchSchema.safeParse(raw)
  if (!parsed.success) return { view: basicView(), error: parsed.error.issues.map((i) => i.message).join(' / ') }
  const p = parsed.data
  if (p.scale !== undefined) character?.setScale(p.scale)
  if (p.clickThrough !== undefined) character?.setClickThrough(p.clickThrough)
  if (p.alwaysOnTop !== undefined) character?.setAlwaysOnTop(p.alwaysOnTop)
  if (p.showOnStartup !== undefined) character?.setShowOnStartup(p.showOnStartup)
  if (p.previewInWindow !== undefined) store.update((st) => (st.display.previewInWindow = p.previewInWindow as boolean))
  if (p.confirmReset !== undefined) store.update((st) => (st.display.confirmReset = p.confirmReset as boolean))
  let error = ''
  if (p.resetShortcut !== undefined && p.resetShortcut !== store.get().display.resetShortcut) {
    const before = store.get().display.resetShortcut
    store.update((s) => (s.display.resetShortcut = p.resetShortcut as string))
    if (!registerResetShortcut()) {
      error = `「${p.resetShortcut}」は、ほかのアプリが使っているか、登録できません。元のショートカットに戻しました`
      store.update((s) => (s.display.resetShortcut = before))
      registerResetShortcut()
    }
  }
  refreshTray()
  broadcastBasic()
  return { view: basicView(), error }
}

/** スクリプト Mod が追加できるモーションの数(1つの Mod あたり) */
const MAX_SCRIPT_MOTIONS = 50

/** host.motion.add: 検査済みの VRMA だけ。名前は `<Mod の id>/<名前>`。その Mod のフォルダ(userData/mod-motions/<id>/)に置く */
function addScriptMotion(modId: string, rawName: string, data: Uint8Array): string | null {
  // eslint-disable-next-line no-control-regex
  const safe = rawName.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '').trim().slice(0, 40)
  if (safe === '' || data.length > MAX_VRMA_BYTES || !checkVrmaBytes(data).ok) return null
  const name = `${modId}/${safe}`
  const dir = join(app.getPath('userData'), 'mod-motions', modId)
  const library = store.get().motion.library
  const mine = library.filter((m) => m.name.startsWith(`${modId}/`))
  if (!mine.some((m) => m.name === name) && mine.length >= MAX_SCRIPT_MOTIONS) return null
  const path = join(dir, `${safe}.vrma`)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, data)
  } catch {
    return null
  }
  // 同じ名前なら、上書き。ほかの人(利用者・別の Mod)の同名のモーションは、上書きしない(名前に、Mod の id が付くので、衝突しない)
  store.update((s) => {
    s.motion.library = [...s.motion.library.filter((m) => m.name !== name), { name, path }]
  })
  motionsChanged()
  return name
}

/** host.motion.remove: その Mod が追加したものだけ消す */
function removeScriptMotion(modId: string, name: string): boolean {
  if (!name.startsWith(`${modId}/`)) return false
  const entry = store.get().motion.library.find((m) => m.name === name)
  if (!entry) return false
  store.update((s) => {
    s.motion.library = s.motion.library.filter((m) => m.name !== name)
  })
  try {
    unlinkSync(entry.path)
  } catch {
    // ファイルが、すでに無くてもよい
  }
  motionsChanged()
  return true
}

/** 公式の機能 Mod の ON/OFF の状態 */
function modsView(): ModsView {
  const m = store.get().mods
  const on = new Set(m.features)
  return { features: FEATURE_MODS.map((f) => ({ ...f, enabled: on.has(f.id) })), developerMode: m.developerMode, slots: packs.commonSlots(), characterSlots: m.slotsByCharacter, ruleValues: m.ruleValues, characterRuleValues: m.ruleValuesByCharacter, contributions: packs.contributions() }
}

function modsChanged(): void {
  scripts?.reconcile() // 有効でなくなった・変わったスクリプト Mod の窓を止める
  scriptLauncher?.reconcile(new Set(packs.scriptMods().map((m) => m.id))) // OFF にした Mod が起動した外部ツールを止める
  modLists?.sync() // 一覧窓: Mod の ON/OFF に合わせて、出す・閉じる
  const view = modsView()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.modsChanged, view)
}

/**
 * 初回だけ: 以前から使っていた機能に対応する Mod を ON にする(動作を変えない)。新規インストールは、既定 ON の 2 つ(追いかけ・モーションのタグ)だけ
 */
function migrateMods(): void {
  if (store.get().mods.migrated) return
  const user = parseRuleSetYaml(rulesStore.read()).ruleSet
  const rules = user ? mergePackRules(user, [{ ruleSet: packs.ruleSet() }]) : null
  const s = store.get()
  const features = migrateFeatureMods({
    existingUser: store.existed,
    footLock: s.motion.footLock,
    ttsEnabled: s.tts.enabled,
    rules,
    hasMotionTags: Object.keys(motionMeta.get().tags).length > 0
  })
  store.update((x) => {
    x.mods.features = features
    x.mods.migrated = true
  })
  if (features.length > 0) console.log(`[mods] 以前の使い方から、次の Mod を ON にしました: ${features.join(', ')}`)
}

/**
 * Mod を ON/OFF する(入口は、ここ 1 つ)。
 * 本体の機能と結びつく Mod(公式。機能だけで、ルールを持たないものも含む)は、その機能の ON/OFF(保存は、機能の側 1 か所)。それ以外の Mod は、Mod の ON/OFF。
 * どちらも、そのあとの反映(画面効果・音声・美化・ゲーム・追いかけ・効果音・モーション・ルール・Mod の一覧)は、同じ。
 */
function setModEnabled(id: string, enabled: boolean): void {
  const feature = packs.featureOf(id)
  if (feature === null) {
    packs.setEnabled(id, enabled)
    packsChanged()
    return
  }
  store.update((s) => {
    const set = new Set(s.mods.features)
    if (enabled) set.add(feature)
    else set.delete(feature)
    const other = exclusiveOff(feature) // 美化(リアル)と(トゥーン)は、どちらか一方だけ
    if (enabled && other) set.delete(other)
    s.mods.features = [...set]
  })
  packsChanged() // Mod の一覧(ルール・スロット・指示文も、機能と同時に有効・無効になる)も、読み直す
  if (feature === 'overlay' && !enabled) overlay.hide()
  if (feature === 'tts' && enabled) void ttsEngine.ensure(60_000) // 音声合成を ON にしたとき、自動起動が ON なら、起動する
  if (exclusiveOff(feature)) beautify.changed() // 美化の ON/OFF を、キャラ窓の描画へ反映する
  if (!enabled) game.stopFor(feature) // いま遊んでいるゲームの Mod を OFF にしたら、盤面の窓を閉じる
  if (feature === BUBBLE_ID) bubbleChanged()
  if (feature === 'talk') talkChanged() // 話しかけの ON/OFF を、キャラ窓・メニューへ反映する
  if (feature === 'move') move.sync() // OFF なら、いまの移動もやめる。ON で自動の設定なら、自動の移動を始める
  if (feature === 'chase') chase.changed() // 追いかけの ON/OFF を、キャラ窓へ反映する(カーソルの読み取りも、始める・止める)
  if (feature === 'se') sound.changed() // 効果音の ON/OFF を、キャラ窓へ反映する(OFF なら、鳴っている音も止まる)
}

function packsChanged(): void {
  packs.invalidate() // パックのファイルを読み直す(有効/無効・取り込みのあと)
  motionsChanged()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.packsChanged)
  modsChanged() // スクリプト Mod が宣言したノードも、変わるので、レジストリを作り直させる
}

function motionsView(): MotionsView {
  const { motion } = store.get()
  return { items: motionItems(motionDeps()), idle: motion.idle, footLock: store.get().mods.features.includes('foot-lock'), maxImportFiles: motion.maxImportFiles }
}

/** モーション登録が変わったら、キャラウィンドウへ送り直してメニューも更新する */
/** 吹き出しの設定・Mod の ON/OFF が変わったことを、全ウィンドウへ知らせる */
/** 話しかけ控えの設定(と、Mod の ON/OFF)。設定画面・キャラ窓へ渡す */
function talkView(): TalkView {
  return { ...store.get().talk, enabled: store.get().mods.features.includes('talk') }
}

function talkChanged(): void {
  const view = talkView()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.talkChanged, view)
  refreshTray() // 「静かにして」のチェック・項目の出し入れ
}

function saveTalk(patch: TalkPatch): TalkView {
  store.update((s) => {
    s.talk = TalkSchema.parse({ ...s.talk, ...patch })
  })
  talkChanged()
  return talkView()
}

function bubbleChanged(): void {
  const view = { ...store.get().bubble, enabled: store.get().mods.features.includes(BUBBLE_ID) }
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.bubbleChanged, view)
}

function motionsChanged(): void {
  character?.sendMotions(readMotionState(motionDeps()))
  refreshTray()
}

function menuTemplate(): Electron.MenuItemConstructorOptions[] {
  const { display } = store.get()
  return buildMenuTemplate(
    {
      visible: character?.visible ?? false,
      clickThrough: display.clickThrough,
      panelVisible: panel.visible,
      canUndoReset: lastReset !== null,
      characters: book.list().map((c) => ({ id: c.id, name: c.name })),
      activeCharacterId: book.active().id,
      talk: { available: store.get().mods.features.includes('talk'), muted: store.get().talk.muted },
      modWindows: modLists ? modListMods().map((m) => ({ id: m.id, name: m.name, visible: modLists.isVisible(m.id) })) : []
    },
    actions
  )
}

/** 一覧窓の権限(ui.list)を持つ、有効なスクリプト Mod */
function modListMods(): Array<{ id: string; name: string; canOpen: boolean }> {
  return packs.scriptMods().filter((m) => m.spec.permissions.ui.list).map((m) => ({ id: m.id, name: m.name, canOpen: m.spec.permissions.ui.openLink }))
}

function refreshTray(): void {
  tray?.setContextMenu(Menu.buildFromTemplate(menuTemplate()))
}

function createTray(): void {
  const icon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('VMaid')
  // Windowsはトレイアイコンの左クリックで表示/非表示(右クリックでメニュー)
  tray.on('click', () => {
    if (process.platform === 'win32') character?.toggleVisible()
  })
  refreshTray()
}

let profileStore: ProfileStore

/**
 * resources/ 内のファイルのパス。開発時はリポジトリの resources/、パッケージ後は extraResources(M8 で配置)。
 * (画像は `?asset` で取り込めるが、JSON は Vite が JSON として解析しようとして失敗するため、実行時にパスを解決する)
 */
function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
}

/** 内蔵LLMの推論ワーカーを、別プロセス(utilityProcess)で起動する。重い推論でUIを固めないため */
function spawnLlmWorker(): WorkerChannel {
  const child = utilityProcess.fork(join(import.meta.dirname, 'llmWorker.js'), [], { serviceName: 'VMaid LLM', stdio: 'pipe' })
  child.on('spawn', () => console.info('[llm] 推論プロセスを起動しました'))
  child.on('exit', (code) => console.info(`[llm] 推論プロセスが終了しました(コード ${code})`))
  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[llm] ${d}`))
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[llm] ${d}`))
  return {
    postMessage: (m: WorkerRequest) => child.postMessage(m),
    onMessage: (cb) => child.on('message', (e: WorkerEvent) => cb(e)),
    onExit: (cb) => child.on('exit', (code) => cb(code)),
    kill: () => void child.kill()
  }
}

function registerIpc(): void {
  ipcMain.handle(
    IPC.appInfo,
    (): AppInfo => ({ name: app.getName(), version: app.getVersion(), platform: process.platform })
  )
  ipcMain.handle(IPC.modelLast, async () => {
    const last = book.active().modelPath
    return last ? readModelFile(last) : null
  })
  ipcMain.on(IPC.modelLoaded, (_e, path: string) => {
    book.noteModelLoaded(path) // このモデルのキャラに切り替える(無ければ登録する)
  })
  ipcMain.handle(IPC.getDisplay, () => character?.displayState)
  ipcMain.handle(IPC.motionList, () => readMotionState(motionDeps()))
  ipcMain.handle(IPC.motionData, (_e, name: unknown, opts: unknown) => {
    if (typeof name !== 'string') return null
    const vrm = typeof opts === 'object' && opts !== null && (opts as { vrm?: unknown }).vrm === true
    return vrm ? readMotionDataForVrm(store, packs, name) : readMotionData(store, packs, name)
  })
  ipcMain.handle(IPC.motionFacesAdd, (_e, name: unknown) => {
    const r = typeof name === 'string' ? pickAndAddMotionFaces(motionDeps(), name) : { ok: false, message: '' }
    motionsChanged()
    return { ...r, view: motionsView() }
  })
  ipcMain.handle(IPC.motionFacesClear, (_e, name: unknown) => {
    if (typeof name === 'string') clearMotionFaces(motionDeps(), name)
    motionsChanged()
    return motionsView()
  })
  ipcMain.handle(IPC.motionVmdReport, (_e, name: unknown) => (typeof name === 'string' ? vmdMotionReport(motionDeps(), name) : { ok: false, lines: [] }))
  // 移動(機能 Mod「より自由な移動」)
  ipcMain.on(IPC.moveTo, (_e, target: unknown, mode: unknown) => {
    if (MOVE_TARGETS.includes(target as never) && MOVE_MODES.includes(mode as never)) move.start(target as never, mode as never)
  })
  ipcMain.on(IPC.moveStop, () => move.stop())
  ipcMain.on(IPC.moveBusy, (_e, busy: unknown) => move.setChatBusy(busy === true))
  ipcMain.handle(IPC.moveGet, () => move.view())
  ipcMain.handle(IPC.moveSave, (_e, raw: unknown) => move.save(raw))
  ipcMain.on(IPC.moveFxPreview, () => move.previewFx())
  ipcMain.handle(IPC.moveAreaOpen, async () => {
    const rects = await moveArea.open(store.get().move.rects)
    return rects ? move.save({ rects, areaMode: rects.length > 0 ? 'rects' : 'display' }) : move.view()
  })
  ipcMain.handle(IPC.moveAreaInit, (e) => moveArea.init(e.sender))
  ipcMain.on(IPC.moveAreaChange, (e, raw: unknown) => moveArea.change(e.sender, raw))
  ipcMain.on(IPC.moveAreaFinish, (_e, save: unknown) => moveArea.finish(save === true))
  const bubbleView = (): BubbleView => ({ ...store.get().bubble, enabled: store.get().mods.features.includes(BUBBLE_ID) })
  ipcMain.handle(IPC.talkGet, () => talkView())
  ipcMain.handle(IPC.talkSave, (_e, raw: unknown) => saveTalk(typeof raw === 'object' && raw !== null ? (raw as TalkPatch) : {}))
  ipcMain.handle(IPC.bubbleGet, () => bubbleView())
  ipcMain.handle(IPC.bubbleSave, (_e, raw: unknown) => {
    const r = BubblePatchInputSchema.safeParse(raw)
    if (r.success) {
      store.update((s) => {
        const merged = BubbleSchema.parse({ ...s.bubble, ...Object.fromEntries(Object.entries(r.data).filter(([, v]) => v !== undefined)) })
        Object.assign(s.bubble, merged)
      })
      bubbleChanged()
    }
    return bubbleView()
  })
  ipcMain.handle(IPC.vmdImportGet, () => ({ ...store.get().vmdImport, enabled: store.get().mods.features.includes('mmd') }))
  ipcMain.handle(IPC.vmdImportSave, (_e, raw: unknown) => {
    const r = VmdImportPatchSchema.safeParse(raw)
    if (r.success) store.update((s) => Object.assign(s.vmdImport, VmdImportSchema.parse({ ...s.vmdImport, ...r.data })))
    return { ...store.get().vmdImport, enabled: store.get().mods.features.includes('mmd') }
  })
  ipcMain.on(IPC.dragStart, () => {
    move?.interrupt() // つかんだら、歩いていても、止まる
    character?.dragStart()
  })
  ipcMain.on(IPC.dragMove, (_e, dx: number, dy: number) => character?.dragMove(dx, dy))
  ipcMain.on(IPC.dragEnd, () => character?.dragEnd())
  ipcMain.on(IPC.setScale, (_e, scale: number) => character?.setScale(scale))
  ipcMain.on(IPC.setIgnoreMouse, (_e, ignore: boolean) => character?.setIgnoreMouse(ignore))
  ipcMain.handle(IPC.profileGet, (_e, hash: string) => profileStore.read(hash))
  ipcMain.on(IPC.adjustPublish, (_e, snapshot) => adjust.publish(snapshot))
  ipcMain.handle(IPC.adjustGet, () => adjust.getSnapshot())
  ipcMain.on(IPC.adjustSet, (_e, key: string, value: number) => adjust.set(key, value))
  ipcMain.on(IPC.adjustReset, () => adjust.reset())
  ipcMain.on(IPC.adjustOrientation, (_e, yaw: unknown, pitch: unknown) => {
    if (typeof yaw === 'number' && Number.isFinite(yaw) && typeof pitch === 'number' && Number.isFinite(pitch)) {
      adjust.setOrientation(yaw, pitch)
    }
  })
  ipcMain.handle(IPC.presetSave, (_e, name: unknown) => adjust.savePreset(String(name)))
  ipcMain.handle(IPC.presetDelete, (_e, name: unknown) => adjust.deletePreset(String(name)))
  ipcMain.handle(IPC.presetApply, (_e, name: unknown, opts: unknown) => {
    const o = (typeof opts === 'object' && opts !== null ? opts : {}) as { transient?: unknown; revertAfterSec?: unknown; mode?: unknown; source?: unknown }
    const sec = Number(o.revertAfterSec)
    return adjust.applyPreset(String(name), {
      transient: o.transient === true,
      revertAfterSec: Number.isFinite(sec) ? Math.min(3600, Math.max(0, sec)) : 0,
      mode: o.mode === 'replace' ? 'replace' : 'overlay',
      source: typeof o.source === 'string' && o.source.length <= 80 ? o.source : null
    })
  })
  ipcMain.handle(IPC.presetSetDefault, (_e, name: unknown) => adjust.setDefaultPreset(typeof name === 'string' ? name : null))
  ipcMain.on(IPC.lookReset, () => adjust.resetLook())
  ipcMain.on(IPC.presetRevert, (_e, filter: unknown) => {
    // 名前か Mod を指定すればその分だけ、指定がなければ、重ねているセットすべてを外す
    const f = (typeof filter === 'object' && filter !== null ? filter : {}) as { name?: unknown; source?: unknown }
    adjust.revert({
      ...(typeof f.name === 'string' ? { name: f.name.slice(0, 80) } : {}),
      ...(typeof f.source === 'string' ? { source: f.source.slice(0, 80) } : {})
    })
  })
  ipcMain.on(IPC.chatSend, (_e, text: unknown, states: unknown) => {
    // 続いている状態の名前(Mod の「状態のときだけ足す指示文」の判定用)。形が違うものは捨てる
    const active = new Set(Array.isArray(states) ? states.filter((s): s is string => typeof s === 'string' && s.length <= 24).slice(0, 50) : [])
    if (typeof text === 'string') void chat.chat(text.slice(0, 4000), active)
  })
  ipcMain.on(IPC.chatAsk, (_e, instruction: unknown, opts: unknown) => {
    // 裏の指示: 形が違うものは捨てる。ユーザーの会話中は、chat 側で何もしない
    if (typeof instruction !== 'string' || instruction.trim() === '') return
    const o = (typeof opts === 'object' && opts !== null ? opts : {}) as { states?: unknown; save?: unknown }
    const active = new Set(Array.isArray(o.states) ? o.states.filter((s): s is string => typeof s === 'string' && s.length <= 24).slice(0, 50) : [])
    void chat.chat(instruction.slice(0, 2000), active, { save: o.save !== false })
  })
  ipcMain.on(IPC.settingsOpen, () => openSettingsWindow())
  ipcMain.on(IPC.previewWinOpen, (_e, name: unknown) => openPreviewWindow(typeof name === 'string' && name.length > 0 && name.length <= 200 ? name : undefined))
  ipcMain.on(IPC.previewWinReady, (e) => previewReady(e.sender))
  ipcMain.on(IPC.windowFocus, () => character?.focus())
  ipcMain.on(IPC.chatAbort, () => chat.abort())
  ipcMain.on(IPC.chatPrepare, () => void chat.prepare())
  ipcMain.handle(IPC.motionsView, () => motionsView())
  const motionResult = (r: ImportOutcome): MotionImportResult => {
    if (r.picked) motionsChanged()
    return { picked: r.picked, message: r.message, added: r.summary.added, duplicates: r.summary.duplicates, rejected: r.summary.rejected, notes: r.summary.notes ?? [], view: motionsView() }
  }
  // 大量の取り込みは、時間がかかる。進捗を、取り込みを頼んだ設定ウィンドウへ流す
  const importProgress = (e: Electron.IpcMainInvokeEvent) => (done: number, total: number) => {
    if (!e.sender.isDestroyed()) e.sender.send(IPC.motionsImportProgress, { done, total })
  }
  ipcMain.handle(IPC.motionsAddFiles, async (e, opts: unknown) => motionResult(await pickAndAddMotions(motionDeps(), sanitizeImportOptions(opts), importProgress(e))))
  ipcMain.handle(IPC.motionsAddFolder, async (e, opts: unknown) => motionResult(await pickAndAddMotionFolder(motionDeps(), sanitizeImportOptions(opts), importProgress(e))))
  ipcMain.handle(IPC.motionsSetIdle, (_e, name: unknown) => {
    setIdleMotion(store, typeof name === 'string' ? name : null)
    motionsChanged()
    return motionsView()
  })
  ipcMain.handle(IPC.motionsRename, (_e, from: unknown, to: unknown) => {
    const r = renameMotion(motionDeps(), String(from), String(to))
    if (!r.ok) return { ok: false, message: r.reason, view: motionsView() }
    if (r.name === String(from)) return { ok: true, message: '名前は、変わりませんでした', view: motionsView() }
    const refs = rulesStore.renameMotionReferences(String(from), r.name)
    motionsChanged()
    if (refs.changed) broadcastRules()
    const notes = [refs.rules.length ? `ルール ${refs.rules.join(', ')}` : ''].filter(Boolean)
    const message = `「${String(from)}」を「${r.name}」に変えました${notes.length ? `(${notes.join(' / ')} の参照も更新しました)` : ''}${'error' in refs && refs.error ? `。${refs.error}` : ''}`
    return { ok: true, message, view: motionsView() }
  })
  ipcMain.handle(IPC.motionsRemove, (_e, name: unknown) => {
    removeMotions(motionDeps(), [String(name)])
    motionsChanged()
    return motionsView()
  })
  ipcMain.handle(IPC.motionsRemoveMany, (_e, names: unknown) => {
    if (Array.isArray(names)) removeMotions(motionDeps(), names.filter((n): n is string => typeof n === 'string'))
    motionsChanged()
    return motionsView()
  })
  ipcMain.handle(IPC.motionsEditTags, (_e, edit: unknown) => {
    const e = (typeof edit === 'object' && edit !== null ? edit : {}) as Record<string, unknown>
    const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
    editMotionTags(motionDeps(), { names: strings(e.names) ?? [], add: strings(e.add), remove: strings(e.remove), set: strings(e.set) })
    motionsChanged()
    return motionsView()
  })
  ipcMain.handle(IPC.motionsRenameTag, (_e, from: unknown, to: unknown) => {
    if (typeof from === 'string' && typeof to === 'string') {
      renameMotionTagEverywhere(motionDeps(), from, to)
      // ルールの `tag:` の参照も、一緒に書き換える(タグを付け替えたのに、ルールが古い名前を指して、再生されなくなるのを防ぐ)
      if (rulesStore.renameTagReferences(from, to).changed) broadcastRules()
    }
    motionsChanged()
    return motionsView()
  })
  ipcMain.handle(IPC.motionsDeleteTag, (_e, tag: unknown) => {
    if (typeof tag === 'string') deleteMotionTagEverywhere(motionDeps(), tag)
    motionsChanged()
    return motionsView()
  })
  ipcMain.handle(IPC.motionsSetMaxImport, (_e, n: unknown) => {
    setMaxImportFiles(store, typeof n === 'number' ? n : 0)
    return motionsView()
  })
  ipcMain.on(IPC.motionsStop, () => character?.win.webContents.send(IPC.motionStopRun))
  // 再生位置の表示・シーク・一時停止: キャラ窓 ↔ 再生ウィンドウを、main が中継する(入力は検証する)
  ipcMain.on(IPC.motionProgress, (e, raw: unknown) => {
    if (e.sender !== character?.win.webContents) return // 状態を報告できるのは、キャラ窓だけ
    sendPlaybackToPreview(raw === null ? null : parsePlayback(raw))
  })
  ipcMain.on(IPC.motionSeek, (_e, sec: unknown) => {
    if (typeof sec === 'number') character?.win.webContents.send(IPC.motionSeekRun, clampSeek(sec, 3600))
  })
  ipcMain.on(IPC.motionPause, (_e, paused: unknown) => {
    if (typeof paused === 'boolean') character?.win.webContents.send(IPC.motionPauseRun, paused)
  })
  // モーションごとの、割り当て済みのルール(自分のルール + 有効な Mod のルール)。再生ウィンドウ・モーション一覧に出す
  ipcMain.handle(IPC.motionRefs, () => {
    const user = parseRuleSetYaml(rulesStore.read()).ruleSet
    const rules = [...(user?.rules ?? []), ...packs.ruleSet().rules]
    return collectMotionRefs(rules, readMotionState(motionDeps()).tags)
  })
  ipcMain.handle(IPC.rulesGet, () => ({ text: rulesStore.read(), path: rulesStore.path }))
  ipcMain.handle(IPC.rulesSave, (_e, text: unknown) => {
    if (typeof text !== 'string' || text.length > 500_000) return { ok: false, errors: ['ルールの内容が正しくありません'] }
    const r = rulesStore.save(text)
    if (!r.ok) return r
    broadcastRules() // 保存したら、すぐキャラに反映する(設定ウィンドウにも)
    return { ok: true, file: { text, path: rulesStore.path } }
  })
  ipcMain.on(IPC.motionsPreview, (_e, name: unknown, opts: unknown) => {
    const loop = typeof opts === 'object' && opts !== null && (opts as { loop?: unknown }).loop === true
    if (typeof name === 'string' && name.length <= 200) character?.win.webContents.send(IPC.motionPreviewRun, { name, loop })
  })
  ipcMain.on(IPC.rulesTestFire, (_e, id: unknown) => {
    if (typeof id === 'string') character?.win.webContents.send(IPC.rulesTestFireRun, id)
  })
  ipcMain.handle(IPC.rulesExport, () => exportRules(rulesStore))
  ipcMain.handle(IPC.rulesImport, () => {
    const r = importRules(rulesStore, applyLegacyGroups)
    if (r.ok) broadcastRules()
    return r
  })
  ipcMain.handle(IPC.rulesReset, () => {
    rulesStore.reset()
    broadcastRules()
    return { text: rulesStore.read(), path: rulesStore.path }
  })
  ipcMain.handle(IPC.historyView, async () => ({
    enabled: store.get().history.enabled,
    summary: await historyStore.summary(),
    dir: join(app.getPath('userData'), 'history')
  }))
  ipcMain.handle(IPC.historyClear, async () => {
    const r = await clearAll(historyStore)
    if (r.cleared) chat.resetContext() // 消したはずの履歴が、メモリ上の文脈に残らないように
    return { ok: r.ok, message: r.message }
  })
  ipcMain.handle(IPC.historyDeleteOlder, async (_e, days: unknown) => {
    const r = await deleteOlderThan(historyStore, Number(days))
    if (r.cleared) chat.resetContext()
    return { ok: r.ok, message: r.message }
  })
  ipcMain.handle(IPC.historyList, async (_e, raw: unknown) => {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as { characterId?: unknown; query?: unknown; offset?: unknown; limit?: unknown }
    const filter = {
      ...(typeof r.characterId === 'string' ? { characterId: r.characterId } : {}),
      ...(typeof r.query === 'string' ? { query: r.query.slice(0, 200) } : {})
    }
    const limit = Math.min(200, Math.max(1, Number(r.limit) || 50))
    const page = pageNewestFirst(filterEntries(await historyStore.readAll(), filter), Number(r.offset) || 0, limit)
    return { total: page.total, items: page.items.map((e) => ({ key: entryKey(e), ts: e.ts, role: e.role, text: e.text, ...(e.characterId ? { characterId: e.characterId } : {}) })) }
  })
  ipcMain.handle(IPC.historyDeleteKeys, async (_e, keys: unknown) => {
    const list = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string').slice(0, 5000) : []
    const r = await deleteSelected(historyStore, list)
    if (r.cleared) chat.resetContext()
    return { ok: r.ok, message: r.message }
  })
  ipcMain.handle(IPC.historyDeleteLast, async (_e, n: unknown, characterId: unknown) => {
    const r = await deleteLatest(historyStore, Number(n), typeof characterId === 'string' ? characterId : undefined)
    if (r.cleared) chat.resetContext()
    return { ok: r.ok, message: r.message }
  })
  ipcMain.handle(IPC.historyExport, (_e, format: unknown) => {
    const active = book.active()
    const nameOf = (id: string | undefined): string => book.list().find((c) => c.id === (id ?? DEFAULT_CHARACTER_ID))?.name ?? active.name
    return exportHistory(historyStore, format === 'text' ? 'text' : 'json', {
      character: active.name,
      user: active.userCallName,
      characterOf: nameOf
    })
  })
  ipcMain.handle(IPC.modelsList, () => models.view())
  ipcMain.handle(IPC.modelsDownload, async (_e, id: unknown) => {
    const entry = models.registry.find((m) => m.id === id)
    if (!entry) return { ok: false, message: 'モデルが見つかりません' }
    const result = await models.download(entry)
    if (result === null) return { ok: false, message: 'キャンセルしました' }
    if ('error' in result) return { ok: false, message: result.error }
    return { ok: true, message: `「${entry.name}」のダウンロードが完了しました` }
  })
  ipcMain.on(IPC.modelsCancel, () => models.cancelDownload())
  ipcMain.handle(IPC.modelsDelete, (_e, id: unknown) => models.remove(String(id)))
  ipcMain.handle(IPC.modelsSelect, async (_e, id: unknown) => {
    models.select(String(id))
    return models.view()
  })
  ipcMain.handle(IPC.modelsPickCustom, () => models.pickCustom())
  ipcMain.handle(IPC.modelsClearCustom, async () => {
    models.clearCustom()
    return models.view()
  })
  ipcMain.handle(IPC.chatTest, () => chat.test())
  // --- Mod(公式の機能 Mod の ON/OFF) ---
  ipcMain.handle(IPC.modsView, () => modsView())
  ipcMain.handle(IPC.modsSetFeature, (_e, id: unknown, enabled: unknown) => {
    if (typeof id === 'string' && isFeatureModId(id) && typeof enabled === 'boolean') setModEnabled(id, enabled)
    return modsView()
  })
  ipcMain.handle(IPC.basicGet, () => basicView())
  ipcMain.handle(IPC.basicSet, (_e, raw: unknown) => applyBasic(raw))
  ipcMain.on(IPC.basicReset, () => resetCharacter())
  ipcMain.on(IPC.basicUndoReset, () => undoReset())
  // 画面効果: キャラ窓のルールから。機能 Mod「画面効果」が ON のときだけ、検証した値で出す
  ipcMain.on(IPC.overlayShow, (e, raw: unknown) => {
    if (e.sender !== character?.win.webContents) return // 出せるのは、キャラ窓だけ
    const req = sanitizeOverlayRequest(raw)
    if (!req || !store.get().mods.features.includes('overlay')) return
    const spec = overlayEffects.get(req.effect)
    if (spec) overlay.show(toPayload(req, spec))
    else console.warn(`[overlay] 画面効果「${req.effect}」は、ありません`)
  })
  // 画面効果の一覧・自作の保存・削除・試し表示(設定画面から)
  ipcMain.handle(IPC.overlayEffects, () => overlayEffects.list())
  ipcMain.handle(IPC.overlayEffectSave, (_e, name: unknown, yaml: unknown) => {
    const r = typeof name === 'string' && typeof yaml === 'string' ? overlayEffects.save(name.trim(), yaml) : { ok: false, message: '入力が正しくありません' }
    return { ...r, effects: overlayEffects.list() }
  })
  ipcMain.handle(IPC.overlayEffectDelete, (_e, name: unknown) => {
    const r = typeof name === 'string' ? overlayEffects.delete(name) : { ok: false, message: '入力が正しくありません' }
    return { ...r, effects: overlayEffects.list() }
  })
  ipcMain.handle(IPC.overlayEffectPreview, (_e, yaml: unknown, scope: unknown) => {
    if (!store.get().mods.features.includes('overlay')) return { ok: false, message: '機能 Mod「画面効果」が OFF です。先に ON にしてください' }
    const r = typeof yaml === 'string' ? parseEffectYaml(yaml) : { spec: null, errors: ['入力が正しくありません'] }
    if (!r.spec) return { ok: false, message: r.errors.join(' / ') }
    // 保存せずに、6 秒だけ出す
    overlay.show(toPayload({ effect: 'preview', intensity: 0.8, color: '', durationSec: 6, scope: scope === 'character' ? 'character' : 'screen' }, r.spec))
    return { ok: true, message: '6 秒間、試し表示します' }
  })
  ipcMain.on(IPC.overlayHide, (e) => {
    if (e.sender === character?.win.webContents) overlay.hide()
  })
  ipcMain.on(IPC.scriptRunAction, (_e, modId: unknown, action: unknown, params: unknown) => {
    if (typeof modId === 'string' && typeof action === 'string') void scripts.runAction(modId, action, params)
  })
  // 外部ツールの起動: 実行ファイルは、利用者がダイアログで選んだものだけ。起動できるのは、有効なスクリプト Mod の、宣言した launcher だけ
  ipcMain.handle(IPC.modsLauncherPick, (_e, modId: unknown) => {
    let message = '設定できませんでした'
    const spec = typeof modId === 'string' ? packs.scriptSpec(modId) : null
    if (typeof modId === 'string' && spec?.launcher) {
      app.focus({ steal: true })
      const paths = dialog.showOpenDialogSync({
        title: `${spec.launcher.label}の起動に使う実行ファイルを選択`,
        properties: process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openFile'],
        filters: process.platform === 'win32' ? [{ name: '実行ファイル(.exe / .bat / .cmd)', extensions: ['exe', 'bat', 'cmd'] }] : []
      })
      if (!paths || paths.length === 0) message = ''
      else {
        const r = setModFilePath(store, spec, modId, spec.launcher.pathSetting, paths[0])
        message = r.ok ? '' : r.message
      }
    }
    return { message, view: packs.view() }
  })
  ipcMain.handle(IPC.modsLauncherStart, async (_e, modId: unknown) => {
    const mod = typeof modId === 'string' ? packs.scriptMods().find((m) => m.id === modId) : undefined
    if (!mod?.spec.launcher) return { ok: false, message: 'この Mod は、有効ではないか、外部ツールの起動を宣言していません' }
    return scriptLauncher.ensure(mod)
  })
  ipcMain.handle(IPC.scriptLogs, (_e, modId: unknown) => scripts.getLogs(typeof modId === 'string' ? modId : ''))
  ipcMain.handle(IPC.modsSetSetting, async (_e, modId: unknown, name: unknown, value: unknown) => {
    let message = '設定できませんでした'
    if (typeof modId === 'string' && typeof name === 'string' && typeof value === 'string') {
      const mod = packs.view().packs.find((p) => p.id === modId)
      const spec = packs.scriptSpec(modId)
      if (mod && spec) {
        message = ''
        // 通信先を足す設定(urls + networkFrom): まだ承認していないサイトがあれば、確認を取ってから保存する
        const def = spec.settings.find((s) => s.name === name)
        const addsNetwork = def?.kind === 'urls' && spec.permissions.networkFrom.includes(name)
        const list = addsNetwork ? parseUrlList(value) : null
        if (addsNetwork && list && !list.ok) message = list.message
        else if (addsNetwork && list?.ok) {
          const approved = store.get().mods.approvedOrigins[modId] ?? []
          const fresh = newOrigins(list.origins, approved)
          if (fresh.length > 0) {
            app.focus({ steal: true })
            const choice = dialog.showMessageBoxSync({
              type: 'question',
              message: `「${mod.name}」が、次のサイトへ接続します`,
              detail: `${fresh.join('\n')}\n\nこの Mod は、あなたの PC から、上のサイトへ接続して、データを取得します(あなたの IP アドレスが、サイトから見えます)。入力した内容・会話は、送りません。許可しますか?(あとで、設定から URL を消すと、使えなくなります)`,
              buttons: ['許可する', 'キャンセル'],
              defaultId: 1,
              cancelId: 1
            })
            if (choice !== 0) message = 'キャンセルしました(保存していません)'
          }
          if (message === '') {
            const r = setModSetting(store, spec, modId, name, value)
            message = r.ok ? '' : r.message
            if (r.ok) {
              // 承認は、いま設定にあるサイトのぶんだけ残す(消したサイトの承認は、なくなる)
              store.update((s) => {
                const keep = new Set(list.origins)
                s.mods.approvedOrigins[modId] = [...new Set([...(s.mods.approvedOrigins[modId] ?? []).filter((o) => keep.has(o)), ...list.origins])]
              })
            }
          }
        } else {
          const r = setModSetting(store, spec, modId, name, value)
          message = r.ok ? '' : r.message
        }
      }
    }
    return { message, view: packs.view() }
  })
  ipcMain.handle(IPC.modsSetRuleValue, (_e, modId: unknown, ruleId: unknown, path: unknown, value: unknown, characterId: unknown) => {
    const cid = typeof characterId === 'string' ? characterId : null
    if (typeof modId === 'string' && typeof ruleId === 'string' && typeof path === 'string' && packs.setRuleValue(modId, ruleId, path, value ?? null, cid)) modsChanged()
    return packs.view()
  })
  ipcMain.handle(IPC.modsSetUiWindow, (_e, modId: unknown, patch: unknown) => {
    const p = typeof patch === 'object' && patch !== null ? (patch as { visible?: unknown; follow?: unknown }) : {}
    if (typeof modId === 'string' && modListMods().some((m) => m.id === modId)) {
      modLists.set(modId, { ...(typeof p.visible === 'boolean' ? { visible: p.visible } : {}), ...(typeof p.follow === 'boolean' ? { follow: p.follow } : {}) })
    }
    return packs.view()
  })
  ipcMain.handle(IPC.modsSetSlot, (_e, modId: unknown, slotId: unknown, value: unknown, characterId: unknown) => {
    const cid = typeof characterId === 'string' ? characterId : null
    if (typeof modId === 'string' && typeof slotId === 'string' && typeof value === 'string' && packs.setSlot(modId, slotId, value, cid)) modsChanged()
    return packs.view()
  })
  ipcMain.handle(IPC.modsExportInfo, () => modExportInfo(motionDeps(), rulesStore.read(), book.active().systemPrompt))
  ipcMain.handle(IPC.modsExport, (_e, req: unknown) => {
    const parsed = ModExportRequestSchema.safeParse(req)
    if (!parsed.success) return { ok: false, message: '書き出しの内容が正しくありません', warnings: [] }
    return exportUserMod(motionDeps(), rulesStore.read(), parsed.data)
  })
  ipcMain.handle(IPC.modsSetDeveloper, (_e, enabled: unknown) => {
    if (typeof enabled === 'boolean') {
      store.update((s) => {
        s.mods.developerMode = enabled
      })
      modsChanged()
    }
    return modsView()
  })
  // --- パック ---
  ipcMain.handle(IPC.packsView, () => packs.view())
  ipcMain.handle(IPC.packsSetEnabled, (_e, id: unknown, enabled: unknown) => {
    if (typeof id === 'string' && typeof enabled === 'boolean') setModEnabled(id, enabled)
    return packs.view()
  })
  ipcMain.handle(IPC.packsSetRuleEnabled, (_e, ruleId: unknown, enabled: unknown) => {
    if (typeof ruleId === 'string' && typeof enabled === 'boolean' && packs.setRuleEnabled(ruleId, enabled)) packsChanged()
    return packs.view()
  })
  ipcMain.on(IPC.packsOpenFolder, () => void shell.openPath(packs.ensureIndividualDir()))
  ipcMain.handle(IPC.packsExport, (_e, id: unknown) => {
    const r = exportIndividualMod(packs, String(id))
    return { ok: r.ok, message: r.message, view: packs.view() }
  })
  ipcMain.handle(IPC.packsImport, () => {
    const r = importCommunityMod(packs)
    if (r.changed) packsChanged()
    return { ok: r.ok, message: r.message, view: packs.view() }
  })
  ipcMain.handle(IPC.packsRuleSet, () => packs.ruleSet())
  ipcMain.handle(IPC.packsRuleSetAll, () => packs.ruleSetAll())
  ipcMain.handle(IPC.packsTouchParts, () => packs.touchParts())
  ipcMain.handle(IPC.packsPropData, (_e, id: unknown) => (typeof id === 'string' && id.length <= 100 ? packs.propData(id) : null))
  // --- キャラの気分・親密度 ---
  ipcMain.handle(IPC.charStateGet, () => charStates.read(book.active().id))
  ipcMain.on(IPC.charStateSave, (_e, state: unknown) => {
    if (typeof state === 'object' && state !== null) charStates.write(book.active().id, state)
  })
  // --- 音楽(機能 Mod) ---
  ipcMain.handle(IPC.soundGet, () => sound.view())
  ipcMain.handle(IPC.soundSave, (_e, raw: unknown) => sound.save(raw))
  ipcMain.handle(IPC.audioPick, () => sound.pick())
  ipcMain.handle(IPC.audioRead, (_e, path: unknown) => sound.read(path)) // 登録した(効果音・ダンスの表にある)ファイルだけ
  ipcMain.on(IPC.audioPreview, (_e, raw: unknown) => sound.preview(raw))
  // --- 美化(機能 Mod) ---
  ipcMain.handle(IPC.beautifyGet, () => beautify.view())
  ipcMain.handle(IPC.beautifySave, (_e, raw: unknown) => beautify.save(raw))
  // --- ゲーム(機能 Mod) ---
  ipcMain.handle(IPC.gameGet, () => game.view())
  ipcMain.handle(IPC.gameSave, (_e, raw: unknown) => game.save(raw))
  ipcMain.handle(IPC.gameStateGet, () => game.state())
  ipcMain.on(IPC.gameMove, (_e, raw: unknown) => {
    const move = parseGameMove(raw)
    if (move) game.move(move)
  })
  ipcMain.on(IPC.gameStart, (_e, raw: unknown) => {
    const o = (typeof raw === 'object' && raw !== null ? raw : {}) as { game?: unknown; first?: unknown; level?: unknown }
    game.start({
      ...(isGameId(o.game) ? { game: o.game } : {}),
      ...(o.first === 'user' || o.first === 'char' || o.first === 'random' ? { first: o.first } : {}),
      ...(o.level === 'easy' || o.level === 'normal' || o.level === 'hard' ? { level: o.level } : {})
    })
  })
  ipcMain.on(IPC.gameStop, () => game.stop())
  // --- 追いかけ(機能 Mod) ---
  ipcMain.handle(IPC.chaseGet, () => chase.view())
  ipcMain.handle(IPC.chaseSave, (_e, raw: unknown) => chase.save(raw))
  // --- 音声合成 ---
  ipcMain.handle(IPC.ttsConfig, () => tts.config())
  ipcMain.handle(IPC.ttsSynthesize, async (_e, text: unknown): Promise<TtsSynthResult> => {
    if (typeof text !== 'string' || text.length > 2000) return { ok: false, message: '読み上げる文が不正です' }
    try {
      return { ok: true, wav: await tts.synthesize(text) }
    } catch (e) {
      return { ok: false, message: e instanceof TtsError ? e.message : `音声合成に失敗しました: ${e instanceof Error ? e.message : String(e)}` }
    }
  })
  ipcMain.handle(IPC.ttsSpeakers, () => tts.speakers())
  ipcMain.handle(IPC.ttsPickEngine, () => {
    app.focus({ steal: true })
    const paths = dialog.showOpenDialogSync({
      title: process.platform === 'darwin' ? 'VOICEVOX を選択(VOICEVOX.app、またはエンジンの実行ファイル)' : 'VOICEVOX を選択(VOICEVOX.exe、またはエンジンの run.exe)',
      properties: process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openFile'],
      filters: process.platform === 'win32' ? [{ name: '実行ファイル', extensions: ['exe', 'bat', 'cmd'] }] : []
    })
    if (!paths || paths.length === 0) return null
    store.update((s) => {
      s.tts.enginePath = paths[0]
    })
    return paths[0]
  })
  ipcMain.handle(IPC.ttsStartEngine, () => ttsEngine.ensure(60_000))
  // --- キャラクター ---
  ipcMain.handle(IPC.characterActive, () => book.change())
  ipcMain.handle(IPC.characterSwitch, (_e, id: unknown) => {
    const r = switchCharacter(String(id))
    return characterResult(r.ok, r.message)
  })
  ipcMain.handle(IPC.characterAdd, () => {
    const path = pickVrmPathSync()
    if (!path) return characterResult(false, '')
    const file = readModelFileSync(path)
    if (!file) return characterResult(false, 'モデルを読み込めませんでした')
    const existing = book.list().find((c) => c.modelPath === path)
    const c = existing ?? book.add(nameFromModelPath(path), path)
    book.setActive(c.id)
    character?.sendModel(file)
    return characterResult(true, existing ? `「${c.name}」は登録済みなので、切り替えました` : `「${c.name}」を登録しました`)
  })
  ipcMain.handle(IPC.characterDuplicate, (_e, id: unknown) => {
    const c = book.duplicate(String(id))
    return c ? characterResult(true, `「${c.name}」を作りました`) : characterResult(false, 'キャラが見つかりません')
  })
  ipcMain.handle(IPC.characterRemove, (_e, id: unknown) => {
    const target = book.list().find((c) => c.id === id)
    if (!target) return characterResult(false, 'キャラが見つかりません')
    if (book.list().length <= 1) return characterResult(false, '最後の1人は削除できません')
    app.focus({ steal: true })
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      message: `キャラ「${target.name}」を削除します`,
      detail: '名前・口調・性格の設定が消えます。会話の履歴とモデルのファイルは残ります。',
      buttons: ['削除', 'キャンセル'],
      defaultId: 1,
      cancelId: 1
    })
    if (choice !== 0) return characterResult(false, '')
    const wasActive = book.active().id === target.id
    book.remove(target.id)
    if (wasActive) switchCharacter(book.active().id) // 先頭のキャラのモデルを表示する
    return characterResult(true, `「${target.name}」を削除しました`)
  })
  ipcMain.handle(IPC.characterEdit, (_e, id: unknown, raw: unknown) => {
    const parsed = CharacterEditSchema.safeParse(raw)
    if (!parsed.success) return characterResult(false, '入力の形式が正しくありません')
    if (parsed.data.name !== undefined && normalizeCharacterName(parsed.data.name) === null) {
      return characterResult(false, '名前は、1〜40文字で入力してください')
    }
    return book.edit(String(id), parsed.data) ? characterResult(true, '') : characterResult(false, 'キャラが見つかりません')
  })
  ipcMain.handle(IPC.characterChangeModel, (_e, id: unknown) => {
    const target = book.list().find((c) => c.id === id)
    if (!target) return characterResult(false, 'キャラが見つかりません')
    const path = pickVrmPathSync()
    if (!path) return characterResult(false, '')
    const file = readModelFileSync(path)
    if (!file) return characterResult(false, 'モデルを読み込めませんでした')
    book.setModelPath(target.id, path)
    if (book.active().id === target.id) character?.sendModel(file)
    return characterResult(true, 'モデルを変更しました')
  })
  ipcMain.handle(IPC.settingsGet, () => chat.view())
  ipcMain.handle(IPC.settingsUpdate, (_e, raw: unknown) => {
    // レンダラーからの入力は必ず検証してから反映する
    const parsed = SettingsPatchSchema.safeParse(raw)
    if (!parsed.success) return { view: chat.view(), errors: ['設定の形式が正しくありません'] }
    const result = chat.update(parsed.data)
    if (parsed.data.tts) void ttsEngine.ensure(60_000) // 自動起動・方式・接続先が変わったので、必要なら、起動する
    return result
  })
  ipcMain.on(IPC.panelToggle, () => togglePanel())
  ipcMain.on(IPC.panelClose, () => {
    panel.hide()
    refreshTray()
  })
  ipcMain.on(IPC.showContextMenu, () => {
    if (character) Menu.buildFromTemplate(menuTemplate()).popup({ window: character.win })
  })
}

void app.whenReady().then(() => {
  store = new SettingsStore()
  // PMX は、公式の機能 Mod「MMD 対応」が ON のときだけ、読み込み・配信する
  const mmdOn = (): boolean => store.get().mods.features.includes('mmd')
  setPmxGate(mmdOn)
  // PMX を配信するのは、MMD 対応 Mod(キャラのモデル)か、PMX インポーター Mod(小道具)が ON のとき
  handleModelScheme(() => mmdOn() || store.get().mods.features.includes('pmx-import'))
  profileStore = new ProfileStore()
  panel = new PanelWindow(() => character!.win.getBounds())
  overlay = new OverlayWindows(() => character?.win.getBounds() ?? null)
  overlayEffects = new OverlayEffectStore(join(app.getPath('userData'), 'overlay-effects'))
  adjust = new AdjustHub(profileStore, () => character?.win, () => panel.window)
  worker = new WorkerHost(spawnLlmWorker)
  models = new ModelManager(store, resourcePath('models.json'))
  historyStore = new HistoryStore(join(app.getPath('userData'), 'history'))
  rulesStore = new RulesStore()
  book = new CharacterBook(store, (change) => {
    // キャラが変わったことを、全ウィンドウ(キャラ・設定)へ知らせて、メニューも更新する
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.characterChanged, change)
    refreshTray()
  })
  ttsEngine = new TtsEngineLauncher(store)
  sound = new SoundController(store, () => character?.win.webContents, () => packs.bgmPaths())
  beautify = new BeautifyController(store)
  chase = new ChaseController(store, () => character?.win)
  const fxBounds = (): Electron.Rectangle | null => character?.win.getBounds() ?? null
  move = new MoveController(store, () => character, () => game?.state().active ?? false, { from: new OverlayWindows(fxBounds), to: new OverlayWindows(fxBounds) })
  moveArea = new MoveAreaWindow(() => windowSizeForScale(store.get().display.scale))
  gameWindow = new GameWindow(() => character!.win.getBounds())
  game = new GameController(store, () => character?.win, gameWindow)
  chase.sync() // Mod が ON のとき、カーソルの読み取りを始める
  move.sync() // Mod が ON で、自動で歩き回る設定なら、自動の移動を始める
  tts = new TtsService(store, book, () => ttsEngine.beforeUse())
  void ttsEngine.ensure(60_000) // 自動起動が ON なら、起動時に、エンジンを起動しておく(待たずに、背景で)
  charStates = new CharStateStore()
  motionMeta = new MotionMetaStore()
  packs = new PackStore(
    store,
    { official: resourcePath('mods/official'), community: join(app.getPath('userData'), 'mods', 'community'), individual: join(app.getPath('userData'), 'mods', 'individual') },
    join(app.getPath('userData'), 'motions-converted')
  )
  // スクリプト Mod の実行環境(「開発者向け」が ON で、ON にした Mod だけ。窓は、使うときに作り、しばらく使わなければ終了する)
  scriptLauncher = new ScriptLauncher(store, (modId, message) => scripts?.note(modId, message))
  scripts = new ScriptHost({
    mods: () => packs.scriptMods(),
    beforeHttp: (mod, url) => scriptLauncher.beforeHttp(mod, url).then(() => undefined),
    storageDir: join(app.getPath('userData'), 'mod-storage'),
    setting: (mod, name) => readModSetting(store, mod.spec, mod.id, name),
    extraOrigins: (mod) => mod.spec.permissions.networkFrom.flatMap((n) => effectiveOrigins(store.get().mods.modSettings[mod.id]?.[n], store.get().mods.approvedOrigins[mod.id] ?? [])),
    effects: {
      say: (text) => character?.win.webContents.send(IPC.scriptSay, text),
      askAi: (_modId, instruction, save) => character?.win.webContents.send(IPC.scriptAsk, { instruction, save }),
      playMotion: (name) => character?.win.webContents.send(IPC.motionPreviewRun, { name, loop: false }),
      emit: (modId, name) => character?.win.webContents.send(IPC.scriptEvent, { modId, name }),
      addMotion: addScriptMotion,
      removeMotion: removeScriptMotion,
      uiListSet: (modId, list) => modLists.setList(modId, list)
    }
  })
  scripts.registerIpc()
  modLists = new ModListWindows({
    store,
    characterBounds: () => character?.win.getBounds() ?? null,
    mods: modListMods,
    dir: join(app.getPath('userData'), 'mod-ui'),
    deliver: (modId, itemId) => void scripts.deliverUiSelect(modId, itemId),
    openExternal: (url) => void shell.openExternal(url),
    onChange: () => {
      refreshTray()
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.packsChanged) // 設定画面の「窓を表示する」の表示を更新する
    }
  })
  modLists.registerIpc()
  // 旧形式のモーショングループが、rules.yaml に残っていれば、モーションのタグへ変換する(元のファイルは rules.yaml.groups.bak に残す)
  applyLegacyGroups(rulesStore.migrateLegacyGroups())
  migrateMods()
  packs.migrateToOptIn(store.existed)
  chat = new ChatService(store, (channel, payload) => character?.win.webContents.send(channel, payload), models, worker, historyStore, book, (states) => [...packs.promptLayers(states, book.active().id), ...contextLayers(scripts.contextEntries())])
  // ダウンロードの進捗を、設定ウィンドウ(開いていれば)へ流す
  models.onDownloadStatus(() => {
    void models.view().then((view) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w !== character?.win) w.webContents.send(IPC.modelsProgress, view)
    })
  })
  registerIpc()
  registerResetShortcut()
  character = new CharacterWindow(
    store,
    () => {
      // キャラを隠したらパネルも隠す(再表示はメニューから)
      if (!character?.visible) panel.hide()
      refreshTray()
      broadcastBasic()
    },
    () => {
      panel.follow()
      gameWindow.follow()
      modLists?.follow()
      overlay.followCharacter()
    }
  )
  createTray()
  modLists.sync() // 前回、出していた一覧窓を、出す
  // モデルが 1 つも登録されていないとき(初回など)は、設定の「キャラクター」を開いて、モデルの登録へ誘導する(モデルは同梱しない)
  if (book.active().modelPath === null) setTimeout(() => openSettingsWindow(), 800)
  app.on('activate', () => {
    // Dockアイコンのクリックで再表示
    if (character && !character.visible) character.toggleVisible()
    else if (BrowserWindow.getAllWindows().length === 0) openSettingsWindow()
  })
})

app.on('second-instance', () => {
  if (character && !character.visible) character.toggleVisible()
})

// トレイ常駐: ウィンドウを閉じても終了しない
app.on('window-all-closed', () => {})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  overlay?.hide()
})

app.on('before-quit', () => {
  modLists?.markQuitting()
  scripts?.stopAll()
  ttsEngine?.stop() // VMaid が起動した音声合成エンジンは、終了時に止める
  scriptLauncher?.stopAll() // スクリプト Mod が起動した外部ツールも、終了時に止める
  worker?.dispose()
  store?.flush()
  motionMeta?.flush()
  adjust?.flush()
})
