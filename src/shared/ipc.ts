// IPC契約。チャンネル名と型はここに集約し、main / preload / renderer で共有する(Electron非依存)
import type { AdjustApply, AdjustSnapshot } from './adjust'
import type { Rect } from './geometry'
import type { RuleValue } from './rules/effective'
import type { TalkPatch, TalkView } from './talk/gate'
import type { MoveAreaInit } from './moveArea'
import type { HistoryActionResult, HistoryExportFormat, HistoryList, HistoryListRequest, HistoryView } from './historyApi'
import type { ChatPrep, ModelsActionResult, ModelsView } from './modelsApi'
import type { ModExportInfo, ModExportRequest, ModExportResult, ModsView } from './modsApi'
import type { ModListState } from './modListApi'
import type { OverlayEffectInfo, OverlayEffectResult, OverlayPayload } from './overlay'
import type { PropSpec } from './packs/manifest'
import type { PropPayload } from './props/formats'
import type { HttpLogEntry } from './scripts/gate'
import type { PackActionResult, PacksView } from './packsApi'
import type { RuleSet } from './rules/types'
import type { SpeakerStyle } from './tts/voicevox'
import type { TtsConfig } from './ttsApi'
import type { SePatch, SeView } from './sound'
import type { DanceEntry } from './dance'
import type { BeautifyPatch, BeautifyView } from './beautify'
import type { ChasePatch, ChaseView } from './chase'
import type { VmdImportPatch, VmdImportView } from './vmdImport'
import type { BubblePatchInput, BubbleView } from './bubble'
import type { MoveMessage, MoveMode, MovePatch, MoveTarget, MoveView } from './move'
import type { CustomTouchPart } from './touch/parts'
import type { BasicPatch, BasicResult, BasicView } from './basic'
import type { PlaybackInfo } from './motions/playback'
import type { GameEvent, GamePatch, GameStartOptions, GameState, GameView } from './game/types'
import type { GameMove } from './game/engine'
import type {
  CharacterActionResult,
  CharacterChange,
  CharacterEdit,
  LlmTestResult,
  SettingsPatch,
  SettingsUpdateResult,
  SettingsView
} from './settingsApi'

/** 設定画面からの試し再生の要求 */
export type AudioPreview = { kind: 'sound'; name: string } | { kind: 'dance'; entry: DanceEntry }

export const IPC = {
  appInfo: 'app:info',
  // キャラウィンドウ → main
  modelLast: 'model:last',
  modelLoaded: 'model:loaded',
  dragStart: 'window:drag-start',
  dragMove: 'window:drag-move',
  dragEnd: 'window:drag-end',
  setScale: 'window:set-scale',
  setIgnoreMouse: 'window:set-ignore-mouse',
  showContextMenu: 'menu:context',
  getDisplay: 'display:get',
  motionList: 'motion:list',
  motionData: 'motion:data',
  motionFacesAdd: 'motion:faces-add',
  motionFacesClear: 'motion:faces-clear',
  motionVmdReport: 'motion:vmd-report',
  moveTo: 'move:to',
  moveStop: 'move:stop',
  moveState: 'move:state',
  moveBusy: 'move:busy',
  moveGet: 'move:get',
  moveSave: 'move:save',
  moveFxPreview: 'move:fx-preview',
  moveAreaOpen: 'move-area:open',
  moveAreaInit: 'move-area:init',
  moveAreaChange: 'move-area:change',
  moveAreaFinish: 'move-area:finish',
  moveAreaRects: 'move-area:rects',
  chatAsk: 'chat:ask',
  talkGet: 'talk:get',
  talkSave: 'talk:save',
  talkChanged: 'talk:changed',
  bubbleGet: 'bubble:get',
  bubbleSave: 'bubble:save',
  bubbleChanged: 'bubble:changed',
  vmdImportGet: 'vmd-import:get',
  vmdImportSave: 'vmd-import:save',
  profileGet: 'profile:get',
  adjustPublish: 'adjust:publish',
  adjustGet: 'adjust:get',
  adjustSet: 'adjust:set',
  adjustReset: 'adjust:reset',
  adjustOrientation: 'adjust:orientation',
  presetSave: 'adjust:preset-save',
  presetDelete: 'adjust:preset-delete',
  presetApply: 'adjust:preset-apply',
  presetRevert: 'adjust:preset-revert',
  presetSetDefault: 'adjust:preset-default',
  lookReset: 'adjust:look-reset',
  chatSend: 'chat:send',
  windowFocus: 'window:focus',
  settingsOpen: 'settings:open',
  chatAbort: 'chat:abort',
  chatTest: 'chat:test',
  chatPrepare: 'chat:prepare',
  motionsView: 'motions:view',
  motionsAddFiles: 'motions:add-files',
  motionsAddFolder: 'motions:add-folder',
  motionsSetIdle: 'motions:set-idle',
  motionsRemove: 'motions:remove',
  motionsRemoveMany: 'motions:remove-many',
  motionsEditTags: 'motions:edit-tags',
  motionsRenameTag: 'motions:rename-tag',
  motionsDeleteTag: 'motions:delete-tag',
  motionsSetMaxImport: 'motions:set-max-import',
  motionsImportProgress: 'motions:import-progress',
  motionsRename: 'motions:rename',
  rulesGet: 'rules:get',
  rulesSave: 'rules:save',
  rulesReset: 'rules:reset',
  rulesTestFire: 'rules:test-fire',
  rulesExport: 'rules:export',
  rulesImport: 'rules:import',
  historyView: 'history:view',
  historyClear: 'history:clear',
  historyDeleteOlder: 'history:delete-older',
  historyList: 'history:list',
  historyDeleteKeys: 'history:delete-keys',
  historyDeleteLast: 'history:delete-last',
  historyExport: 'history:export',
  modelsList: 'models:list',
  modelsDownload: 'models:download',
  modelsCancel: 'models:cancel',
  modelsDelete: 'models:delete',
  modelsSelect: 'models:select',
  modelsPickCustom: 'models:pick-custom',
  modelsClearCustom: 'models:clear-custom',
  packsView: 'packs:view',
  packsSetEnabled: 'packs:set-enabled',
  packsSetRuleEnabled: 'packs:set-rule-enabled',
  packsOpenFolder: 'packs:open-folder',
  packsExport: 'packs:export',
  packsImport: 'packs:import',
  packsRuleSet: 'packs:ruleset',
  packsRuleSetAll: 'packs:ruleset-all',
  packsPropData: 'packs:prop-data',
  packsChanged: 'packs:changed',
  packsTouchParts: 'packs:touch-parts',
  modsView: 'mods:view',
  modsSetFeature: 'mods:set-feature',
  modsSetDeveloper: 'mods:set-developer',
  modsChanged: 'mods:changed',
  modsSetSlot: 'mods:set-slot',
  modsSetRuleValue: 'mods:set-rule-value',
  modsSetUiWindow: 'mods:set-ui-window',
  modListGet: 'modlist:get',
  modListChanged: 'modlist:changed',
  modListSelect: 'modlist:select',
  modListOpen: 'modlist:open',
  modListClose: 'modlist:close',
  modListFollow: 'modlist:follow',
  modsSetSetting: 'mods:set-setting',
  modsLauncherPick: 'mods:launcher-pick',
  modsLauncherStart: 'mods:launcher-start',
  characterReset: 'character:reset',
  basicGet: 'basic:get',
  basicSet: 'basic:set',
  basicReset: 'basic:reset',
  basicUndoReset: 'basic:undo-reset',
  basicChanged: 'basic:changed',
  characterRestore: 'character:restore',
  /** 画面効果: キャラ窓 → main(出す・消す)、main → 画面効果の窓(描く) */
  overlayShow: 'overlay:show',
  overlayHide: 'overlay:hide',
  overlayEffects: 'overlay:effects',
  overlayEffectSave: 'overlay:effect-save',
  overlayEffectDelete: 'overlay:effect-delete',
  overlayEffectPreview: 'overlay:effect-preview',
  scriptRunAction: 'script:run-action',
  scriptLogs: 'script:logs',
  scriptSay: 'script:say',
  scriptAsk: 'script:ask',
  scriptEvent: 'script:event',
  modsExportInfo: 'mods:export-info',
  modsExport: 'mods:export',
  charStateGet: 'char-state:get',
  charStateSave: 'char-state:save',
  ttsConfig: 'tts:config',
  ttsSynthesize: 'tts:synthesize',
  ttsSpeakers: 'tts:speakers',
  ttsPickEngine: 'tts:pick-engine',
  ttsStartEngine: 'tts:start-engine',
  soundGet: 'sound:get',
  soundSave: 'sound:save',
  soundChanged: 'sound:changed',
  audioPick: 'audio:pick',
  audioRead: 'audio:read',
  audioPreview: 'audio:preview',
  audioPreviewRun: 'audio:preview-run',
  beautifyGet: 'beautify:get',
  beautifySave: 'beautify:save',
  beautifyChanged: 'beautify:changed',
  gameGet: 'game:get',
  gameSave: 'game:save',
  gameStateGet: 'game:state-get',
  gameState: 'game:state',
  gameMove: 'game:move',
  gameStart: 'game:start',
  gameStop: 'game:stop',
  gameEvent: 'game:event',
  chaseGet: 'chase:get',
  chaseSave: 'chase:save',
  chaseChanged: 'chase:changed',
  chaseCursor: 'chase:cursor',
  characterSwitch: 'character:switch',
  characterAdd: 'character:add',
  characterDuplicate: 'character:duplicate',
  characterRemove: 'character:remove',
  characterEdit: 'character:edit',
  characterChangeModel: 'character:change-model',
  characterActive: 'character:active',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  panelToggle: 'panel:toggle',
  panelClose: 'panel:close',
  // main → キャラウィンドウ
  modelLoad: 'model:load',
  displayChanged: 'display:changed',
  motionChanged: 'motion:changed',
  rulesChanged: 'rules:changed',
  characterChanged: 'character:changed',
  rulesTestFireRun: 'rules:test-fire-run',
  motionsPreview: 'motions:preview',
  motionPreviewRun: 'motions:preview-run',
  motionsStop: 'motions:stop',
  motionStopRun: 'motions:stop-run',
  motionRefs: 'motions:refs',
  motionProgress: 'motions:progress',
  motionSeek: 'motions:seek',
  motionSeekRun: 'motions:seek-run',
  motionPause: 'motions:pause',
  motionPauseRun: 'motions:pause-run',
  previewWinOpen: 'preview-win:open',
  previewWinPlay: 'preview-win:play',
  previewWinReady: 'preview-win:ready',
  chatPrep: 'chat:prep',
  modelsProgress: 'models:progress',
  chatChunk: 'chat:chunk',
  chatEmotion: 'chat:emotion',
  chatPose: 'chat:pose',
  chatDone: 'chat:done',
  chatError: 'chat:error',
  adjustApply: 'adjust:apply',
  adjustResetAll: 'adjust:reset-all',
  adjustApplyAll: 'adjust:apply-all',
  adjustSnapshot: 'adjust:snapshot'
} as const

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
}

export interface ModelFile {
  /** vrm = glTF の VRM(data に中身)、pmx = MMD のモデル(MMD 対応 Mod。data は空で、url から読む) */
  kind: 'vrm' | 'pmx'
  /** PMX を読む専用プロトコルの URL(`vmaid-model://…`)。VRM には無い */
  url?: string
  path: string
  name: string
  /** ファイル内容のSHA-256(16進)。モデルごとの調整プロファイルの識別に使う */
  hash: string
  data: Uint8Array
}

export interface DisplayState {
  scale: number
  clickThrough: boolean
}

export interface MotionFile {
  name: string
  data: Uint8Array
}

/**
 * 使えるモーションの名前の一覧(内蔵・パック・登録)と、待機ループに使う名前。
 * 中身(VRMA)は含めない: 数百〜数千件を毎回送ると重いので、再生するときに getMotionData で1件ずつ読む
 */
export interface MotionState {
  names: string[]
  /** モーション名 → 実効のタグ(タグが1つ以上あるものだけ)。ルールの「タグから選ぶ」再生に使う */
  tags: Record<string, string[]>
  idle: string | null
  /** 足の接地補正を使うか */
  footLock: boolean
  /** names のうち、VMD(MMD のモーション)のもの。MMD のモデルで再生する。VMD 以外(VRMA)は、VRM のモデルだけで再生する */
  vmd: string[]
  /** MMD 対応が ON か(ON なら、VRM のモデルも、VMD を VRMA へ変換して再生できる) */
  vmdToVrm: boolean
}

/** 返答の完了通知。aborted は中断された場合 */
export interface ChatDone {
  text: string
  aborted: boolean
}

/** ルールファイル(YAML)の内容 */
export interface RulesFile {
  text: string
  /** ファイルの場所(表示用) */
  path: string
}

/** ルールの取り込み結果。errors があれば、取り込み元ファイルの検証エラー */
export interface RulesImportResult {
  ok: boolean
  message: string
  errors?: string[]
}

export type RulesSaveResult = { ok: true; file: RulesFile } | { ok: false; errors: string[] }

/** モーションの出どころ。同じ名前があれば、登録 > パック > 内蔵 の順で優先される */
export type MotionOrigin = 'builtin' | 'pack' | 'user'

/** 設定画面の一覧の1行 */
export interface MotionItem {
  name: string
  origin: MotionOrigin
  /** 登録したモーションの、ファイルの場所(内蔵・パックは無い) */
  path?: string
  /** VMD に足してある、表情の VMD のパス */
  faces?: string[]
  /** 実効のタグ(最初から持つタグ + 利用者が付けたタグ) */
  tags: string[]
  /** 最初から持っていて、外せないタグ(内蔵・パックのもの) */
  lockedTags: string[]
}

/** 設定画面のモーションタブ用: 使えるモーションの一覧(内蔵・パック・登録) */
export interface MotionsView {
  items: MotionItem[]
  idle: string | null
  footLock: boolean
  /** 1回の取り込みで検査する件数の上限。0 なら無制限 */
  maxImportFiles: number
}

/** 取り込み時のオプション */
export interface MotionImportOptions {
  /** 取り込んだすべてのモーションに付けるタグ */
  tags: string[]
  /** サブフォルダ名(フォルダ取り込み)・ファイルがあるフォルダ名(ファイル取り込み)もタグにする */
  tagFromFolders: boolean
}

/** 取り込み中の進捗(main → 設定ウィンドウ) */
export interface MotionImportProgress {
  done: number
  total: number
}

/** タグの編集。names のモーションに対して、add を足し、remove を外す(set があれば、入れ替える) */
export interface MotionTagEdit {
  names: string[]
  add?: string[]
  remove?: string[]
  set?: string[]
}

/** 取り込みの結果。picked が false ならキャンセル */
export interface MotionImportResult {
  picked: boolean
  message: string
  added: number
  /** 登録済みだったので飛ばした数 */
  duplicates: number
  rejected: Array<{ path: string; reason: string }>
  /** 利用者に伝えたい注意(BVH の変換で無視した関節など) */
  notes: string[]
  view: MotionsView
}

export type TtsSynthResult = { ok: true; wav: Uint8Array | null } | { ok: false; message: string }

export interface VMaidApi {
  getAppInfo(): Promise<AppInfo>
  getLastModel(): Promise<ModelFile | null>
  notifyModelLoaded(path: string): void
  dragStart(): void
  /** ドラッグ開始位置からの画面上の移動量(DIP) */
  dragMove(dx: number, dy: number): void
  dragEnd(): void
  setScale(scale: number): void
  setIgnoreMouse(ignore: boolean): void
  showContextMenu(): void
  getDisplay(): Promise<DisplayState>
  getMotions(): Promise<MotionState>
  /** モーション1件の VRMA の中身。無い・読めなければ null */
  /** vrm: VRM のモデル用に(VMD は、変換した VRMA を返す)。省略なら、登録したそのままの中身 */
  getMotionData(name: string, opts?: { vrm?: boolean }): Promise<Uint8Array | null>
  /** VMD のモーションに、表情の VMD を足す(ファイルを選ぶ)・外す */
  addMotionFaces(name: string): Promise<{ ok: boolean; message: string; view: MotionsView }>
  clearMotionFaces(name: string): Promise<MotionsView>
  /** VMD のモーションの、変換の結果(使った表情・警告) */
  getVmdReport(name: string): Promise<{ ok: boolean; lines: string[] }>
  /** 移動(機能 Mod「より自由な移動」): 歩く・ワープする。やめる。状態の通知(キャラ窓用)。会話中かを知らせる(自動の移動を控える) */
  moveTo(target: MoveTarget, mode: MoveMode): void
  stopMove(): void
  onMoveState(cb: (msg: MoveMessage) => void): () => void
  setMoveBusy(busy: boolean): void
  getMove(): Promise<MoveView>
  saveMove(patch: MovePatch): Promise<MoveView>
  /** ワープの演出だけ、いまの窓の位置に出して見る */
  previewMoveFx(): void
  /** 移動範囲を画面上で決める窓を開く。閉じたら(確定でも取り消しでも)、そのときの設定が返る */
  openMoveArea(): Promise<MoveView>
  /** 範囲の窓用: 起動時の情報・矩形の変更・確定(true)/取り消し(false)・他の窓での変更の通知 */
  moveAreaInit(): Promise<MoveAreaInit | null>
  moveAreaChange(rects: Rect[]): void
  moveAreaFinish(save: boolean): void
  onMoveAreaRects(cb: (rects: Rect[]) => void): () => void
  /** 話しかけ控えの設定(Mod「話しかけ」)。変わったら、キャラ窓・設定へ通知する */
  /** 裏の指示(ルールの「AI に頼んで言う」): 返答だけが、通常の返答と同じ経路で届く。ユーザーの会話中なら、何もしない */
  askAi(instruction: string, opts: { states?: string[]; save: boolean }): void
  getTalk(): Promise<TalkView>
  saveTalk(patch: TalkPatch): Promise<TalkView>
  onTalkChanged(cb: (view: TalkView) => void): () => void
  getBubble(): Promise<BubbleView>
  saveBubble(patch: BubblePatchInput): Promise<BubbleView>
  onBubbleChanged(cb: (view: BubbleView) => void): () => void
  getVmdImport(): Promise<VmdImportView>
  saveVmdImport(patch: VmdImportPatch): Promise<VmdImportView>
  // --- キャラ調整(キャラウィンドウ側) ---
  /** 保存済みプロファイルの生データ(なければ null)。検証は項目一覧を持つ側で sanitizeProfile する */
  getProfile(hash: string): Promise<unknown>
  publishAdjust(snapshot: AdjustSnapshot | null): void
  onAdjustApply(cb: (msg: AdjustApply) => void): () => void
  onAdjustResetAll(cb: () => void): () => void
  /** 調整の値をまとめて入れ替える(セットの適用・元に戻す) */
  onAdjustApplyAll(cb: (values: Record<string, number>) => void): () => void
  // --- キャラ調整(パネル側) ---
  getAdjust(): Promise<AdjustSnapshot | null>
  setAdjust(key: string, value: number): void
  resetAdjust(): void
  /** キャラの向き(左右 yaw・上下 pitch。度)をモデルのプロファイルに保存する */
  saveOrientation(yaw: number, pitch: number): void
  /** いまの調整を、名前をつけて保存する(このモデルのセット) */
  savePreset(name: string): Promise<{ ok: boolean; message: string }>
  deletePreset(name: string): Promise<{ ok: boolean; message: string }>
  /**
   * 保存したセットを適用する。パネルの「呼び出す」は基準値として保存される。transient なら、基準値は変えず、レイヤーとして重ねる(mode: overlay=変えた項目だけ重ねる / replace=状態まるごと置き換え。source=適用した Mod) */
  applyPreset(name: string, opts?: { transient?: boolean; revertAfterSec?: number; mode?: 'overlay' | 'replace'; source?: string | null }): Promise<{ ok: boolean; message: string }>
  /** 重ねているセットを外す(name=そのセット、source=その Mod が重ねたもの、指定なし=すべて) */
  revertPreset(filter?: { name?: string; source?: string }): void
  /** セットを「標準」に決める(null で解除)。見た目は変えない */
  setDefaultPreset(name: string | null): Promise<{ ok: boolean; message: string }>
  /** 標準の表情・衣装に戻す(重ねたセットを外し、標準のセットを基準値にする) */
  resetLook(): void
  onAdjustSnapshot(cb: (snapshot: AdjustSnapshot | null) => void): () => void
  togglePanel(): void
  closePanel(): void
  // --- 会話(キャラウィンドウ側) ---
  openSettings(): void
  /** 入力欄を開くとき、キーボードフォーカスをこのウィンドウに移す */
  focusWindow(): void
  /** states: いま続いている状態の名前(Mod の、状態のときだけ足す指示文に使う) */
  sendChat(text: string, states?: string[]): void
  /** 入力欄を開いたとき。内蔵LLMなら、入力している間にモデルを先に読み込んでおく(待ち時間を隠す) */
  prepareChat(): void
  onChatPrep(cb: (prep: ChatPrep | null) => void): () => void
  abortChat(): void
  onChatChunk(cb: (delta: string) => void): () => void
  /** AI の返答に付いていた感情タグ(`[emotion:名前]` の名前)。Mod「状態と感情」が ON のときだけ届く */
  onChatEmotion(cb: (emotion: string) => void): () => void
  /** AI の返答に付いていた動きの指定(`[pose:動きの説明]` の説明)。ルール(トリガー「AI が動きを指定したとき」)へ渡す */
  onChatPose(cb: (pose: string) => void): () => void
  onChatDone(cb: (done: ChatDone) => void): () => void
  onChatError(cb: (message: string) => void): () => void
  // --- 設定(設定ウィンドウ側) ---
  getSettings(): Promise<SettingsView>
  updateSettings(patch: SettingsPatch): Promise<SettingsUpdateResult>
  testLlm(): Promise<LlmTestResult>
  // --- パック(ルール+モーショングループ+モーションのまとまり。配布用 / 私用) ---
  getPacks(): Promise<PacksView>
  setPackEnabled(id: string, enabled: boolean): Promise<PacksView>
  /** Mod のルールを 1 つずつ ON/OFF する */
  setModRuleEnabled(ruleId: string, enabled: boolean): Promise<PacksView>
  openPacksFolder(): void
  /** 私用パックを .vmaidpack に書き出す(自分の別のPCへ移す用) */
  exportPack(id: string): Promise<PackActionResult>
  /** .vmaidpack を、私用パックとして取り込む */
  importPack(): Promise<PackActionResult>
  /** 有効なパックのルール・グループ(名前空間つき)。ユーザーのルールとは別の層 */
  getPackRuleSet(): Promise<RuleSet>
  /** ON の Mod のルールすべて(個別に OFF にしたものも含む)。ルールタブの一覧用 */
  getPackRuleSetAll(): Promise<RuleSet>
  /** 小道具(glb)の中身と設定。有効な Mod の `<Mod の id>/<id>` だけ。無ければ null */
  getPropData(id: string): Promise<{ payload: PropPayload; spec: PropSpec } | null>
  /** 有効な Mod が宣言した、触れ合いの部位(機能 Mod「高度な触れ合い」が OFF なら空)。Mod・パックが変わったら、取り直す */
  getTouchParts(): Promise<CustomTouchPart[]>
  onPacksChanged(cb: () => void): () => void
  // --- Mod(公式の機能 Mod の ON/OFF) ---
  getMods(): Promise<ModsView>
  setFeatureMod(id: string, enabled: boolean): Promise<ModsView>
  setDeveloperMode(enabled: boolean): Promise<ModsView>
  /** スクリプト Mod の設定項目の値を保存する(secret は暗号化)。空なら解除。結果の message が空なら成功。更新後の Mod 一覧つき */
  setModSetting(modId: string, name: string, value: string): Promise<{ message: string; view: PacksView }>
  /** 外部ツール(launcher)の実行ファイルを、ファイル選択ダイアログで選ぶ。キャンセルなら message が空で、変更なし */
  pickModLauncher(modId: string): Promise<{ message: string; view: PacksView }>
  /** 外部ツール(launcher)を起動して、接続できるまで待つ(すでに起動していれば、何もしない) */
  startModLauncher(modId: string): Promise<{ ok: boolean; message: string }>
  /** スクリプト Mod のアクションを、スクリプトに渡す(ルールが実行したとき)。完了は待たない */
  runScriptAction(modId: string, action: string, params: Record<string, unknown>): void
  /** スクリプト Mod のログと通信ログ(設定画面の Mod の詳細で見せる) */
  getScriptLogs(modId: string): Promise<{ log: string[]; http: HttpLogEntry[]; running: boolean }>
  /** スクリプト Mod が host.say で出したセリフ */
  onScriptSay(cb: (text: string) => void): () => void
  /** スクリプト Mod の host.ai.say(裏で AI に頼んで言う) */
  onScriptAsk(cb: (req: { instruction: string; save: boolean }) => void): () => void
  /** スクリプト Mod が rules.emit で起こしたイベント(ルールのトリガーに届ける) */
  onScriptEvent(cb: (event: { modId: string; name: string }) => void): () => void
  /** 基本設定(倍率・クリック透過・最前面・起動時の表示・リセットのショートカット)の取得・更新。不正な値・登録できないショートカットは、error で返る */
  getBasic(): Promise<BasicView>
  setBasic(patch: BasicPatch): Promise<BasicResult>
  /** 基本設定が変わった(メニュー・ホイール・リセット・別の窓での変更。設定ウィンドウが、表示を追従させる) */
  onBasicChanged(cb: (view: BasicView) => void): () => void
  /** 緊急リセット: キャラを、初期の表示に戻す(ショートカット・メニューと同じ) */
  resetCharacter(): void
  /** リセットが行われた(キャラウィンドウ側で、向き・モーション・ルールの効果を、初期に戻す) */
  onCharacterReset(cb: () => void): () => void
  /** 直前のリセットを取り消す(表示・位置・大きさ・クリック透過・向き・重ねた表情・衣装セットを、リセット前に戻す。止まった効果は、再開しない) */
  undoResetCharacter(): void
  /** リセットの取り消しが行われた(キャラウィンドウ側で、向きを戻す) */
  onCharacterRestore(cb: (orientation: { yaw: number; pitch: number }) => void): () => void
  /** 画面効果を出す・消す(キャラ窓から main へ。値は main で検証する) */
  showOverlay(req: { effect: string; intensity: number; color: string; durationSec: number; scope: string }): void
  hideOverlay(): void
  /** 画面効果の窓が受け取る(描く側) */
  onOverlayShow(cb: (payload: OverlayPayload) => void): () => void
  /** 画面効果の一覧(組み込み + 自作) */
  getOverlayEffects(): Promise<OverlayEffectInfo[]>
  /** 自作の効果を保存(名前は英小文字・数字・ハイフン。YAML は検証して、エラーなら保存しない) */
  saveOverlayEffect(name: string, yaml: string): Promise<OverlayEffectResult>
  deleteOverlayEffect(name: string): Promise<OverlayEffectResult>
  /** 保存せずに、YAML のまま数秒だけ試し表示する */
  previewOverlayEffect(yaml: string, scope: string): Promise<{ ok: boolean; message: string }>
  onOverlayHide(cb: () => void): () => void
  /** Mod のスロットの値を決める(モーション名や文。空なら解除)。更新後の Mod 一覧を返す */
  /** characterId を渡すと、そのキャラだけの値(省略 = 全キャラ共通) */
  setModSlot(modId: string, slotId: string, value: string, characterId?: string): Promise<PacksView>
  /** ルールの値の上書き(Mod の「詳しい設定」)。value が null なら、Mod が書いた値に戻す。characterId を省略すると、全キャラ共通 */
  setModRuleValue(modId: string, ruleId: string, path: string, value: RuleValue | null, characterId?: string): Promise<PacksView>
  /** 一覧窓を持つ Mod の、窓の表示・キャラへの追従を変える。更新後の Mod 一覧を返す */
  setModUiWindow(modId: string, patch: { visible?: boolean; follow?: boolean }): Promise<PacksView>
  /** (一覧窓の中から)いまの一覧と、窓の設定 */
  getModList(): Promise<ModListState>
  onModListChanged(cb: (state: ModListState) => void): () => void
  /** 見出しを選んだ(Mod のスクリプトへ届く) */
  selectModListItem(id: string): void
  /** 項目の記事を、ふだんのブラウザで開く(Mod に権限があり、項目に https の link があるときだけ) */
  openModListItem(id: string): void
  closeModList(): void
  setModListFollow(follow: boolean): void
  /** 「Mod としてエクスポート」の選択肢(自分のルール・登録したモーション) */
  getModExportInfo(): Promise<ModExportInfo>
  /** 選んだものを .vmaidmod に書き出す(保存先のダイアログを出す) */
  exportMod(req: ModExportRequest): Promise<ModExportResult>
  /** 機能 Mod の ON/OFF が変わった(全ウィンドウへ。ルールの使える種類・画面の部品が変わる) */
  onModsChanged(cb: (view: ModsView) => void): () => void
  // --- キャラの気分・親密度(使用中のキャラの分) ---
  /** 保存済みの状態の生データ(なければ null)。検証は parseCharState で行う */
  getCharState(): Promise<unknown>
  saveCharState(state: unknown): void
  // --- 音声合成 ---
  /** 読み上げの設定(有効/無効・方式・使用中のキャラの声)。読み上げのたびに取り直す */
  getTtsConfig(): Promise<TtsConfig>
  /** 1文を音声(WAV)にする(VOICEVOX 互換)。通信は main が行う。読み上げるものが無ければ wav は null */
  ttsSynthesize(text: string): Promise<TtsSynthResult>
  /** VOICEVOX 互換エンジンの声の一覧(接続テストを兼ねる) */
  ttsSpeakers(): Promise<{ ok: boolean; message: string; speakers: SpeakerStyle[] }>
  /** 自動起動するエンジンの実行ファイルを、ファイル選択で選ぶ。選んだパス(キャンセルなら null) */
  pickTtsEngine(): Promise<string | null>
  /** エンジンを、いま起動してみる(自動起動の設定の確認)。起動して接続できるまで、最大 60 秒待つ */
  startTtsEngine(): Promise<{ ok: boolean; message: string }>
  // --- 効果音(機能 Mod)・ダンスの BGM ---
  getSound(): Promise<SeView>
  /** 設定画面から。検証して保存し、全ウィンドウへ通知する */
  saveSound(patch: SePatch): Promise<SeView>
  /** 音ファイルを、ファイル選択で選ぶ(キャンセルなら null)。保存はしない */
  pickAudioFile(): Promise<string | null>
  /** 音ファイルの中身。登録した(効果音・ダンスの表にある)ファイルだけ。それ以外・読めないときは null */
  readAudio(path: string): Promise<Uint8Array | null>
  /** 設定画面から、キャラ窓で試し再生する(効果音の名前、または、ダンスの行 = モーション + BGM) */
  previewAudio(req: AudioPreview): void
  onAudioPreview(cb: (req: AudioPreview) => void): () => void
  onSoundChanged(cb: (view: SeView) => void): () => void
  // --- 美化(機能 Mod) ---
  getBeautify(): Promise<BeautifyView>
  saveBeautify(patch: BeautifyPatch): Promise<BeautifyView>
  onBeautifyChanged(cb: (view: BeautifyView) => void): () => void
  /** ゲーム(機能 Mod): 設定の取得・保存 */
  getGame(): Promise<GameView>
  saveGame(patch: GamePatch): Promise<GameView>
  /** 盤面の窓: 盤面の状態の取得・変更の通知、マスを打つ(0〜8)、最初から、やめる */
  getGameState(): Promise<GameState>
  onGameState(cb: (state: GameState) => void): () => void
  /** ユーザーの手(盤面のクリック。マスの番号。チェスは from → to)。打てなければ、何も起きない */
  gameMove(move: GameMove): void
  startGame(opts?: GameStartOptions): void
  stopGame(): void
  /** キャラ窓: ゲームの手・結果・始まり/終わり(ルールのトリガーと、チャット入力の振り分けに使う) */
  onGameEvent(cb: (event: GameEvent) => void): () => void
  /** 追いかけ(機能 Mod): 設定の取得・保存・変更の通知 */
  getChase(): Promise<ChaseView>
  saveChase(patch: ChasePatch): Promise<ChaseView>
  onChaseChanged(cb: (view: ChaseView) => void): () => void
  /** キャラ窓: OS のカーソルの位置(x, y)と、キャラ窓の中身の左上の位置(wx, wy)。すべて画面座標 */
  onChaseCursor(cb: (c: { x: number; y: number; wx: number; wy: number }) => void): () => void
  // --- キャラクター ---
  switchCharacter(id: string): Promise<CharacterActionResult>
  /** モデル(VRM)を選んで、新しいキャラとして登録し、切り替える */
  addCharacter(): Promise<CharacterActionResult>
  duplicateCharacter(id: string): Promise<CharacterActionResult>
  removeCharacter(id: string): Promise<CharacterActionResult>
  editCharacter(id: string, patch: CharacterEdit): Promise<CharacterActionResult>
  /** このキャラのモデルを、選び直す */
  changeCharacterModel(id: string): Promise<CharacterActionResult>
  /** いま使っているキャラと、一覧(ルールの「対象キャラ」の判定・表示に使う) */
  getCharacterChange(): Promise<CharacterChange>
  onCharacterChanged(cb: (change: CharacterChange) => void): () => void
  // --- モーション(設定ウィンドウ側) ---
  getMotionsView(): Promise<MotionsView>
  addMotionFiles(opts: MotionImportOptions): Promise<MotionImportResult>
  addMotionFolder(opts: MotionImportOptions): Promise<MotionImportResult>
  /** 取り込みの進捗を受け取る(大量のとき) */
  onMotionImportProgress(cb: (p: MotionImportProgress) => void): () => void
  setIdleMotion(name: string | null): Promise<MotionsView>
  removeMotion(name: string): Promise<MotionsView>
  /** 登録を、まとめて外す(内蔵・パックのものは無視する) */
  removeMotions(names: string[]): Promise<MotionsView>
  /** タグを、まとめて足す・外す・入れ替える(内蔵・パックのモーションにも付けられる) */
  editMotionTags(edit: MotionTagEdit): Promise<MotionsView>
  /** タグの名前を、すべてのモーションで変える */
  renameMotionTag(from: string, to: string): Promise<MotionsView>
  /** タグを、すべてのモーションから外す */
  deleteMotionTag(tag: string): Promise<MotionsView>
  /** 1回の取り込みで検査する件数の上限(0 = 無制限) */
  setMaxImportFiles(n: number): Promise<MotionsView>
  /** 登録モーションの名前を変える。ルールの参照も一緒に書き換える */
  renameMotion(from: string, to: string): Promise<{ ok: boolean; message: string; view: MotionsView }>
  // --- ルール ---
  getRules(): Promise<RulesFile>
  saveRules(text: string): Promise<RulesSaveResult>
  resetRules(): Promise<RulesFile>
  /** ルールをいま実行してみる(条件は無視)。キャラに反映される */
  testFireRule(id: string): void
  /** モーションを、キャラで1回再生して試す(設定画面の一覧から) */
  previewMotion(name: string, opts?: { loop?: boolean }): void
  onMotionPreview(cb: (req: { name: string; loop?: boolean }) => void): () => void
  /** キャラで再生中のモーションを止める(再生ウィンドウの「停止」) */
  stopMotionPreview(): void
  onMotionStop(cb: () => void): () => void
  /** モーションの名前 → それを再生するルールの id(自分のルール + 有効な Mod のルール) */
  getMotionRefs(): Promise<Record<string, string[]>>
  /** キャラ窓 → main: 再生中のモーションの状態(再生をやめたら null)。main が、再生ウィンドウへ中継する */
  reportPlayback(info: PlaybackInfo | null): void
  /** 再生ウィンドウ: キャラ本体で再生中のモーションの状態 */
  onMotionProgress(cb: (info: PlaybackInfo | null) => void): () => void
  /** 再生ウィンドウ → キャラ本体: 再生位置を動かす(秒)・一時停止/再開 */
  seekMotion(sec: number): void
  setMotionPaused(paused: boolean): void
  onMotionSeek(cb: (sec: number) => void): () => void
  onMotionPause(cb: (paused: boolean) => void): () => void
  /** モーション試し再生の別窓を開く(name があれば、そのモーションを再生する)。キャラ本体は動かさない */
  openMotionPreview(name?: string): void
  /** 別窓側: 再生の要求を受け取る / 受け取れる状態になったことを知らせる */
  onPreviewPlay(cb: (name: string) => void): () => void
  previewReady(): void
  exportRules(): Promise<{ ok: boolean; message: string }>
  importRules(): Promise<RulesImportResult>
  onRulesChanged(cb: (file: RulesFile) => void): () => void
  /** キャラウィンドウ側: テスト発火の要求を受け取る */
  onRulesTestFire(cb: (ruleId: string) => void): () => void
  // --- 会話履歴(設定ウィンドウ側) ---
  getHistory(): Promise<HistoryView>
  clearHistory(): Promise<HistoryActionResult>
  deleteHistoryOlderThan(days: number): Promise<HistoryActionResult>
  /** 履歴の本文の一覧(新しい順。キャラ・言葉で絞り込み)と、選んだ記録・直近 n 件(キャラ別も)の削除 */
  listHistory(req: HistoryListRequest): Promise<HistoryList>
  deleteHistoryKeys(keys: string[]): Promise<HistoryActionResult>
  deleteHistoryLast(n: number, characterId?: string): Promise<HistoryActionResult>
  exportHistory(format: HistoryExportFormat): Promise<HistoryActionResult>
  // --- 内蔵LLMのモデル管理(設定ウィンドウ側) ---
  listModels(): Promise<ModelsView>
  downloadModel(id: string): Promise<ModelsActionResult>
  cancelDownload(): void
  deleteModel(id: string): Promise<ModelsActionResult>
  selectModel(id: string): Promise<ModelsView>
  pickCustomModel(): Promise<ModelsActionResult>
  clearCustomModel(): Promise<ModelsView>
  onModelsProgress(cb: (view: ModelsView) => void): () => void
  onModelLoad(cb: (file: ModelFile) => void): () => void
  onDisplayChanged(cb: (state: DisplayState) => void): () => void
  onMotionsChanged(cb: (state: MotionState) => void): () => void
}
