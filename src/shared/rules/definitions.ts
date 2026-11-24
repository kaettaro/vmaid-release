// ルールの「定義レジストリ」(SPEC 6.3)。トリガー・条件・アクションの種類と、そのパラメータを
// データとして持つ。GUIフォームはここから自動生成し(M7)、検証・正規化もここに従う。
// 種類を追加するときは、ここに定義を足すだけでよい(GUIを作り直さない)。
import { MOODS } from '../touch/charState'
import { TOUCH_PARTS } from '../touch/parts'

export type ParamKind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'enum'
  | 'motion'
  /** モーションのタグ(その中から1つを選んで再生する) */
  | 'motionTag'
  | 'expression'
  | 'preset'
  /** 画面効果の名前(組み込み + 自作) */
  | 'overlayEffect'
  | 'time'
  | 'stringList'

export interface ParamDef {
  name: string
  /** 画面に出す日本語名 */
  label: string
  kind: ParamKind
  min?: number
  max?: number
  default?: unknown
  /** enum の選択肢 */
  options?: Array<{ value: string; label: string }>
  /** 必須か(false なら省略可。default があれば補う) */
  required?: boolean
  hint?: string
  /** 同時には指定できない相手のパラメータ名(例: playMotion の motion と tag)。GUIは一方を選ぶと他方を空にする */
  exclusiveWith?: string
  /** このパラメータを提供する機能 Mod(無効のときは使えない。ルールの中身は保持される)。省略=標準 */
  modId?: string
  /** `{{message}}` / `{{rest}}`(チャットで入力された文)を展開するか。トリガーが userMessage のルールで使う */
  template?: boolean
  /** enum の選択肢が「候補」であること(true なら、options 以外の id も書ける。Mod が宣言した触れ合いの部位など。形(英小文字・数字・ハイフン)だけ検査する) */
  open?: boolean
}

export type NodeKind = 'trigger' | 'condition' | 'action'

export interface NodeDef {
  /** YAML上の種類名(例: idle / probability / playMotion) */
  type: string
  label: string
  description?: string
  params: ParamDef[]
  /** この種類を提供する機能 Mod(無効のときは使えない)。省略=標準 */
  modId?: string
}

/** 触った部位・左右の選択(click / hold / stroke / recentTouches で共通) */
const PART_PARAM: ParamDef = {
  name: 'part',
  label: '触った部位',
  modId: 'touch-advanced',
  kind: 'enum',
  default: 'any',
  open: true,
  options: [{ value: 'any', label: 'どこでも' }, ...TOUCH_PARTS.map((p) => ({ value: p.value, label: p.label }))],
  hint: '胸・腰など、触れられたくない部位のルールは、作らなければ反応しません。Mod が宣言した部位も選べます(その Mod が ON のときだけ反応します)'
}
const SIDE_PARAM: ParamDef = {
  name: 'side',
  label: '左右(腕・手・脚・足)',
  modId: 'touch-advanced',
  kind: 'enum',
  default: 'any',
  options: [
    { value: 'any', label: 'どちらでも' },
    { value: 'left', label: 'キャラの左' },
    { value: 'right', label: 'キャラの右' }
  ],
  hint: '頭・胸・お腹・腰では使いません'
}

export const TRIGGERS: NodeDef[] = [
  {
    type: 'idle',
    label: '放置したとき',
    description: 'クリック・ドラッグ・チャット入力がない時間が続いたとき。1回の放置期間につき1回だけ動く',
    params: [{ name: 'afterSec', label: '放置する秒数', kind: 'number', min: 1, max: 86400, default: 300 }]
  },
  {
    type: 'click',
    label: 'クリックしたとき',
    description:
      'キャラを1回クリックしたとき(ダブルクリックは会話)。触った部位を指定すると、その部位のときだけ動く。' +
      '部位を指定したルールが動いたときは、部位を指定しない「クリック」のルールは動かない(部位ごとの反応を優先する)',
    params: [PART_PARAM, SIDE_PARAM]
  },
  {
    type: 'hold',
    modId: 'touch-advanced',
    label: '長押ししたとき',
    description:
      'キャラをほとんど動かさずに、押し続けたとき。押し続けた秒数(minSec)を変えた複数のルールで、段階的な反応にできる(1回の長押しで、各ルールは1度だけ動く)。' +
      '部位を指定したルールが動いたときは、部位を指定しない同じ種類のルールは動かない',
    params: [PART_PARAM, SIDE_PARAM, { name: 'minSec', label: '押し続ける秒数', kind: 'number', min: 0.3, max: 30, default: 0.6 }]
  },
  {
    type: 'stroke',
    modId: 'touch-advanced',
    label: 'なでているとき',
    description:
      'ボタンを押さずに、キャラの同じ部位の上で、マウスを往復させて「なでた」とき。なで続けた秒数(minSec)を変えた複数のルールで、' +
      '「なで始め → しばらく → 長いあいだ」と段階的に変わる反応にできる(1回のなでる間に、各ルールは1度だけ動く)',
    params: [PART_PARAM, SIDE_PARAM, { name: 'minSec', label: 'なで続ける秒数', kind: 'number', min: 0, max: 120, default: 0 }]
  },
  {
    type: 'strokeEnd',
    modId: 'touch-advanced',
    label: 'なでるのをやめたとき',
    description: 'なでていた手を止めて、少し経ったとき。なでた秒数(minSec)以上のときだけ動く(名残惜しそうにする、などに)',
    params: [PART_PARAM, SIDE_PARAM, { name: 'minSec', label: '最低でもなでた秒数', kind: 'number', min: 0, max: 120, default: 2 }]
  },
  {
    type: 'moveEnd',
    modId: 'move',
    label: '移動が終わったとき',
    description: '歩く・ワープするのが、最後まで終わったとき(途中でやめたときは、起こらない)。「着いたら一言」などに',
    params: [
      {
        name: 'mode',
        label: '動き方',
        kind: 'enum',
        default: 'any',
        options: [
          { value: 'any', label: 'どちらでも' },
          { value: 'walk', label: '歩いたあと' },
          { value: 'warp', label: 'ワープしたあと' }
        ]
      }
    ]
  },
  {
    type: 'stateEnd',
    modId: 'emotion-state',
    label: '状態が終わったとき',
    description: '名前つきの状態が終わったとき(「状態を終える」・時間切れ・リセット・Mod の OFF のどれでも)。状態の名前を空にすると、どの状態でも。「終わったら一言」などに',
    params: [{ name: 'name', label: '状態の名前', kind: 'string', default: '', hint: '空なら、どの状態が終わったときでも' }]
  },
  {
    type: 'gameMove',
    modId: 'game-any',
    label: 'ゲームで手が打たれたとき',
    description: '○×・コネクト 4・リバーシ・チェスで、ユーザーまたはキャラが 1 手打ったとき(キャラの手に、セリフ・表情で反応させる、などに)。ゲームを絞ることもできる',
    params: [
      {
        name: 'game',
        label: 'どのゲーム',
        kind: 'enum',
        default: 'any',
        options: [
          { value: 'any', label: 'どのゲームでも' },
          { value: 'tictactoe', label: '○×' },
          { value: 'connect4', label: 'コネクト 4' },
          { value: 'reversi', label: 'リバーシ' },
          { value: 'chess', label: 'チェス' }
        ]
      },
      {
        name: 'who',
        label: '打った人',
        kind: 'enum',
        default: 'any',
        options: [
          { value: 'any', label: 'どちらでも' },
          { value: 'user', label: 'ユーザー' },
          { value: 'char', label: 'キャラ' }
        ]
      }
    ]
  },
  {
    type: 'gameResult',
    modId: 'game-any',
    label: 'ゲームが終わったとき',
    description: '○×・コネクト 4・リバーシ・チェスが、勝ち・負け・引き分けで終わったとき(結果は、ユーザーから見たもの)。ゲームを絞ることもできる',
    params: [
      {
        name: 'game',
        label: 'どのゲーム',
        kind: 'enum',
        default: 'any',
        options: [
          { value: 'any', label: 'どのゲームでも' },
          { value: 'tictactoe', label: '○×' },
          { value: 'connect4', label: 'コネクト 4' },
          { value: 'reversi', label: 'リバーシ' },
          { value: 'chess', label: 'チェス' }
        ]
      },
      {
        name: 'result',
        label: '結果',
        kind: 'enum',
        default: 'any',
        options: [
          { value: 'any', label: 'どれでも' },
          { value: 'win', label: 'ユーザーの勝ち' },
          { value: 'lose', label: 'ユーザーの負け' },
          { value: 'draw', label: '引き分け' }
        ]
      }
    ]
  },
  {
    type: 'interval',
    modId: 'talk',
    label: '一定の間隔で(N 分ごと)',
    description: '起動してから(または前に動いてから)、指定した分数が過ぎるたびに。起動した直後には動かない。キャラのほうから話しかけるルールに(条件「話しかけてよいとき」と組み合わせる)',
    params: [{ name: 'everyMin', label: '間隔(分)', kind: 'number', min: 1, max: 1440, default: 30 }]
  },
  { type: 'startup', label: '起動したとき', description: 'アプリを起動して、キャラが表示されたとき', params: [] },
  {
    type: 'timeOfDay',
    label: '決まった時刻・時間帯',
    description: '指定した時刻(または時間帯の始まり)に、1日1回',
    params: [
      { name: 'at', label: '時刻', kind: 'time', required: true, hint: '例: 12:00' },
      { name: 'until', label: '終わりの時刻(時間帯にするとき)', kind: 'time', hint: '省略すると、その時刻ちょうど(以降)に1回。日をまたぐ指定もできる' }
    ]
  },
  { type: 'replyStart', label: '返答を始めるとき', description: 'あなたの入力を送って、AI が返答を考え始めたとき(裏の指示でも起きる)。入力した文は {{message}} で使えます', params: [] },
  { type: 'replyDone', label: '返答が終わったとき', description: 'キャラが会話の返答を言い終えたとき。返答の本文は {{reply}} で使えます', params: [] },
  {
    type: 'userMessage',
    label: 'チャットで言葉を入力したとき(トリガーワード)',
    description: 'あなたが入力した文に、指定の言葉が含まれるとき。判定はあなたの入力だけに行い、キャラの返答には行わない',
    params: [
      { name: 'keywords', label: '言葉(どれか1つでも一致)', kind: 'stringList', required: true, hint: '例: ダンスして / 踊って' },
      {
        name: 'match',
        label: '一致のしかた',
        kind: 'enum',
        default: 'contains',
        options: [
          { value: 'contains', label: '含まれていれば' },
          { value: 'equals', label: '完全に一致したとき' }
        ]
      },
      {
        name: 'passToLlm',
        label: 'AIにも送る',
        kind: 'boolean',
        default: false,
        hint: 'オフ(既定)ならこの入力はAIに送らず、アクションだけを実行する'
      }
    ]
  },
  {
    type: 'emotionTag',
    modId: 'emotion-state',
    label: 'AI が感情を表したとき',
    description: 'AI の返答に、感情タグ([emotion:名前])が付いていたとき(タグは、画面には出ません)。名前の例: joy / sad / angry / shy / surprised',
    params: [{ name: 'emotion', label: '感情の名前', kind: 'string', required: true, hint: '例: joy' }]
  },
  {
    type: 'poseTag',
    label: 'AI が動き(ポーズ)を指定したとき',
    description: 'AI の返答に、動きの指定タグ([pose:動きの説明])が付いていたとき(タグは、画面には出ません)。動きの説明は、アクションの中で {{pose}} として使えます。AI にタグを頼む指示文は、Mod「会話中に自動でポーズ」が足します',
    params: []
  }
]

export const CONDITIONS: NodeDef[] = [
  {
    type: 'canTalk',
    modId: 'talk',
    label: '話しかけてよいとき',
    description: 'キャラのほうから話しかけてよいとき(「静かにして」がOFF・会話中でない・ゲーム中でない・表示している・夜間でない・前の話しかけから最小の間隔が過ぎている・今日の上限に達していない)。動いたルールは、1 回の話しかけとして数えられる。間隔・上限・夜間は、Mod「話しかけ」の設定で変えられる',
    params: []
  },
  {
    type: 'probability',
    label: '確率',
    description: '指定した確率でだけ実行する',
    params: [{ name: 'value', label: '確率(0〜1)', kind: 'number', min: 0, max: 1, default: 1 }]
  },
  {
    type: 'cooldown',
    label: 'クールダウン',
    description: '前回実行してから、指定した秒数が過ぎるまでは実行しない',
    params: [{ name: 'sec', label: '秒数', kind: 'number', min: 0, max: 604800, default: 60 }]
  },
  {
    type: 'recentTouches',
    modId: 'touch-advanced',
    label: '続けて触られたとき',
    description: '直近の指定した秒数のあいだに、(クリックで)指定した回数以上、触られているとき。今回のクリックも数える。「突かれ続けて、あきれる」などに',
    params: [
      { ...PART_PARAM, label: '触った部位(数える対象)', hint: 'どこでも=部位に関係なく数える' },
      { name: 'count', label: '回数(以上)', kind: 'number', min: 2, max: 50, default: 3 },
      { name: 'withinSec', label: '直近の秒数', kind: 'number', min: 1, max: 600, default: 5 }
    ]
  },
  {
    type: 'affection',
    modId: 'affection-mood',
    label: '親密度',
    description: 'キャラの親密度(0〜100。ふれあいで増え、放置でゆっくり減る)が、範囲に入っているとき',
    params: [
      { name: 'min', label: '最小', kind: 'number', min: 0, max: 100, default: 0 },
      { name: 'max', label: '最大', kind: 'number', min: 0, max: 100, default: 100 }
    ]
  },
  {
    type: 'mood',
    modId: 'affection-mood',
    label: '気分',
    description: 'キャラの気分が、指定のものであるとき(「気分を変える」アクションで変わり、時間が経つと「ふつう」に戻る)',
    params: [{ name: 'is', label: '気分', kind: 'enum', default: 'normal', options: MOODS }]
  },
  {
    type: 'state',
    modId: 'emotion-state',
    label: '状態',
    description: '「状態を始める」で始めた状態が、続いている(または、続いていない)とき',
    params: [
      { name: 'is', label: '状態の名前', kind: 'string', required: true },
      { name: 'active', label: '続いているとき', kind: 'boolean', default: true, hint: 'オフにすると、続いていないときに実行する' }
    ]
  },
  {
    type: 'emotion',
    modId: 'emotion-state',
    label: '感情値',
    description: '感情値(0〜100。時間でゆっくり 0 に減る)が、範囲に入っているとき',
    params: [
      { name: 'name', label: '感情の名前', kind: 'string', required: true },
      { name: 'min', label: '最小', kind: 'number', min: 0, max: 100, default: 1 },
      { name: 'max', label: '最大', kind: 'number', min: 0, max: 100, default: 100 }
    ]
  }
]

export const ACTIONS: NodeDef[] = [
  {
    type: 'playMotion',
    label: 'モーションを再生',
    description: '登録済みのモーション、または、タグが付いたモーション(その中から1つを選ぶ)を再生する',
    params: [
      { name: 'motion', label: 'モーション', kind: 'motion', template: true, exclusiveWith: 'tag', hint: 'モーションかタグのどちらか1つを指定' },
      { name: 'tag', label: 'タグ', kind: 'motionTag', modId: 'motion-tags', exclusiveWith: 'motion', hint: 'このタグが付いたモーションから、1つを選んで再生します(タグは、モーションタブで付けます)' },
      {
        name: 'durationSec',
        label: 'ループして再生する秒数',
        kind: 'number',
        min: 0.5,
        max: 600,
        hint: '省略すると1回だけ。指定すると、モーションをこの秒数だけくり返してから、待機に戻る(ループ向きのモーション用)'
      },
      { name: 'queue', label: '再生中のモーションが終わってから続ける', kind: 'boolean', hint: 'オフ(既定)では、再生中は破棄される。オンにすると、順番に再生する(連続再生)' },
      {
        name: 'pick',
        modId: 'motion-tags',
        label: 'タグからの選び方',
        kind: 'enum',
        default: 'random',
        options: [
          { value: 'random', label: 'ランダム' },
          { value: 'first', label: '先頭' }
        ]
      }
    ]
  },
  {
    type: 'setExpression',
    label: '表情を変える',
    description: '指定した秒数だけ表情を変え、終わると元(基準値)に戻る',
    params: [
      { name: 'name', label: '表情', kind: 'expression', required: true, template: true },
      { name: 'value', label: '強さ(0〜1)', kind: 'number', min: 0, max: 1, default: 1 },
      { name: 'durationSec', label: '続ける秒数', kind: 'number', min: 0.1, max: 600, default: 3 }
    ]
  },
  {
    type: 'applyPreset',
    label: '表情・衣装セットを適用',
    description: '表情・衣装パネルで「名前をつけて保存」したセット(表情・モーフ・メッシュの表示の組み合わせ)を、キャラに適用する。「重ねる」にすると、猫耳・ハート目・衣装のように、別々のセットを同時に効かせられる',
    params: [
      { name: 'name', label: 'セット名', kind: 'preset', required: true, template: true, hint: '表情・衣装パネルで保存した名前(モデルごと)。そのモデルに無い名前なら、何も起きない。Mod のルールでは、{{slot:id}} で、利用者が(キャラごとに)選んだ名前を使える' },
      {
        name: 'revertAfterSec',
        label: '元に戻すまでの秒数',
        kind: 'number',
        min: 0,
        max: 3600,
        default: 0,
        hint: '0 なら戻さない(「元に戻す」で外すか、再起動するまで)。ルールでの適用は一時的で、基準値(保存される調整)は変わらない'
      },
      {
        name: 'mode',
        label: '適用のしかた',
        kind: 'enum',
        options: [
          { value: 'overlay', label: '重ねる(セットで変えた項目だけ足す)' },
          { value: 'replace', label: '置き換える(状態まるごと。セットに無い項目は既定値)' }
        ],
        default: 'overlay',
        hint: '重ねる: モーフは大きいほう、メッシュ・材質の表示は後から重ねたほうが効く。置き換える: それまでに重ねたものは、外すまで見えなくなる'
      }
    ]
  },
  {
    type: 'revertPreset',
    label: '表情・衣装セットを元に戻す',
    description: 'ルールで一時的に重ねた「表情・衣装セット」を外す(重ねていなければ、何も起きない)。セット名を指定すると、そのセットだけ外す',
    params: [{ name: 'name', label: '外すセット名', kind: 'preset', template: true, hint: '空なら、重ねているセットをすべて外す。指定すると、そのセットだけ外す(ほかは残る)' }]
  },
  {
    type: 'resetLook',
    label: '標準の表情・衣装に戻す',
    description: '重ねている表情・衣装セットをすべて外し、パネルで「標準」に決めたセットがあれば、それに戻す(決めていなければ、重ねたものを外すだけ)',
    params: []
  },
  {
    type: 'wait',
    label: '待つ',
    description: '次のアクションまで、指定した秒数、待つ。モーション・表情・セリフを、時間をずらして並べるのに使う(新しいふれあいが来たら、待っている分は取り消される)',
    params: [{ name: 'sec', label: '秒数', kind: 'number', min: 0.1, max: 600, default: 1 }]
  },
  {
    type: 'changeAffection',
    modId: 'affection-mood',
    label: '親密度を変える',
    description: 'キャラの親密度を増減する(0〜100に収まる。キャラごとに保存される)',
    params: [{ name: 'delta', label: '増減(−100〜100)', kind: 'number', min: -100, max: 100, default: 1 }]
  },
  {
    type: 'setMood',
    modId: 'affection-mood',
    label: '気分を変える',
    description: 'キャラの気分を変える。指定した秒数のあと「ふつう」に戻る(0なら、次に変えるまで続く)。条件の「気分」で、反応を変えられる',
    params: [
      { name: 'mood', label: '気分', kind: 'enum', default: 'happy', options: MOODS },
      { name: 'durationSec', label: '続ける秒数', kind: 'number', min: 0, max: 3600, default: 30 }
    ]
  },
  {
    type: 'say',
    label: 'セリフを言う',
    description: '決まったセリフを吹き出しに出す(AIは使わない)。複数なら、ランダムに1つ',
    params: [{ name: 'text', label: 'セリフ(複数ならランダム)', kind: 'stringList', template: true, required: true }]
  },
  {
    type: 'askAi',
    modId: 'talk',
    label: 'AI に頼んで言う',
    description: '指示文を、裏で、設定している AI(内蔵モデル・OpenAI 互換)に送り、返ってきた返答だけを、キャラのセリフとして出す(あなたの吹き出しは出ない)。AI の準備ができていない・会話中・失敗したときは、何も言わない(邪魔をしない)。内蔵モデルを、まだダウンロードしていないときは、ダウンロードしない',
    params: [
      { name: 'instruction', label: 'AI への指示', kind: 'string', required: true, template: true, hint: '例: ユーザーに、軽い話題で、何か話しかけて' },
      { name: 'save', label: '返答を、会話の文脈に残す', kind: 'boolean', default: true, hint: 'オンなら、あとで「さっきの話」と言っても、通じる(指示そのものは残らない)' }
    ]
  },
  {
    type: 'startState',
    modId: 'emotion-state',
    label: '状態を始める',
    description: '名前つきの状態を始める。指定した秒数のあと自動で終わる(0 なら、「状態を終える」まで続く)。Mod が始めた状態は、その Mod を OFF にすると終わる',
    params: [
      { name: 'name', label: '状態の名前', kind: 'string', required: true },
      { name: 'durationSec', label: '続ける秒数', kind: 'number', min: 0, max: 86400, default: 0 },
      { name: 'preset', label: '見た目のセット', kind: 'preset', template: true, hint: '空なら、見た目は変えない。選ぶと、この状態が続く間だけ、その表情・衣装セットを重ねる。状態が終わると(終了・時間切れ・リセット)、自動で外れて、元に戻る' },
      {
        name: 'presetMode',
        label: '見た目の適用のしかた',
        kind: 'enum',
        options: [
          { value: 'overlay', label: '重ねる(セットで変えた項目だけ足す)' },
          { value: 'replace', label: '置き換える(状態まるごと)' }
        ],
        default: 'overlay'
      }
    ]
  },
  {
    type: 'endState',
    modId: 'emotion-state',
    label: '状態を終える',
    description: '名前つきの状態を、終わらせる',
    params: [{ name: 'name', label: '状態の名前', kind: 'string', required: true }]
  },
  {
    type: 'setEmotion',
    modId: 'emotion-state',
    label: '感情値を決める',
    description: '感情値(0〜100)を、決めた値にする。時間でゆっくり 0 に減る',
    params: [
      { name: 'name', label: '感情の名前', kind: 'string', required: true },
      { name: 'value', label: '値(0〜100)', kind: 'number', min: 0, max: 100, default: 50 }
    ]
  },
  {
    type: 'changeEmotion',
    modId: 'emotion-state',
    label: '感情値を増減する',
    description: '感情値を、増減する(0〜100に収まる)',
    params: [
      { name: 'name', label: '感情の名前', kind: 'string', required: true },
      { name: 'delta', label: '増減(−100〜100)', kind: 'number', min: -100, max: 100, default: 10 }
    ]
  },
  {
    type: 'playDance',
    label: '踊る(楽曲の表から。BGM つき)',
    description: '楽曲の名前に合う行を、楽曲の表から探して、その行のモーションを再生し、BGM を一緒に流す(モーションが始まった瞬間に流れ、終わると止まる)。表に合う楽曲が無ければ、「表に無いときのモーション名」のモーションを、BGM なしで再生する。ダンス Mod が使う',
    params: [
      { name: 'songs', label: '楽曲の表', kind: 'string', template: true, hint: 'Mod のルールでは {{slot:songs}}(利用者が、Mod の設定で作った表)' },
      { name: 'name', label: '楽曲の名前(入力から探す)', kind: 'string', required: true, template: true, default: '{{message}}', hint: '入力全体({{message}})から、表の楽曲の名前を探す。「ワルツを踊って」も「踊って ワルツ」も合う' },
      { name: 'fallback', label: '表に無いときのモーション名', kind: 'string', template: true, default: '{{subject}}', hint: '表に合う楽曲が無いとき、この名前のモーションを、BGM なしで再生する(「踊って ○○」も「○○を踊って」も、○○ は {{subject}})' }
    ]
  },
  {
    type: 'startGame',
    modId: 'game-any',
    label: 'ゲームを始める',
    description: '選んだゲーム(○×・コネクト 4・リバーシ・チェス)の盤面の窓を出して、1 局始める。そのゲームの Mod が OFF なら、何も起きない。ゲーム中は、チャットで手を打って遊べる(「5」「3」「d3」「e2e4」など)\n',
    params: [
      {
        name: 'game',
        label: 'どのゲーム',
        kind: 'enum',
        default: 'tictactoe',
        options: [
          { value: 'tictactoe', label: '○×' },
          { value: 'connect4', label: 'コネクト 4' },
          { value: 'reversi', label: 'リバーシ' },
          { value: 'chess', label: 'チェス' }
        ]
      },
      {
        name: 'first',
        label: '先攻',
        kind: 'enum',
        default: 'default',
        options: [
          { value: 'default', label: 'Mod の設定に従う' },
          { value: 'user', label: 'ユーザー' },
          { value: 'char', label: 'キャラ' },
          { value: 'random', label: 'ランダム' }
        ]
      },
      {
        name: 'level',
        label: 'キャラの強さ',
        kind: 'enum',
        default: 'default',
        options: [
          { value: 'default', label: 'Mod の設定に従う' },
          { value: 'easy', label: 'やさしい' },
          { value: 'normal', label: 'ふつう' },
          { value: 'hard', label: 'つよい' }
        ]
      }
    ]
  },
  {
    type: 'stopGame',
    modId: 'game-any',
    label: 'ゲームをやめる',
    description: '盤面の窓を閉じて、ゲームを終わる(ゲーム中でなければ、何も起きない)',
    params: []
  },
  {
    type: 'stopMotion',
    label: 'モーションを止める(BGM ごと)',
    description: '再生中のモーションを止めて、待機に戻す。「BGM も止める」がオンなら、ダンスの曲も一緒に止まる。何も再生していなければ、何も起きない。「ストップ」「中止」などのトリガーワードに使う',
    params: [{ name: 'bgm', label: 'BGM も止める', kind: 'boolean', default: true }]
  },
  {
    type: 'playSound',
    modId: 'se',
    label: '効果音を鳴らす',
    description: '設定 →「効果音」で登録した音を、鳴らす(重ねて鳴らせる)。Mod を OFF にすると、鳴っている音も止まる',
    params: [{ name: 'name', label: '効果音の名前', kind: 'string', required: true, template: true, hint: '設定 →「効果音」で登録した名前。Mod のルールでは、{{slot:id}} で、利用者が選んだ名前を使える' }]
  },
  {
    type: 'showProp',
    modId: 'props',
    label: '小道具を出す',
    description: 'Mod が持つ小道具(glb)を、キャラに付けて表示する。指定した秒数のあと自動で消える(0 なら、「小道具を消す」まで)。Mod が出した小道具は、その Mod を OFF にすると消える',
    params: [
      { name: 'prop', label: '小道具の id', kind: 'string', required: true, template: true, hint: 'Mod の `props:` に書いた id(例: pendulum)。Mod のルールでは {{slot:id}} にして、利用者が出す・出さないを選べる(存在しない id なら、何も出ない)' },
      { name: 'durationSec', label: '出しておく秒数', kind: 'number', min: 0, max: 3600, default: 0, template: true, hint: 'Mod のルールでは {{slot:id}} にして、利用者が秒数を決められる' }
    ]
  },
  {
    type: 'hideProp',
    modId: 'props',
    label: '小道具を消す',
    description: '出している小道具を、消す',
    params: [{ name: 'prop', label: '小道具の id', kind: 'string', required: true, template: true }]
  },
  {
    type: 'showOverlay',
    modId: 'overlay',
    label: '画面効果を出す',
    description: '画面に、効果(渦巻き・ピンクの霧など。自作もできる)を重ねる。クリックは透過する。指定した秒数のあと自動で消える(0 なら、「画面効果を消す」まで)。Mod が出した効果は、その Mod を OFF にすると消える',
    params: [
      { name: 'effect', label: '効果', kind: 'overlayEffect', default: 'spiral', template: true, hint: '組み込み(spiral / pink-fog / hearts / rings / pulse / vignette / fade)か、設定 → Mod →「画面効果」で作った名前。Mod のルールでは、{{slot:id}} で、利用者が選んだ効果を使える' },
      {
        name: 'scope',
        label: '範囲',
        kind: 'enum',
        default: 'screen',
        template: true,
        options: [
          { value: 'screen', label: '画面全体(すべての画面)' },
          { value: 'character', label: 'キャラの近くだけ' }
        ]
      },
      { name: 'intensity', label: '濃さ(0〜1)', kind: 'number', min: 0, max: 1, default: 0.6 },
      { name: 'color', label: '色(空なら、効果の色)', kind: 'string', template: true, hint: '#rrggbb の形(例: #ff8ac8)。空なら、効果が持つ主な色を使う' },
      { name: 'durationSec', label: '出しておく秒数', kind: 'number', min: 0, max: 3600, default: 0 }
    ]
  },
  {
    type: 'hideOverlay',
    modId: 'overlay',
    label: '画面効果を消す',
    description: '出している画面効果を、消す',
    params: []
  },
  {
    type: 'moveTo',
    modId: 'move',
    label: '移動する',
    description: 'キャラの窓を、画面の中で動かす。歩く(歩行モーションで、すべるように)か、ワープする(消えて、別の場所に現れる)。移動中に、ドラッグ・緊急リセット・「移動をやめる」で止まる',
    params: [
      {
        name: 'target',
        label: '行き先',
        kind: 'enum',
        default: 'random',
        options: [
          { value: 'random', label: 'ランダム' },
          { value: 'left', label: '左端' },
          { value: 'right', label: '右端' },
          { value: 'center', label: '中央' },
          { value: 'cursor', label: 'カーソルの近く' }
        ]
      },
      {
        name: 'mode',
        label: '動き方',
        kind: 'enum',
        default: 'walk',
        options: [
          { value: 'walk', label: '歩く' },
          { value: 'warp', label: 'ワープする' }
        ]
      }
    ]
  },
  {
    type: 'stopMove',
    modId: 'move',
    label: '移動をやめる',
    description: 'いま歩いている・ワープしている途中なら、その場で止める(動いていなければ、何も起きない)',
    params: []
  }
]

const BY_KIND: Record<NodeKind, NodeDef[]> = { trigger: TRIGGERS, condition: CONDITIONS, action: ACTIONS }

/** YAML上で、種類名を書くキー(`trigger: idle` / `condition: probability` / `action: say`) */
export const TYPE_KEY: Record<NodeKind, string> = { trigger: 'trigger', condition: 'condition', action: 'action' }

export function nodeDefs(kind: NodeKind): NodeDef[] {
  return BY_KIND[kind]
}

export function findDef(kind: NodeKind, type: string): NodeDef | undefined {
  return BY_KIND[kind].find((d) => d.type === type)
}
