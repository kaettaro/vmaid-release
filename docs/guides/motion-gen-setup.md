# モーション生成 Mod の導入説明書(上級者向け)

「モーション生成 Mod」(`examples/mods/motion-gen-textvrma/`)は、**あなたが別に導入・起動した text-to-vrma** に、動きの説明を送って、できた VRMA を、VMaid のモーション一覧に足して、キャラで再生します。
**VMaid は、text-to-vrma を同梱せず、ダウンロードも、起動もしません。** 重い準備(約 20GB のダウンロード)が必要なので、軽く試したいだけの方は、`.vrma` を手元で用意して、「モーション」タブから取り込むほうが、簡単です。

> **実機での確認(2026-10-18)**: Windows 11(RTX 5060 Ti・RAM 31GB)で、下の手順(ARDY のローカルエンジン + `npm run api`)を通し、VMaid の Mod から、VRM と PMX のキャラで、生成・再生できることを確認しました。確認した text-to-vrma は、v1.1.9(コミット `53c5050`)です。生成にかかった時間は、1 回 **約 1〜4 秒**(GPU)でした。つまずいた点と対処は、「実機で分かったこと」にまとめています。
>
> この文書の、text-to-vrma に関する記述は、**2026-10-17 時点の、公式 README**(`https://github.com/Kirakun0328/text-to-vrma`)の記載です。公開前・実際に導入する前に、最新の README を、確認してください。VMaid の作者は、実機での通しの動作確認(text-to-vrma を実際に起動しての生成)は、まだ行っていません(**未確認**)。ADR 0001 のとおり、API の形は、ソースと README で確認し、モックで契約テストをしています。

## 向いている人・向かない人
- 向いている人: PC に余裕があり(RAM 16GB 以上、空き容量 35GB 以上)、ローカルで、入力した文章から、モーションを作ってみたい人。
- 向かない人: 手軽さを求める人 / メモリ・ディスクに余裕がない人 / コマンドラインに慣れていない人。

## 必要なもの(README の記載)
| 項目 | 内容 |
|---|---|
| 共通 | Node.js 20 以上、git |
| ARDY ローカルエンジン | Python 3.10 以上、約 20GB のダウンロード |
| メモリ | 最低 16GB / 推奨 32GB 以上 |
| ディスク | 35GB |
| GPU | 無くても動く(CPU で、1回に数十秒)。NVIDIA GPU(VRAM 6GB 以上)なら、1回に数秒。作者の検証は 12GB の GPU(4〜6GB は未検証) |
| OS | 作者の検証は Windows 11。macOS・Linux は、有志の確認で、**保証なし** |

## 手順

### 1. text-to-vrma を入れて、起動する
README には、2 通りの方法があります。
- **Windows(ビルド不要)**: GitHub の Releases から、最新の zip をダウンロードして、解凍し、exe を実行します(インストール不要。ARDY のセットアップ一式も同梱と記載)。
- **ソースから**(Windows / macOS / Linux):
  ```
  git clone https://github.com/Kirakun0328/text-to-vrma.git
  cd text-to-vrma
  npm install
  npm run build
  npm run app:dev        # デスクトップ版
  ```
  (初回と、ソースを変えたあとは、`npm run build` が必要。ブラウザ版は `npm run dev` → http://localhost:5173)

### 2. ARDY(ローカルで動く生成エンジン)を入れる
- Windows: `powershell -ExecutionPolicy Bypass -File tools\ardy-engine\install.ps1`
- macOS: `bash tools/ardy-engine/install_mac.sh`
- Linux: `bash tools/ardy-engine/install_linux.sh`

完了したら、エンジンを起動して、text-to-vrma の「ARDYローカルエンジン」モードを選びます。詳しくは、リポジトリの `tools/ardy-engine/README.md` を見てください(この文書は、そこまでは確認していません)。

> **PowerShell で `npm` が止まるとき**: 実行ポリシーのためです。`npm.cmd` を使うか、`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` を実行します(この項目は、計画時の調査メモによるもので、実機では未確認です)。

### 3. 「ローカルHTTP API」を有効にする
text-to-vrma は、「ローカルHTTP API(開発者向け・試験的機能)」を持っています(**インターフェースは、変わる可能性がある**と、README に書かれています)。
- **デスクトップ版**: 「詳細設定 → ローカルHTTP API」で有効にします(既定はオフ)。`127.0.0.1` のポート(既定 8787)が開き、**アクセストークンが必須**で、設定欄に表示されます。
- **ソース(CLI)**: `npm run api` で、`http://127.0.0.1:8787` で待ち受けます。トークンは任意(`TEXT_TO_MOTION_API_TOKEN` で有効化)。

### 4. 完全ローカルで使うための確認(重要)
text-to-vrma は、設定によっては、**入力した文章を、外部のサービスに送ります**(OpenAI・Claude・Codex・Jev(`api.typesafe.ai`))。VMaid の Mod は、外へ出ない、固定のリクエスト(`engine: ardy`、`planner: none`、`use_jev: false`)を送りますが、**text-to-vrma 側の設定は、VMaid からは制御できません**。次を、確認してください。
- **ARDY を使い、OpenAI / Claude の API キーを設定しない。**
- **Jev を設定しない**(または、`JEV_ENABLED=false`)。
- 初回のセットアップ(ダウンロード)には、インターネットが必要です。
- **ARDY のエンジンは、起動するたびに、Hugging Face(`huggingface.co`)へ、モデルの更新の確認をします**(実測: 起動後も、外部への接続が 2 本残ります。日本語の翻訳モデル FuguMT も、初回の起動で、ダウンロードされます)。README の「セットアップ後はオフライン」は、そのままでは、正確ではありません。**初回の起動で、翻訳モデルを取得できたあとは、環境変数 `HF_HUB_OFFLINE=1`(と `TRANSFORMERS_OFFLINE=1`)を付けて、エンジンを起動してください**。実測で、外部への接続が 0 件になり、生成も同じように動きました(下の「手動起動」)。

### 5. VMaid に、Mod を入れる
1. 設定 →「Mod」で、**「開発者向け」を ON** にします(スクリプトを含む Mod を、取り込み・使うために必要です)。
2. `examples/mods/motion-gen-textvrma/` のフォルダを、VMaid の「私用 Mod のフォルダ」(「Mod」タブの「私用 Mod のフォルダを開く」で開きます)の中に、フォルダごと、置きます(フォルダ名は `motion-gen-textvrma` のまま)。
3. 「Mod」タブに、「モーション生成(text-to-vrma 連携)」が出ます。**権限を読んで**(自分のPCの `127.0.0.1:8787` への通信、モーションの追加と再生、セリフ、小道具の保存)、ON にします。
4. その Mod の設定に、**トークン**(デスクトップ版のとき、text-to-vrma の設定欄に出ているもの)を入れます。ポートを変えた場合は、**通信先**(`mod.yaml` の `permissions.network`)と、設定の**接続先**を、同じにしてください(通信先は、宣言したものだけ使えます)。
5. チャットに「**モーション生成: 手を振る**」のように入力します。キャラが「考え中…」と言い、数十秒〜数分後に、動きが再生されます。作った動きは、「モーション」タブの一覧に、`motion-gen-textvrma/gen-…` という名前で、追加されます(同じ説明・長さは、作り直さず、前のものを再生します)。

## VMaid から起動する(任意。2026-11-18)
毎回、手で起動しなくてもよいように、**あなたが選んだ実行ファイル**を、VMaid から起動できます(VMaid が選ぶことはなく、ダウンロードもしません)。
1. 下のような `.bat` を、1 つ作ります(パスは、あなたの環境に合わせる)。ARDY のエンジンと、API(`npm run api`)の、両方を起動して、外へつながない設定(オフライン)にします。
   ```bat
   @echo off
   set PYTHONUTF8=1
   set PYTHONIOENCODING=utf-8
   set HF_HUB_OFFLINE=1
   set TRANSFORMERS_OFFLINE=1
   set TEXT_ENCODER_DEVICE=cpu
   start "ardy" /min "%LOCALAPPDATA%\text-to-vrma\ardy-engine\venv\Scripts\python.exe" "<ardy-engine のフォルダ>\tools\ardy-engine\server.py" --merged-base "<llm2vec-base-merged のパス>"
   cd /d "<text-to-vrma のフォルダ>"
   call npm run api
   ```
   (上の `ardy-engine` の場所・引数は、「実機で分かったこと」の「手動起動」に合わせて、書き換えてください。**この `.bat` の中身は、実機で通しては、確認していません**。)
2. 「Mod」タブ → モーション生成 → 設定「起動する実行ファイル」で「選ぶ…」→ 作った `.bat` を選びます。
3. 「text-to-vrma を起動する」ボタンで、起動できます(接続できるまで、最大 180 秒待ちます)。設定「生成するとき、起動していなければ自動で起動する」を ON にすると、生成の入力のときに、自動で起動します。
4. VMaid が起動したものは、VMaid の終了時と、この Mod を OFF にしたときに、止めます。**`start` で別窓に切り離した ARDY のエンジンは、止まらないことがあります**(その場合は、手で閉じてください)。

## 実機で分かったこと(2026-10-18。Windows 11 / RTX 5060 Ti)
- **所要時間**: セットアップ(約 20GB のダウンロード + テキストエンコーダーの構築で、約 36GB 使用)は、1 時間弱。生成は、1 回 1〜4 秒(GPU。エンジンの起動後、最初の 1 回だけ、数秒余分)。VRAM は、約 1.2GB(README の記載どおり)。
- **インストーラー(`install.ps1`)が、この環境で止まった 2 か所**(ユーザーの PC に、Git for Windows が入っていた場合):
  1. `git checkout` が、「detached HEAD」の通知を出すと、PowerShell 5.1 が、エラーとして扱って止まる(スクリプト 292 行目)。**もう一度、同じコマンドを実行すると、続きから進みます**(完了済みの手順は、飛ばされます)。
  2. ARDY の C++ 部品のビルドで、CMake が、pybind11 と Eigen を、git で取得しようとして、失敗する(`'submodule' appears to be a git command, but we were not able to execute it`)。**対処**: エンジンのフォルダの venv に、`pip install pybind11` を入れ、Eigen 3.4.0 を、別に取得して、MinGW でインストールし、`CMAKE_PREFIX_PATH` に、その 2 つの場所(`...\deps\prefix` と `...\venv\Lib\site-packages\pybind11`)を入れた状態で、`install.ps1` を、もう一度実行する。これで、最後(モデルの構築・設定ファイルの書き出し)まで、通りました。
- **手動起動(確認済み)**: エンジンのフォルダ(既定 `%LOCALAPPDATA%\text-to-vrma\ardy-engine`)の venv の Python で、`tools/ardy-engine/server.py --merged-base <llm2vec-base-merged のパス>` を実行します。**`PYTHONUTF8=1` と `PYTHONIOENCODING=utf-8` を付けてください**(付けないと、日本語の入力を、Windows の既定の文字コード(cp932)で表示しようとして、生成の最後で、エラーになることがありました)。外部へつながない運用には、さらに `HF_HUB_OFFLINE=1` `TRANSFORMERS_OFFLINE=1`(初回の起動を済ませたあと)。`TEXT_ENCODER_DEVICE=cpu` で、生成の本体は、GPU(`cuda:0`)で動きます。
- **API**: text-to-vrma のフォルダで `npm run api`(トークンなし)。`POST /v1/motions` に、VMaid の Mod と同じ固定の値(`engine: ardy` / `planner: none` / `use_jev: false` / `format: vrma`)を送ると、`model/gltf-binary` が返りました(日本語の説明は、UTF-8 の JSON で送る)。
- **生成物**: 44 本の人体ボーン(目・親指・つま先は無し)・表情は blink のみ・20fps で 80 フレーム(4 秒)・hips の移動あり。VMaid の「VRMA として読み込めるか」の検査を、通りました。
- **VMaid での再生**: 「モーション生成: 手を振る」「モーション生成: お辞儀して手を振る」で、「考え中…」→ 生成 → 一覧に `motion-gen-textvrma/gen-…` が追加 → 再生。PMX(Super Sonico)でも、VRM でも、動きました。止めた状態では、「text-to-vrma に接続できません(起動していますか?)」と出ます。
- **VRM のモデルで、かがむ・お辞儀の動きが、窓の下へ沈むことがあります**(関節が床より下へ入るぶんの持ち上げは、機能 Mod「足の接地補正」が ON のときだけ効きます)。生成する動きは、体の比率が、モデルと合わないことがあるので、**「足の接地補正」を ON にしておくこと**をおすすめします(PMX は、VRMA の再生中、常に、持ち上げます)。
- **動きの質**: ARDY は、毎回、結果が変わります。短い説明(手を振る・お辞儀・ジャンプ・しゃがむ・歩く)は、動きますが、説明どおりに、はっきり見えるかは、毎回違います(「手を振る」は、片手を肩の高さまで上げる動きでした)。
- **未確認**: text-to-vrma デスクトップ版の「ローカルHTTP API」(トークンあり)・macOS・Linux・4〜6GB の GPU・CPU だけでの生成。

## できること・できないこと
- 入力は 500 文字まで。生成の間隔は、10 秒あけます。待たせられるのは、3 件までです。
- **キャンセルは、できません**(クライアントが切っても、サーバー側の生成が止まるかは、未確認です)。
- 進捗は、「考え中…」の表示だけです(text-to-vrma の API に、進捗がないため)。
- 作った動きは、40 件を超えたら、古いものから、一覧から外れます。
- 生成は、同じ説明でも、毎回、違う結果になりえます(README に記載)。

## トラブルシュート
| 症状 | 確認すること |
|---|---|
| 「text-to-vrma に接続できません」 | text-to-vrma を起動したか / 「ローカルHTTP API」を有効にしたか / ポートが、通信先と同じか |
| 「トークンが違います」 | デスクトップ版の設定欄のトークンを、Mod の設定に入れたか(再生成したら、入れ直す) |
| 「ARDY エンジンが起動していません」 | ARDY のエンジンを起動したか(`install` のあと、別に起動が必要) |
| 「通信先と違います」 | Mod の設定の接続先と、`mod.yaml` の `permissions.network` が、同じオリジンか |
| 遅い・タイムアウト | GPU の有無。Mod の設定の「待ち時間の上限」を延ばす |
| 動きが不自然 | 生成は、実験的です。説明を変えて、やり直す |

## ライセンスと責任
- text-to-vrma のソースコードは **MIT**(README の記載)。生成された `.vrma` は、README では、**生成した利用者のもの**とされています(各自で、原文を確認してください)。
- ARDY の重みは NVIDIA Open Model Agreement、Meta Llama 3 は Meta Llama 3 Community License、日英翻訳の FuguMT は CC BY-SA 4.0(README の記載)。text-to-vrma に同梱のサンプルのアバターは、pixiv の利用条件で、MIT の対象外です。**VMaid は、これらを、同梱も再配布も、しません。**
- 外部のサービス(OpenAI など)を設定した場合の、通信・料金・規約は、あなたの責任です。
- 公開・配信で使うときは、生成物と、使った素材の、条件を確認してください(`docs/TERMS.md`)。
