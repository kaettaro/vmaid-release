// 初期のルール(プリセット)。モデルを入れるだけで、基本的なふれあいと if-then が動くようにする。
// 初回起動時に userData/rules.yaml として書き出し、ユーザーが自由に編集・追加できる。

export const PRESET_RULES_YAML = `# VMaid のルール(if-then)。自由に編集・追加できます。
# 書き方: when(いつ) → if(もし・すべて満たすとき) → do(何をする) を、上から順に実行します。
# 保存すると、すぐ反映されます(書き方が間違っているときは反映されず、エラーが表示されます)。
version: 1

# playMotion は、モーション名(motion)か、タグ(tag)で指定できます。tag は、そのタグが付いたモーションの中から、ランダムに1つ再生します。
# タグは、設定の「モーション」タブで付けます(リアクション・ダンスなどは、最初から付いています)。

rules:
  - id: startup-greeting
    description: 起動したとき、あいさつする
    enabled: true
    when: { trigger: startup }
    do:
      - { action: playMotion, motion: wave }
      - { action: say, text: ["こんにちは!", "おはよう!", "今日もよろしくね"] }

  - id: click-react
    description: キャラをクリックしたとき、ふれあいのリアクションをする(ダブルクリックは会話)
    enabled: true
    when: { trigger: click }
    do:
      - { action: playMotion, tag: リアクション, pick: random }
      - { action: setExpression, name: happy, value: 1, durationSec: 2 }

  # 触った部位で反応を変える例。部位を指定したルールが動いたときは、上の汎用の click-react は動きません。
  # 部位: head(頭) chest(胸) belly(お腹) hips(腰) arm(腕) hand(手) leg(脚) foot(足)。左右は side: left / right(キャラから見た向き)
  # 胸・腰など、触れられたくない部位のルールは作っていません(汎用の click-react が動きます)。
  - id: touch-head
    description: 頭をなでると、うれしそうにする
    enabled: true
    when: { trigger: click, part: head }
    do:
      - { action: setExpression, name: happy, value: 1, durationSec: 3 }
      - { action: playMotion, motion: nod }
      - { action: say, text: ["えへへ", "なでなで、うれしいな", "もっとなでて"] }

  - id: touch-hand
    description: 手を触ると、手を振って応える
    enabled: true
    when: { trigger: click, part: hand }
    do:
      - { action: playMotion, motion: wave }
      - { action: say, text: ["握手だね!", "やっほー"] }

  - id: touch-belly
    description: お腹を触ると、くすぐったがる
    enabled: true
    when: { trigger: click, part: belly }
    do:
      - { action: setExpression, name: surprised, value: 0.8, durationSec: 2 }
      - { action: say, text: ["くすぐったいよ!", "ひゃっ"] }

  - id: idle-dance
    description: しばらく放置されると、踊る(80%の確率で、10分に1回まで)
    enabled: true
    when: { trigger: idle, afterSec: 300 }
    if:
      - { condition: probability, value: 0.8 }
      - { condition: cooldown, sec: 600 }
    do:
      - { action: playMotion, tag: ダンス, pick: random }

  - id: word-wave
    description: 「手を振って」「バイバイ」などと入力すると、手を振る
    enabled: true
    when: { trigger: userMessage, keywords: ["手を振って", "手ふって", "バイバイ", "ばいばい"] }
    do:
      - { action: playMotion, motion: wave }
`
