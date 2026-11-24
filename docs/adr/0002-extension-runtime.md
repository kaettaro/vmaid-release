# ADR 0002: 拡張(Tier 2 スクリプト拡張)の実行方式

- 状態: **承認(2026-10-16、ユーザー承認)。Mod 中心設計への移行に伴い、用語を「拡張」→「Mod」に読み替える**
- 日付: 2026-10-15
- 関連: `docs/PLAN_extensions_and_motion-gen.md` 4.5 / 4.7
- PoC: `docs/adr/poc/0002-extension-runtime/`(使い捨て。実測値の元)

## 1. 結論(案)
計画書4.5の構成を**採用する**。PoC で、次が成立することを確認した(macOS のみ。Windows は未確認):

1. 拡張ごとに非表示の `BrowserWindow`(`sandbox: true` / `contextIsolation: true` / `nodeIntegration: false`)を、**専用 `session.fromPartition('ext-<id>')`** で作る。
2. 拡張のファイルは、**専用プロトコル**(`vmaid-ext://<id>/…`、`session.protocol.handle`)で本体が配信する。HTML は本体が生成する(拡張は HTML を持たない)。パストラバーサルは本体で拒否する。
3. **CSP**: `default-src 'none'; script-src vmaid-ext://<id>; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`(`unsafe-eval` なし)。
4. 多重防御として、**同じ partition に `webRequest.onBeforeRequest`(本体プロトコル以外を遮断して記録)・権限要求の全拒否・`setWindowOpenHandler` の拒否・`will-navigate` の拒否**を入れる。
5. **WebRTC は CSP の対象外で、UDP が外に出る**ことを確認した(§3.2)。**`setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` と、preload での `RTCPeerConnection` 等の削除の両方**を入れる(必須)。
6. 通信は **`host.http.fetch` だけ**。main が代行し、接続先は**オリジン完全一致**・リダイレクト不追従・サイズ/時間の上限・接続時の名前解決のループバック確認を行う(§3.3)。
7. 拡張の識別は、**main が `webContents.id` から決める**(拡張が名乗る id は信用しない)。PoC の `host.whoami()` は、窓から決めた id を返した。
8. `utilityProcess`(Node)は**不採用**: サンドボックスにならず、`fs`・`child_process`・ネットワークに直接出られるため(Tier 3 相当)。

## 2. 実測値(Apple M2 / macOS 26.3 / Electron 44(リポジトリの `node_modules`)/ Node 22.16。3回実行)
| 項目 | 結果 |
|---|---|
| 拡張の窓の起動〜スクリプト読み込み完了 | 約 0.25〜1.0 秒(`extStartupMs` 246 / 797 / 989。初回は GPU・ネットワーク子プロセスの起動を含む。`loadURL` だけだと 125〜620ms) |
| 破棄して作り直し | 約 140〜190 ms |
| 拡張1つあたりの追加メモリ(レンダラー `Tab`) | **約 70〜85 MB**(working set。`app.getAppMetrics()`)。5つ同時: 72/80/84/84/84 MB |
| 本体(Browser)プロセスの増加 | 窓なし 107MB → 拡張1つ 約 146MB(窓管理・プロトコルの分を含む。本体の実アプリでは GPU/ネットワークのプロセスは既にあるため、実増分は主にレンダラー1つ分) |
| 無限ループ(`while(true){}`) | **本体のタイマー遅延 2ms(影響なし)**。コマンドは 2 秒でタイムアウトし、`win.destroy()` で切り離せた。再起動も成功 |

→ 計画書の基準(「起動後 +X MB」)は、**拡張1つ ≈ +80MB(使用中のみ。遅延起動・アイドル終了なら、使わない人は 0)**とするのが現実的。「軽さを保つ」方針(不変条件6)に対し、**既定OFF + 遅延ロード + アイドル終了(例: 5分)が必須**。

## 3. セキュリティの確認結果

### 3.1 拡張のコードから直接ネットワークに出られるか(`ext/main.js` の `attempts`)
テスト用のローカル HTTP サーバー(拡張の外)に、あらゆる経路で到達を試み、サーバー側に**届いた要求を数えた**。

| 経路 | 結果 |
|---|---|
| `fetch` / `XMLHttpRequest` / `WebSocket` | 遮断(CSP `connect-src 'none'`) |
| `<img>` / `<script src>` / `<link rel=stylesheet>` / `<iframe>` | 遮断(`ERR_BLOCKED_BY_CSP`) |
| `navigator.sendBeacon` | `true`(キュー)を返すが、**サーバーに届かない** |
| `window.open` | `null`(拒否) |
| `eval` / `new Function` / 動的 `import(外部URL)` / `new Worker(外部URL)` | 遮断 |
| `require` / `process` / Electron の API | **存在しない**(sandbox + contextIsolation) |
| **サーバー側に届いた要求(直接試行の全部)** | **0件** |
| `webRequest.onBeforeRequest` が記録した遮断 | 0件(CSP が先に止めるため、ここまで来ない) |

### 3.2 WebRTC(重要な発見)
`RTCPeerConnection` は CSP の対象外で、`iceServers` に任意の STUN/TURN を指定すると **UDP が外に出る**。ローカルの UDP 受信側で測った:

| 条件 | 構築 | UDP 受信 |
|---|---|---|
| 既定 | できる | **4 パケット届いた(漏れる)** |
| `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` | できる | 0 |
| preload で `RTCPeerConnection` 等を削除 | `not defined` | 0 |
| 両方 | `not defined` | 0 |

→ **両方を入れる**(ポリシーは Chromium 側の遮断、削除は拡張から見える API の遮断)。ただし「削除」はメインワールドのグローバルを消すだけで、別の実行環境(iframe / worker)が作れれば回避できる可能性があるため、`frame-src 'none'` / `worker-src 'none'` とセットで効く。**この組み合わせの網羅的な突破テストは未実施**。限界は導入時の注意書き(計画書4.7の9)に含める。

### 3.3 `host.http.fetch` のゲート(`main.js` の `gateFetch`)
| ケース | 結果 |
|---|---|
| 宣言したオリジン(`http://127.0.0.1:<port>`)への GET | 通る |
| 別ポート(`http://127.0.0.1:1`) | 拒否 `origin-not-allowed` |
| 宣言と前方一致するだけの名前(`<origin>.evil.example`)/ `localhost.evil.example` | 拒否(`bad-url` / `origin-not-allowed`) |
| 302 リダイレクト | 拒否 `redirect-refused`(`redirect: 'manual'`) |
| 応答 5MB(上限 1MB) | 拒否 `too-big`(受信を中断) |
| 応答が遅い(4 秒 / 上限 1.5 秒) | 拒否 `timeout` |
| `file:` スキーム | 拒否 `scheme` |
| 識別されていない送信元 | 拒否 `unknown-sender` |

- **名前解決(DNS リバインディング対策)**: `fetch()` の前に `dns.lookup` で確認する方式は、確認と接続の間に結果が変わりうる(TOCTOU)。PoC で、**`http.request` の `lookup` オプションで、接続時にループバック以外を拒否する**方式が動くことを確認した(`rebind.test → 10.0.0.1` を `not-loopback` で接続前に拒否。ループバックは通過)。**本実装は、この `lookup` 方式(`node:http` / `node:https`)にする**。`fetch` ではなく `http.request` を使うので、ストリーム読み・サイズ上限・タイムアウト・リダイレクト不追従は自前で実装する(PoC の `gateFetch` が参考)。
- 宣言した接続先が localhost 以外のとき(外部)は、名前解決の確認を行わず(外部は許可された宛先なので)、計画書4.7の3のとおり、赤い警告で承認させる。
- **未確認**: IPv6(`[::1]`)・`localhost` が複数アドレスに解決される環境での挙動、プロキシ設定がある環境、Windows での挙動。

## 4. 未確認・制限
- **Windows は未実施**(同じ Electron API なので動く見込みだが、起動時間・メモリ・WebRTC のポリシー・プロトコルの挙動は未測定)。`docs/WINDOWS_TEST.md` に確認項目を足す(PoC をそのまま Windows で `electron docs/adr/poc/0002-extension-runtime` で実行して、`result.json` を見る)。
- CPU を使い続ける拡張(例: 低負荷の無限ループで、タイムアウトに掛からない処理)による妨害は防げない(§1の限界)。ウォッチドッグ(コマンドの応答が一定時間ない窓は破棄)で本体との切り離しはできた。
- スクリプト拡張が1ファイル(`main.js`)前提(`script-src` が自分のプロトコルのみ)。複数ファイル・ES modules は、同じプロトコルの `script-src` で足りるはずだが、PoC では未検証。
- 宣言的パネル(設定フォーム)は PoC の範囲外(本体のレンダラーが、拡張の宣言(JSON)から描く。拡張は HTML を描かない)。
- ネットワーク遮断下の動作(オフライン)は、PoC がローカルのみで動いているので、外部通信が不要であることは確認できたが、実際のネットワーク切断での試験は未実施。

## 5. 決めたいこと(ユーザーへ)
1. 「拡張1つ ≈ +80MB(使用中のみ)」「アイドル 5 分で終了」を受け入れるか。
2. WebRTC の2重の遮断を必須にする(上記)で良いか。
3. `host.http` は `node:http`(`lookup` 方式)で実装する(`fetch` は使わない)で良いか。

## 6. 実装結果(2026-10-17。M15。Windows 11 / Electron 44 / 実アプリ)
`src/main/scriptHost.ts`・`scriptHttp.ts`・`src/preload/scriptMod.ts` に、この ADR の方式で実装した。Windows の実アプリ(別の userData)で、サンプルのスクリプト Mod(リポジトリ外)に、PoC と同じ攻撃を試みさせた(結果は、スクリプトが `host.log` で報告)。
- 直接通信(`fetch` / `XMLHttpRequest` / `WebSocket` / `<img>`): **すべて遮断**。`eval` / `new Function`: CSP で遮断。`window.open`: `null`。`RTCPeerConnection`・`require`・`process`: **存在しない**。`navigator.sendBeacon` は `true` を返すが、**サーバーに届かない**。
- ローカルのサーバー(攻撃先)に届いた要求は、**`host.http` 経由の 2 件だけ**(直接試行は 0 件)。`host.http` は、宣言外のオリジン(別ポート)を `origin-not-allowed` で断った。
- ルール → スクリプト(遅延起動)→ `host.http`(宣言内)→ `host.say` → `host.rules.emit` → 別のルール、の流れが、実アプリで通った。`host.storage` も動いた。
- 「開発者向け」を OFF にすると、窓が止まり、Mod が無効になり、宣言したノードがルールの一覧から消え、ルールは動かない。ON に戻すと、元に戻る。
- 単体テスト: ゲート(オリジン完全一致・前方一致の拒否・ヘッダーの許可リスト)、通信の代行(リダイレクト不追従・応答の上限・接続時のアドレス確認=DNS リバインディングの再現)。
- **未確認**: Mac / アイドル 5 分での自動終了の実測 / IPv6(`[::1]`)の環境 / プロキシのある環境 / 更新で権限が増えたときの再確認(未実装)。

## 追補(2026-10-19): 設定で足す通信先(`networkFrom`)
- スクリプト Mod が、**利用者が設定の欄(種類 `urls`)に書いた**、https の外部のサイトへ通信できる仕組みを足した(RSS など、通信先が利用者ごとに違うもの向け)。宣言は、`permissions.networkFrom: [設定名]`。**固定の通信先(`permissions.network`)は、これまでどおり**。
- **確認と承認**: 設定を保存するとき、まだ承認していないオリジン(サイト)があれば、**サイトを並べた確認ダイアログ**を出す(「あなたの PC から接続する・IP アドレスが見える・入力した内容や会話は送らない」)。許可したオリジンだけが、`mods.approvedOrigins` に残る。**設定から URL を消すと、承認も使えなくなる**(いま設定にあり、かつ承認済みのものだけが、通る)。キャンセルすると、保存しない。
- **使える URL の制限**(`shared/scripts/origins.ts`): https のみ・ユーザー名/パスワードつきは不可・**自分の PC・内部ネットワークは不可**(`localhost`・`.local`・`.internal`・単一ラベルの名前・IP アドレスの直書きの、ループバック/私用/リンクローカル/CGNAT など)・1 つの設定に最大 10 URL・1 URL 500 文字・合計 3900 文字。保存のときに整える(重複・空行・`#` の行を除く)。
- **DNS リバインディング対策**: 設定で足したオリジンへの接続では、接続の瞬間の名前解決の結果が、**公開のアドレスでなければ断る**(`isPublicAddress`。`scriptHttp.ts`)。リダイレクトは追わない(従来どおり)。通信ログに残る(従来どおり)。
- 権限の説明は、**外部への通信として、赤い警告**(`describePermissions`)。CLAUDE.md の通信の許可リストは変えない(「Mod が宣言し、利用者が承認した通信先」の、設定で足す形)。
- 設定の種類として、`urls`(複数行)と `enum`(選択肢つき。`options`)も足した。

## 追補(2026-10-19): 一覧の窓(`host.ui.list`)

**決定**: スクリプト Mod は画面を持てないため、「データだけを渡す、アプリ側の一覧窓」を足した。権限 `ui`(`list` / `openLink`)。Mod が渡した一覧は、main が `shared/scripts/uiList.ts` で検査して作り直し(件数・文字数・制御文字・アイコンは data: 画像のみで先頭のバイト列も確認・link は https のみ)、アプリ自身のページ(`renderer/modlist`。CSP は `img-src data:`、文字は常にテキスト)が描く。窓 → Mod へ届くのは「選んだ項目の id」だけ(一覧に在る id のみ)。ブラウザで開くのは、**直近に渡された項目の https の link だけ**を、利用者の「↗」クリックのときに `shell.openExternal` へ渡す(権限 `openLink` が要る。窓・Mod から任意の URL は渡せない)。呼び出し元は webContents.id で決め、他の Mod の窓・一覧は見えない。**外部通信の許可リストは変えない**: アプリは、記事のページへ通信しない(ブラウザを開くのは、OS への受け渡しで、利用者のクリックだけ)。アイコンは、承認済みの同じサイトの `/favicon.ico` を、Mod が `host.http.fetch` で取る。窓の状態(表示・追従・位置と大きさ)は `settings.mods.uiWindows`。最後の一覧は `userData/mod-ui/<Mod の id>.json` に保存。
