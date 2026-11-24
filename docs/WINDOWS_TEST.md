# Windows でテストする手順

Windows 10 / 11 の PC(x64)で、VMaid を動かして確認するための手順。
**この手順は、Mac で書いたものです。Windows の実機では、まだ一度も動かしていません**(確認できていない箇所は「未確認」と書いてあります)。
つまずいたら、エラーの文章を、そのまま教えてください。

## 0. 先に知っておくこと

- **`node_modules` を Mac からコピーしてはいけません。** ネイティブのファイル(Electron 本体・`node-llama-cpp`)が OS ごとに違うためです。Windows の PC で、必ず `npm ci` し直します。
- **PCのメモリ**: 内蔵AIは、8GB なら Qwen3(約2.5GB)、16GB 以上なら Gemma 4(約5GB)が既定になります。初回のダウンロードに、インターネット接続とディスクの空き(約3〜6GB)が要ります。
- **Windows の場所**: プロジェクトは、**英数字だけの短いパス**に置いてください(例: `C:\dev\VMaid`)。日本語・空白・長い階層は、Windows のパスの長さ制限や、ツールの不具合の原因になりやすいです(未確認だが、避けたほうが安全)。

## 1. 用意するもの

| 必要なもの | 入手先・確認方法 |
|---|---|
| **ソースコード一式** | Mac の `VMaid/release/VMaid-source.zip`(下の §2)。または、GitHub に置いたリポジトリを `git clone` |
| **Node.js 22.12 以上** | [nodejs.org](https://nodejs.org/) の LTS(22 系)を入れる。`node -v` で `v22.` と出ること |
| **VRM モデル(`.vrm`)** | あなたが手元に持っているもの。**リポジトリには入っていません**(権利の都合)。USB やクラウドで、別に持っていく |
| (任意)VRMA モーション | 内蔵モーション(待機・手を振る・うなずき・ダンス)があるので、無くても動きます |
| (任意)git | `git clone` で取得する場合のみ |

> Ollama や、Mac で入れたモデルファイルは、**要りません**。内蔵AIは、初回に自動でダウンロードします。

## 2. ソースコードを Windows に持っていく

### 方法A: zip(いちばん簡単)
1. Mac の `VMaid/release/VMaid-source.zip` を、Windows に渡す(USB メモリ、クラウドストレージ、メールなど。AirDrop は Windows に送れません)。
2. Windows で、`C:\dev\` に展開する → `C:\dev\VMaid\package.json` がある状態にする。

zip を作り直すとき(Mac のターミナルで、`VMaid` フォルダの中):
```bash
git archive --format=zip --prefix=VMaid/ -o release/VMaid-source.zip HEAD
```
(`HEAD` は、**コミット済み**の内容です。コミットしていない変更は入りません)

### 方法B: GitHub を使う
リポジトリを GitHub にアップロード済みなら、Windows で `git clone <URL> C:\dev\VMaid`。
(GitHub Actions も使えます。§6)

## 3. セットアップ(PowerShell)

```powershell
cd C:\dev\VMaid
node -v            # v22.x であること
npm ci             # 依存を、ロックファイルのとおりに入れる(数分かかります)
```

- `npm ci` の途中で、Electron の本体(約100MB)が自動で取得されます。
- `node-llama-cpp` の Windows 用バイナリ(`@node-llama-cpp/win-x64` など)も、このとき入ります(ロックファイルに含まれていることは、Mac 側で確認済み)。
- 警告(`EBADENGINE` など)が出たら、Node のバージョンが古い可能性があります。

## 4. 動かす

### 4-1. 開発モードで起動(まずこれ)
```powershell
npm run dev
```
- 画面の右下に、透明なウィンドウが出ます。**キャラを右クリック →「モデルを選ぶ…」**で、`.vrm` を選びます。
- `ELECTRON_RUN_AS_NODE` を設定している環境(VS Code の一部の設定など)では、`BrowserWindow` の import エラーで落ちます。その場合は、PowerShell で先に `Remove-Item Env:ELECTRON_RUN_AS_NODE` を実行してください。

### 4-2. インストーラを作って試す(任意)
```powershell
npm run build:win
```
- `release\VMaid Setup 0.1.0.exe`(nsis のインストーラ)ができます。
- **署名していない**ので、実行すると SmartScreen の警告が出ます。「詳細情報」→「実行」で進めます。
- ビルドには、追加で、ビルド用のツール(nsis など)が自動でダウンロードされます(インターネットが要ります)。
- **未確認**: Windows でのビルドが、エラーなく完了するか(Mac では dmg を作れたが、Windows は一度も作っていない)。

### 4-3. 検証用に、アプリのデータをきれいにしたいとき
アプリのデータは `%APPDATA%\vmaid\` に保存されます(エクスプローラーのアドレスバーに `%APPDATA%\vmaid` と入力)。
削除すると、初期状態(モデルも設定もルールも履歴も)に戻ります。

## 5. 確認してほしいこと(Windows 特有)

全部の項目は [MANUAL_TEST.md](MANUAL_TEST.md) の、Windows 列にあります。**まず、次を見てください**(Windows で、挙動が違う可能性が高い所です)。

| # | 確認 | なぜ |
|---|---|---|
| 1 | 起動して、**背景が透けた**キャラが出る(黒や白い四角が出ない) | 透過ウィンドウの挙動が、Mac と違うことがある |
| 2 | キャラの**透けている部分をクリック**すると、下のアプリ(デスクトップ・ブラウザなど)が反応する。キャラの体の上では、ドラッグ・右クリックができる | クリック透過(マウスの転送)の実装が OS で違う |
| 3 | **タスクトレイ**にアイコン(ピンクの丸)が出る。左クリックで、表示/非表示が切り替わる。右クリックでメニュー | Windows 専用の動作を入れている |
| 4 | キャラをドラッグしても、**ウィンドウの大きさが変わらない**。拡大縮小(ホイール)も正しく動く。Windows の「拡大率」(125% / 150%)を変えても同じ | 高DPIで、位置指定が大きさを変える既知の不具合を避ける処理を入れている |
| 5 | 他のアプリを**全画面**にしたとき、キャラが前面に出る(または、出ないことの確認) | 最前面の動作が OS で違う |
| 6 | **ダブルクリック**で入力欄が開き、日本語入力(IME)で変換を確定する Enter では、送信されない | IME の挙動の確認 |
| 7 | 初回の会話で、**ダウンロード確認のダイアログ**が出て、ダウンロードできる。完了後、会話できる | ネットワーク・保存先・ダイアログ |
| 8 | 内蔵AIが動く(GPU が無い PC でも CPU で動く)。**応答が極端に遅くないか** | `node-llama-cpp` の Windows 版(Vulkan / CPU)の確認。**未確認** |
| 9 | 設定 →LLM で、**API キーを保存**できる(`settings.json` に平文で残らない) | Windows の暗号化(DPAPI)。**未確認** |
| 10 | `%APPDATA%\vmaid\` に、`settings.json` / `rules.yaml` / `history\` ができている。パスに日本語のユーザー名が含まれていても動く | ファイルの保存先 |

### 動かないときに、教えてほしい情報
- **何をしたら、どうなったか**(画面のスクリーンショットがあると助かります)。
- `npm run dev` を実行した PowerShell の**出力(エラーの文章)**を、そのまま。
- PC の情報: Windows のバージョン、メモリ、GPU の有無。

## 6. GitHub Actions で、Windows のビルドを自動で作る(任意)

`.github/workflows/build.yml` に、Mac と Windows のビルドの設定が入っています。リポジトリを GitHub に置けば、自分の PC に Node を入れなくても、**Windows のインストーラ(exe)を、クラウドで作って、ダウンロード**できます。
- 使い方: GitHub にリポジトリを作り、プッシュ → 「Actions」タブ →「build」→ 完了後、「Artifacts」から `vmaid-windows-latest` をダウンロード。
- **未確認**: このワークフローは、まだ一度も実行していません。最初は失敗するかもしれません。
- これにはリポジトリの公開(または、非公開リポジトリの作成)が必要です。**外部への公開は、あなたが決めてください**(私は、勝手にはアップロードしません)。

## 7. 動作しない可能性がある点(未確認)
- **Visual C++ の再頒布可能パッケージ**: `node-llama-cpp` の Windows 用バイナリが、これを必要とする場合があります(`VCRUNTIME140.dll が見つかりません` のようなエラーが出たら、Microsoft の「Visual C++ 再頒布可能パッケージ(x64)」を入れてください)。**必要かどうかは未確認**です。
- **GPU**: GPU が使えない・ドライバが古い場合は、CPU に切り替わります(遅くなります)。
- **ウイルス対策ソフト**: 未署名のアプリや、ダウンロードしたモデル(GGUF)に、警告を出すことがあります。
- **長いパス**: プロジェクトを深い階層に置くと、`npm ci` が失敗することがあります(§0)。

## 8. 拡張の実行方式の PoC(任意・調査用。`docs/adr/0002-extension-runtime.md` の Windows 分)

拡張(mod)の仕組みを作る前の調査として、Mac で確かめた「拡張のコードが、直接ネットワークに出られない」ことと、起動時間・メモリを、Windows でも測りたい。**本体の機能ではなく、使い捨ての実験コード**で、困らなければ飛ばしてよい。

```powershell
cd C:\dev\VMaid
npm ci
node_modules\.bin\electron.cmd docs\adr\poc\0002-extension-runtime
```
終わると `docs\adr\poc\0002-extension-runtime\result.json` ができる。次を教えてほしい(ファイルをそのまま見せてもらえれば足りる):
- `attempts` の各項目が、`sendBeacon` と `RTCPeerConnection` 以外、すべて `escaped: false` か。
- `serverHitsFromDirectAttempts` が空(`[]`)か。
- `webrtc` の4つの条件の `udpPacketsReceived` が、`default` 以外 0 か(Windows の既定でも UDP が出るか)。
- `extStartupMs`(起動時間)と、`afterOne` / `afterFive` のメモリ(`Tab` の `workingSetMB`)。
- **未確認**: Windows での結果。Windows Defender ファイアウォールの許可ダイアログが出た場合は、その内容も教えてほしい(PoC は 127.0.0.1 だけを使う)。

