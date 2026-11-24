# Mod の作り方ガイド

VMaid の Mod は、**フォルダ(または `.vmaidmod` = zip)**で、ルートに `mod.yaml` を置きます(旧 `pack.yaml` / `.vmaidpack` も、読めます)。
自分のルール・モーション・指示文を、まとめて渡すだけなら、設定 →「Mod」の「自分のルール・モーション・指示文を、Mod として書き出す」が、いちばん簡単です。この文書は、手で書きたい人・スクリプトを書きたい人向けです。

## 1. Mod の種類
Mod は、置き場所で 3 つに分かれます: **公式**(アプリに同梱)・**コミュニティ**(`.vmaidmod` の取り込み。`<データフォルダ>/mods/community/`)・**自作**(自分で作る。`<データフォルダ>/mods/individual/<id>/mod.yaml`。設定 →「Mod」の「自作 Mod のフォルダを開く」)。「データ Mod」という区別は、ありません(ルール・モーションを置くだけの Mod が、ふつうの Mod です)。`feature:` を書けるのは、公式の Mod だけです。

| 種類 | 中身 | コード | 通信 | 使える条件 |
|---|---|---|---|---|
| ふつうの Mod | ルール・モーション・指示文・スロット・小道具を置くだけ | なし | なし | いつでも |
| 公式の機能を使う Mod(`feature:`) | アプリに同梱(モーションのタグ・足の接地補正・音声合成・MMD・ゲームなど) | 本体 | 設定したものだけ | 「Mod」タブのトグル |
| スクリプト Mod | 上に加えて、JavaScript(サンドボックスの中) | あり | 宣言して承認した先だけ | **「開発者向け」が ON** のときだけ |

どの Mod も、**追加した直後は OFF**。「Mod」タブのトグルで、いつでも ON/OFF できます(OFF は即解除。保存したデータは消えません)。緊急リセット(基本設定。Ctrl+Alt+Shift+R)で、キャラを初期の表示に戻し、状態・小道具・表情・画面効果などの効果を、すぐ止められます(Mod の ON/OFF は変わりません)。

## 2. `mod.yaml` のリファレンス
```yaml
id: my-mod                 # 必須。英小文字・数字・ハイフン、2〜41文字。フォルダ名と同じにする
name: マイ Mod             # 必須。表示名(60文字まで)
version: "0.1.0"           # 必須
distribution: private      # 任意(置き場所で決まるので、書かなくてよい。公式のフォルダは配布用の検査がかかる)
description: 説明          # 任意
requires: [touch-advanced] # 任意。使う公式の機能 Mod の id(OFF のとき、その機能を使う部分は動かない。画面に出る)
prompt:                    # 任意。会話の指示文の断片
  layer: persona           # persona(性格。重ね掛けできる) / state(状態。性格のあと)
  text: ゆっくり、やさしく話す   # 2000文字まで
  whenState: trance        # 任意。その状態(アクション「状態を始める」)が続いている間だけ、この指示文を足す
slots:                     # 任意。利用者が差し替える空き(素材を含めずに、反応の枠だけを配れる)
  - { id: tap-motion, label: クリックされたときのモーション, kind: motion }   # kind: motion / text / preset / choice / effect
  - { id: tone, label: 口調, kind: choice, default: a, options: [{ value: a, label: ていねい }, { value: b, label: くだけた }] }   # choice は options から選ぶ(value が {{slot:id}} に入る)
  - { id: fx, label: 画面効果, kind: effect, default: spiral }   # effect は、組み込み + 自作の画面効果から選ぶ
  - { id: words, label: 合言葉, kind: text, default: "ねむれ,おやすみ", hint: カンマ区切り }   # default(初期値)・hint(説明)は任意
props:                     # 任意。小道具(キャラの骨に付ける 3D の物)
  - { id: hat, file: hat.glb, bone: head, scale: 1, position: [0, 0.1, 0], rotation: [0, 0, 0] }
motions:                   # 任意。この Mod が持つモーション(.vrma / .bvh)
  - { name: hi, file: motions/hi.vrma, tags: [あいさつ], source: https://…, license: メモ, redistributable: false }
rules:                     # 任意。ルール(設定の「ルール」タブと同じ書き方)
  - id: tap
    when: { trigger: click }
    do:
      - { action: playMotion, motion: "{{slot:tap-motion}}" }
script: …                  # 任意。スクリプト Mod(§5)
```
- **ルール**: 書き方は、設定の「ルール」タブの YAML と同じです(`docs/SPEC.md` §6)。Mod の中のルールの `id` と、モーション名は、取り込むとき、`<Mod の id>/…` の名前空間つきになります(ほかの Mod・自分のルールと、ぶつかりません)。
- **設定項目(スロット。Mod の「設定画面」)**: 利用者が、Mod ごと・**キャラごと**に値を決められる項目です(設定 → Mod → その Mod の「設定するキャラ」)。値は、キャラ別の値 → 全キャラ共通の値 → `default` の順に使います。`kind` は、`motion`(モーション名)・`text`(文・言葉)・`preset`(表情・衣装パネルの「名前をつけて保存」したセット名。表情・モーフ・メッシュの表示の組み合わせで、モデルごと)・`choice`(`options` から選ぶ)・`effect`(画面効果の名前)・`dances`(ダンスの楽曲の表。楽曲の名前 → モーション + BGM。値は JSON で、設定画面に表の編集が出る。ルールのアクション `playDance` で使う。公式の「ダンス」Mod が使っている)。ルールでは `{{slot:id}}` で使います。使える場所:
  - トリガーワード `keywords: ["{{slot:words}}"]`(値をカンマ・読点・改行で区切ると、複数の言葉)
  - `playMotion` の `motion`、`setExpression` の `name`、`applyPreset` の `name`、`say` の `text`、`showProp` / `hideProp` の `prop`(値が空なら、そのアクションは何もしません。存在しない小道具の id にすれば「出さない」の選択肢になります)
  - `showProp` の `durationSec`(数字。数字でなければ 0 = 消すまで)
  - `prompt.text` の中(使っているキャラの値に展開されます)
  - `applyPreset` で適用した表情・衣装セットは、`revertPreset` で元に戻せます(Mod を OFF にしたときも戻ります)。
- **ダンスと BGM**: アクション `playDance`(`songs`: `"{{slot:songs}}"` / `name`: `"{{message}}"` / `fallback`: `"{{rest}}"`)は、入力から楽曲の表の行を探し、そのモーションを再生して、BGM を一緒に流します(モーションが始まった瞬間に流れ、終わると止まります。Mod を OFF にしても止まります)。表に合う行が無ければ、`fallback` の名前のモーションを、BGM なしで再生します。曲のファイルは、Mod に含められません(利用者が、設定で選びます)。
- **効果音**: 公式の機能 Mod「効果音(SE)」を `requires` に書くと、アクション `playSound`(`name`: 利用者が、設定 →「効果音」で登録した名前。`{{slot:id}}` で、利用者が選んだ名前にもできます)が使えます。
- **触れ合いの部位**(`touchParts`): 公式の機能 Mod「高度な触れ合い」が ON のときだけ有効。本体は部位の中身を持たないので、この Mod が、触れる部位を宣言します。ルールの `part: <id>`(click / hold / stroke / strokeEnd / recentTouches)で使えます。
  ```yaml
  touchParts:
    - { id: shoulder, label: 肩, sides: true, bone: shoulder, radius: 0.035 }   # 骨の近く。sides: true で、キャラの左右を区別
    - { id: neck, label: 首, sides: false, bone: neck, radius: 0.04 }
    - { id: thigh, label: 太もも, sides: true, band: [0.56, 0.7] }               # 身体の高さの帯(0=頭のてっぺん、1=足元)
  ```
  `bone`(sides: true): shoulder / upperArm / lowerArm / hand / upperLeg / lowerLeg / foot / toes。`bone`(sides: false): head / neck / chest / spine / hips。radius は身体の高さに対する割合(0.005〜0.3)。`band` は [上, 下](`halfWidth` で左右の幅)。id は英小文字・数字・ハイフン(本体の部位 head / chest / belly / hips / arm / hand / leg / foot と重ねられません。最大 20 件)。宣言した部位は、本体の部位より先に判定します(狭い範囲が先)。骨が無いモデルでは、その部位は判定されません。
  判定は、画面に映った骨の位置と身体の高さだけで行います(前後の区別はできません。髪の毛などメッシュだけのものは判定できません。PMX の「肩」の骨は、首の付け根にあります)。
- **変数**: トリガーが `userMessage` のとき、`{{message}}`(入力全体)と `{{rest}}`(一致した言葉より後ろ)が、`template: true` の欄(`say` の文・`playMotion` のモーション名など)で使えます。`{{slot:<id>}}` は、その Mod のスロットの値です。
- **小道具**: `.glb`(1ファイルで完結したもの。外部のファイル・URL を参照するものは、読み込みません)。`.fbx` は「FBX インポーター」、`.pmx`(テクスチャは同じフォルダ)は「PMX インポーター」が ON のときだけ使えます。単位は、形式ごとに、メートルにそろえます。**GLB に入っているアニメーションは、すべてループ再生されます**(振り子の揺れなど。名前の決まりはありません)。原点が、付ける骨の位置です。
- **画面効果**: 公式の機能 Mod「画面効果」を `requires` に書くと、アクション `showOverlay`(`effect` 効果の名前、`scope`: screen(画面全体)/ character(キャラの近くだけ)、`intensity` 0〜1、`color` #rrggbb(空なら効果の色)、`durationSec`)と `hideOverlay` が使えます。`effect`・`scope`・`color` は `{{slot:id}}` にできます(効果の名前が空なら、何も出しません)。クリック透過の窓に描き、点滅する効果はありません。出した Mod を OFF にする・「効果を今すぐ解除」で消えます。
  - 組み込みの効果: spiral(渦巻き)/ pink-fog(ピンクの霧)/ hearts(ハートが漂う)/ rings(広がる輪)/ pulse / vignette / fade。
  - **自作の効果**: 設定 → Mod →「画面効果」の「画面効果を作る・編集する」で、レイヤー(spiral / fog / vignette / pulse / fill / particles / rings)を YAML で組み合わせて作り、名前をつけて保存します(`userData/overlay-effects/<名前>.yaml`。ファイルを置いても、共有してもよい)。スクリプトは使いません。保存した効果は、ルールの `effect` と、`kind: effect` のスロットから選べます。
- **同梱できないもの**: ライセンス不明・再配布不可の素材、モデル(VRM)・個人の設定・会話履歴。成人向けの素材は、公式のリポジトリ・本体には、入れません(利用者の責任で、私用として、配ってください)。
- `distribution: distributable` の Mod には、モーション等の素材すべてに `redistributable: true` と `license` が必要で、スクリプトは含められません。

## 3. 配る
- **書き出し**: 設定 →「Mod」→「マイ Mod」(ルール・モーション・指示文を選んで `.vmaidmod` に)。
- **手で作る**: フォルダの**中身**(`mod.yaml` がルートに来る形)を zip にして、拡張子を `.vmaidmod` にします。入れてよいファイルは、`mod.yaml`、`.vrma` / `.bvh`、`.js`、`.glb` / `.fbx` / `.pmx`、小道具のテクスチャ(画像・`.spa` / `.sph`)、`.txt` / `.md` だけです。ファイル数・大きさに、上限があります。
- 取り込む人には、中身(ルール・モーション・必要な機能 Mod・権限)が表示され、**追加直後は OFF** です。
- 配るときは、**ライセンス表記・素材の出所・通信先**を、`description` や README に、書いてください。

## 4. 例(ルールを置くだけの Mod)
`resources/mods/official/persona-ottori/mod.yaml`(性格 Mod)、`resources/mods/official/dance/mod.yaml`(ダンス Mod: 「踊って ワルツ」)が、そのまま、参考になります。素材を含めずに、スロットで、モーションを選ばせる作り方も、性格 Mod にあります。

## 5. スクリプト Mod(Tier 2)
### 5.1 構成
```yaml
script:
  apiVersion: 1               # 必須(いまは 1)
  entry: main.js              # スクリプト(Mod のフォルダの中の .js。既定 main.js)
  settings:                   # 任意。利用者が「Mod」タブで入れる設定(host.settings.get で読む)
    - { name: endpoint, label: 接続先, kind: string, default: "http://127.0.0.1:8787" }
    - { name: token, label: トークン, kind: secret }     # secret は暗号化して保存。画面にも値を出さない
    - { name: exe, label: 起動する実行ファイル, kind: file }        # file: 利用者が「選ぶ…」で選んだパス。launcher 専用で、スクリプトには渡らない
    - { name: autoStart, label: 自動で起動する, kind: boolean }
  launcher:                   # 任意。ローカルのツールを、利用者が選んだ実行ファイルで起動する(下の「外部ツールの起動」)
    { label: text-to-vrma, pathSetting: exe, autoSetting: autoStart, healthUrl: "http://127.0.0.1:8787/health", startupSec: 180 }
  permissions:                # 宣言した権限だけ、使える(取り込み・ON のとき、日本語で列挙して、確認される)
    network: ["http://127.0.0.1:8787"]   # 通信してよい先(オリジン)。パスなし・完全一致
    motion: [add, play]                  # モーションを足す / 再生する
    say: true                            # セリフを出す
    storage: true                        # Mod 専用の保存領域(256KB まで)
    emit: true                           # ルールのトリガーを起こす
  contributes:                # ルールに足すノード(フォームは、宣言から自動で作られる)
    triggers: [{ type: ping, label: ping されたとき }]
    actions:
      - type: hello
        label: こんにちはを言う
        params:
          - { name: who, label: 名前, kind: string, default: みなさん, template: true }
```
ルールからは、`<Mod の id>/<種類>`(Mod 自身のルールでは、ローカル名 `hello` でも書ける)で使えます。パラメータの種類は、`number` / `string` / `boolean` / `enum` / `stringList` / `time`。

### 5.2 ホスト API(`host`)
```js
host.onAction((action, params) => { … })   // ルールのアクション(宣言したもの)が届く。完了は待たれない
host.log(level, message)                    // ログ(「Mod」タブで見られる)
host.settings.get(name)                     // 設定の値(型つき。未設定なら既定値か null)
host.http.fetch(url, { method, headers, body, timeoutMs })
  // → { ok, status, contentType, text, bytes } か { ok: false, reason }。宣言した通信先だけ。GET/POST。timeoutMs は 1 秒〜10 分(既定 15 秒)
  // 使えるヘッダー: Content-Type / Accept / Authorization / X-API-Key。リダイレクトは追いません。応答は 32MB まで
host.storage.get(key) / host.storage.set(key, value)       // 権限 storage。値は 64KB まで、キーは 100 個まで(null で削除)
host.motion.add(name, vrmaBytes) → 追加した名前 | null     // 権限 motion:add。検査済みの VRMA だけ。名前は <Mod の id>/<name>。1つの Mod 50 件まで
host.motion.play(name) / host.motion.remove(name)           // play は 権限 motion:play。remove は自分が足したものだけ
host.say(text)                                              // 権限 say(500文字まで)
host.rules.emit(name)                                       // 権限 emit。宣言したトリガーだけ
host.ai.say(instruction, { save })                          // 権限 ai。設定している LLM に、裏で指示を送り、返答だけをセリフとして出す(2000 文字まで・30 秒に 1 回まで・会話中などは何もしない・失敗は黙る)。save(既定 true): 返答を、会話の文脈に残す
host.context.set(text | null)                               // 権限 context。会話に「最近の話題」を足す(600 文字まで。参考情報として扱われる。null で消す。Mod が OFF なら使われない)
host.ui.list.set({ title, empty, icons, items })           // 権限 ui.list。見出しの一覧の窓に出す一覧を、丸ごと渡す(下の「一覧の窓」)
host.ui.onEvent(fn)                                         // 一覧の窓の操作を受ける。fn({ type: 'select', id })
```
呼び出しは、1 秒に 20 回までです。スクリプトは、**最初のアクションが来たとき**に起動し、5 分使われなければ終了します(状態は、`host.storage` に)。

### 5.3 サンドボックスの制約(ADR 0002)
- Node・Electron・ファイル・OS・`eval`・`new Function`・`fetch` / `XMLHttpRequest` / `WebSocket` / WebRTC・画像・フレーム・ワーカーは、使えません(CSP と、窓の分離で、遮断されます。通信は `host.http` だけ)。
- どの Mod の窓かは、VMaid が決めます(スクリプトが名乗った id は、信用されません)。
- **限界**: CPU を使い続けるスクリプトによる妨害は、防げません。配るときも、入れるときも、信頼できるものだけにしてください。

### 5.4 テストの仕方
`main.js` は、`host` を受け取るだけの、ふつうのスクリプトです。偽の `host`(`say` / `http.fetch` / `motion.add` などを、配列に記録するもの)を渡して、Node(Vitest)で動かせます。公式の例の `src/shared/scripts/motionGenMod.test.ts` が、そのまま、お手本です(`examples/mods/motion-gen-textvrma/`)。

### 5.5 公式の例
`examples/mods/motion-gen-textvrma/`(モーション生成。text-to-vrma 連携)。導入は、`docs/guides/motion-gen-setup.md`。

## 6. セキュリティの注意(作る人へ)
- 通信先は、**必要なものだけ**を宣言してください。外部(`localhost` 以外)を宣言すると、利用者に、赤い警告が出ます。
- 入力文(`userMessage`)を、外へ送らないでください。必要なら、ルールの `{{rest}}` など、**利用者のルールが展開した値だけ**を、アクションのパラメータとして受け取る形にしてください(スクリプトには、入力全体を読む権限が、ありません)。
- 画面に出す文字は、`host.say` だけです(HTML は、描けません)。

## 付録: 設定で足す通信先(`networkFrom`)と、設定の種類 `urls`・`enum`(2026-10-19)
```yaml
script:
  apiVersion: 1
  settings:
    - { name: feeds, label: フィードの URL, kind: urls }            # 複数行(1 行に 1 つ)。https の外部のサイトだけ
    - name: mode
      label: 知らせ方
      kind: enum                                                    # 選択肢つき(options が要る)
      default: single
      options: [{ value: single, label: 1 件ずつ }, { value: digest, label: まとめて }]
  permissions:
    networkFrom: [feeds]                                           # feeds に書かれて、利用者が承認したサイトへ、host.http.fetch で通信できる
```
- 利用者が URL を保存するとき、サイトごとに確認ダイアログが出ます。承認していないサイト・設定から消したサイトへは、通信できません。自分の PC・内部ネットワークの URL は、保存できません。接続の瞬間に、名前解決の結果が公開のアドレスでなければ、断ります。リダイレクトは追いません(転送先の URL を書いてもらってください)。
- 公式の例: `examples/mods/news-rss/`(RSS ニュース)。

## 付録: 設定(スロット)の種類と「詳しい設定」(2026-10-19)

方針: **基本の値(間隔・秒数・時刻・確率・セリフ・合言葉)は、ルールを触らず、Mod タブの「この Mod の設定」で変えられる**ようにします。

- **スロットの種類を足しました**: `number`(`min` `max` `step` `unit`)・`time`(HH:MM)・`boolean`(true/false)・`lines`(1 行 1 候補のセリフ。最大 30 行)。`group:` に見出しを書くと、設定が見出しごとに折りたたまれます。
- **`{{slot:id}}` は、ルールのどの値にも書けます**(トリガー・条件・アクションの数値、時刻、オン/オフ、`text: ["{{slot:lines}}"]`)。種類の合わない参照(例: number の欄に lines)・存在しないスロットは、読み込み時のエラーです。値が壊れているときは、スロットの `default` → パラメータの既定値の順に使います。
- **作者が何も書かなくても**、すべての Mod(公式・コミュニティ・自作)の行に、**「詳しい設定(ルールの値)」**が出ます。ルールの数値・時刻・オン/オフ・セリフの一覧・言葉を、全キャラ共通/キャラごとに上書きできます(`mod.yaml` は変わらない。「初期値に戻す」で Mod の値に戻る)。`{{slot:…}}` で書いた値は、スロットの欄で調整します。
- 例: 公式 Mod「話しかけ」「話しかけ(AI)」(`resources/mods/official/talk/mod.yaml`)。

## 付録: 一覧の窓(`host.ui.list`。2026-10-19)

見出しの一覧を、別の窓に並べたい Mod(ニュース・お知らせなど)のための仕組みです。**Mod は、データだけを渡します**(HTML・スクリプトは渡せません)。窓は、アプリが描きます。

- 権限(`permissions.ui`): `list: true`(一覧の窓を出す)/ `openLink: true`(利用者が「↗」を押したときだけ、その項目の https のリンクを、ふだんのブラウザで開く)。どちらも、権限として表示され、承認が要ります。
- `host.ui.list.set({ title, empty, icons: { 名前: "data:image/png;base64,…" }, items: [{ id, title, subtitle, icon: "名前", link: "https://…", unread: true }] })`。**アプリが、受け取ったときに検査して作り直します**: 項目は 100 件まで・文字数の制限・制御文字を除く・アイコンは PNG / ICO / JPEG / GIF / WebP の data: だけ(先頭のバイト列も確認。1 つ 24KB まで・12 種類まで。SVG は不可)・リンクは https だけ。壊れた項目は、捨てられます。
- 項目を押すと、`host.ui.onEvent` に `{ type: 'select', id }` が届きます(止まっていたスクリプトは、起こされます)。押した直後(5 秒)の `host.ai.say` は、30 秒の間隔制限が、2 秒に緩みます(選んだ話題を、すぐ話せます)。
- 窓の ON/OFF は、Mod タブの「一覧の窓を表示する」と、トレイ/右クリックのメニュー(「〇〇の窓」)。「キャラに追従する」も選べます。窓は、動かせて、大きさも変えられ、位置と大きさを覚えます。最後に渡した一覧は、アプリが保存するので、アプリを再起動しても、すぐ表示されます。
- 例: `examples/mods/news-rss/`(見出し・サイトのアイコン・未読の印・選ぶと話題にする)。
