// ルールの型(検証・正規化したあとの形)。YAMLの見た目と同じ「種類キー + パラメータ」のフラットな形で持つ。

export type RuleNode = { [key: string]: unknown }

export interface Rule {
  id: string
  enabled: boolean
  when: RuleNode & { trigger: string }
  if: Array<RuleNode & { condition: string }>
  do: Array<RuleNode & { action: string }>
  /** ルールの説明(任意。人が読むためのメモ) */
  description?: string
  /** このルールが動くキャラのid(任意。無い・空なら、すべてのキャラで動く) */
  characters?: string[]
  /** ルールを整理するタグ(任意。一覧の絞り込み・一括操作に使う。動作には影響しない) */
  tags?: string[]
}

export interface RuleSet {
  version: 1
  rules: Rule[]
}

export interface RuleIssue {
  /** エラーの場所(例: rules[1].do[0].tag) */
  path: string
  message: string
  /** YAMLの行番号(1始まり。分かる場合のみ) */
  line?: number
}

/** エンジンが実行する、具体的な1つ分のアクション(タグ・乱数は解決済み) */
export type ActionRequest = (
  | {
      kind: 'playMotion'
      motion: string
      /** ループするモーションを、この秒数だけ再生する(省略=1回) */
      durationSec?: number
      /** 再生中のモーションが終わってから続ける */
      queue?: boolean
      /** 一緒に流す BGM(ダンスの楽曲の表から。モーションが実際に始まった瞬間に流れ、終わると止まる) */
      bgm?: { path: string; offsetSec: number; volume: number }
    }
  /** ゲームを始める(機能 Mod「ゲーム」)・やめる */
  | { kind: 'startGame'; game: 'tictactoe' | 'connect4' | 'reversi' | 'chess'; first: 'user' | 'char' | 'random' | 'default'; level: 'easy' | 'normal' | 'hard' | 'default' }
  | { kind: 'stopGame' }
  /** 再生中のモーションを止めて、待機に戻す(bgm が true なら、一緒に流している BGM も止める) */
  | { kind: 'stopMotion'; bgm: boolean }
  /** 効果音を鳴らす(機能 Mod「効果音」)。name は、設定で登録した名前 */
  | { kind: 'playSound'; name: string }
  | { kind: 'setExpression'; name: string; value: number; durationSec: number }
  | { kind: 'applyPreset'; name: string; revertAfterSec: number; mode: 'overlay' | 'replace' }
  | { kind: 'revertPreset'; name: string }
  /** 標準の表情・衣装に戻す */
  | { kind: 'resetLook' }
  | { kind: 'say'; text: string }
  /** 裏で AI に頼んで、返答だけをセリフとして出す(ユーザーの吹き出しは出ない) */
  | { kind: 'askAi'; instruction: string; save: boolean }
  | { kind: 'changeAffection'; delta: number }
  | { kind: 'setMood'; mood: string; durationSec: number }
  /** preset があれば、状態が続く間、その表情・衣装セットを重ねる(状態が終わると、自動で外れる) */
  | { kind: 'startState'; name: string; durationSec: number; preset?: string; presetMode?: 'overlay' | 'replace' }
  | { kind: 'endState'; name: string }
  | { kind: 'setEmotion'; name: string; value: number }
  | { kind: 'changeEmotion'; name: string; delta: number }
  /** prop は、Mod の小道具の id(`<modId>/<id>`。自分のルールなら、そのまま) */
  | { kind: 'showProp'; prop: string; durationSec: number }
  | { kind: 'hideProp'; prop: string }
  /** 画面効果(全画面の透過ウィンドウ)。値の範囲は、実行側(main)でも丸める */
  | { kind: 'showOverlay'; effect: string; scope: string; intensity: number; color: string; durationSec: number }
  | { kind: 'hideOverlay' }
  /** 移動する(機能 Mod「より自由な移動」)・移動をやめる */
  | { kind: 'moveTo'; target: 'random' | 'left' | 'right' | 'center' | 'cursor'; mode: 'walk' | 'warp' }
  | { kind: 'stopMove' }
  /** スクリプト Mod のアクション。modId の Mod のスクリプトの onAction に届く(params は、既定値を補い、変数を展開済み) */
  | { kind: 'extension'; modId: string; action: string; params: Record<string, unknown> }
) & {
  /** このアクションを出したルールの Mod の id(自分のルールには無い)。Mod を OFF にしたとき、その Mod の効果を解除するのに使う */
  source?: string
  /** 発火から、この秒数あとに実行する(wait アクションで並べたとき。省略=すぐ) */
  delaySec?: number
}

export type RuleEvent =
  | { type: 'startup' }
  /** part / side は、触った部位(判定できなければ省略) */
  | { type: 'click'; part?: string; side?: string }
  /** 返答が正常に終わった。text は、返答の本文(省略されることがある) */
  | { type: 'replyDone'; text?: string }
  /** AI が返答を考え始めた。text は、あなたが入力した文(裏の指示のときは、空) */
  | { type: 'replyStart'; text: string }
  | { type: 'userMessage'; text: string }
  /** AI の返答に、感情タグ([emotion:名前])が付いていた */
  | { type: 'llmEmotion'; emotion: string }
  /** AI の返答に、動きの指定タグ([pose:動きの説明])が付いていた */
  | { type: 'llmPose'; pose: string }
  /** スクリプト Mod が rules.emit で起こしたイベント。トリガー `<modId>/<name>` に届く */
  | { type: 'modEvent'; modId: string; name: string }
  /** ゲームの手(機能 Mod「ゲーム」)。who は、打った人 */
  | { type: 'gameMove'; who: 'user' | 'char'; game: 'tictactoe' | 'connect4' | 'reversi' | 'chess' }
  /** 移動(歩く・ワープ)が終わった(機能 Mod「より自由な移動」。途中でやめたときは、起こらない) */
  | { type: 'moveEnd'; mode: 'walk' | 'warp' }
  /** 状態(モード)が終わった(終了のアクション・時間切れ・リセット・Mod の OFF のどれでも) */
  | { type: 'stateEnd'; name: string }
  /** ゲームが終わった(result は、ユーザーから見た結果) */
  | { type: 'gameResult'; result: 'win' | 'lose' | 'draw'; game: 'tictactoe' | 'connect4' | 'reversi' | 'chess' }
  /** クリック・ドラッグ・チャット入力があった(放置時間のリセット) */
  | { type: 'activity' }
  /** 時間の経過(放置・時刻のトリガーを判定する)。1秒おき程度で呼ぶ */
  | { type: 'tick' }
  /**
   * 長押し(hold)・なでる(stroke)の継続中と、なで終わり(strokeEnd)。sec は続けた秒数、session は1回の長押し/なでるの通し番号
   * (同じ session では、1つのルールは1度だけ発火する)
   */
  | { type: 'hold' | 'stroke' | 'strokeEnd'; part?: string; side?: string; sec: number; session: number }

export interface FireResult {
  ruleId: string
  actions: ActionRequest[]
}

export interface HandleResult {
  fired: FireResult[]
  /** トリガーワードに一致し、AIへ送らないルールがあった(その入力はAIに送らない) */
  consumed: boolean
}
