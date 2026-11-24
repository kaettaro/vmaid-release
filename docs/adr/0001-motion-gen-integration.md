# ADR 0001: モーション生成(text-to-vrma)との連携方式

- 状態: **承認(2026-10-16、ユーザー承認)。Mod 中心設計への移行に伴い、用語を「拡張」→「Mod」に読み替える**
- 日付: 2026-10-15
- 関連: `docs/PLAN_extensions_and_motion-gen.md` 5章・付録B

## 1. 結論(案)
計画書5.4の分岐のうち **(a)「APIが `.vrma` を直接返す → そのまま使う」を採用する**。アダプターは、text-to-vrma のローカル HTTP API(`POST /v1/motions`、`format: "vrma"`)を呼ぶだけの薄いものにする。
- (b) 自前の `.vrma` 変換と、(c) フォルダ監視への縮小は、いまは不要。ただし (c) は、APIが変わって使えなくなったときの退避案として、拡張の設計(「VRMAを受け取って登録する」部分を分離する)で残す。
- **VMaid が送るリクエストは、必ず「完全ローカル」になる固定の値を付ける**(§4)。ユーザーが設定で変えられるのは、接続先・トークン・長さ・ループだけ。

## 2. 確認したこと
調査対象: `https://github.com/Kirakun0328/text-to-vrma` の `master`、コミット `53c50504`(2026-10-12 `docs: READMEから未確認の口の動きの記述を外す`)、`package.json` の版 **1.1.9**、ライセンス **MIT**(`LICENSE`)。**取得したソースとREADMEを読んだだけで、起動・実行はしていない。**

### 2.1 「テキスト → `.vrma`」を返す経路がある(確認済み)
- `README.md` 「ローカルHTTP API」(約487〜620行): `POST /v1/motions`、`format: "vrma"` で `.vrma` バイナリを返す。
- `src/apiServer.js`(約404〜530行): `body.format === 'vrma'` のとき `Content-Type: model/gltf-binary`、`Content-Disposition: attachment; filename="<名前>.vrma"` で `build(spec)`(`vrmaBuilder.js`)の結果を返す。JSON の場合は `{id, object:'motion', created, engine, model, spec}`。
- 同じく `POST /v1/vrma`(spec JSON → `.vrma`。キー不要)もある。

### 2.2 リクエスト(`src/apiServer.js` の検証から)
| 項目 | 内容 |
|---|---|
| `prompt` | 必須、1〜4000文字(**VMaid 側は計画どおり500文字に制限**) |
| `engine` | `openai`(既定)/`claude`/`codex`/`ardy`。**VMaid は `ardy` 固定** |
| `planner` | `ardy` のときのみ。`codex`(**既定**)/`openai`/`claude`/`none` |
| `format` | `json`(既定)/`vrma` |
| `duration` | 正の数(秒)。`ardy` で有効 |
| `use_jev` | boolean。**サーバーに `JEV_API_KEY` があれば既定で使う** |
| 本文 | `application/json` のみ(それ以外は415)、1 MiB まで |

### 2.3 通信が外へ出る「落とし穴」(確認済み・重要)
- `engine: "ardy"` でも、`planner` の**既定は `codex`**(`apiServer.js` 約475行 `const planner = body.planner ?? 'codex'`)。`codex` は ChatGPT 側に動作計画を依頼する(README「ARDYの頭脳を選ぶ」)。**VMaid は `planner: "none"` を必ず付ける。**
- `use_jev`: サーバーに Jev のキーがあると、入力文を `api.typesafe.ai` へ送る(README 付録B)。**VMaid は `use_jev: false` を必ず付ける。**
- `engine` の既定は `openai`(キーがあれば有料API)。**VMaid は `engine` を必ず `ardy` にする。**
- → 3つとも固定で送れば、`/v1/motions` からの外部通信は発生しない(サーバー側に設定があっても、リクエスト側で無効にできる)。ただし「サーバー側がこれらを無視する」可能性は、ソースでは見えない範囲(未確認)。導入説明書では、ユーザーの `.env` に API キーを入れないことも案内する。

### 2.4 認証・接続元の検証(確認済み)
- バインドは `127.0.0.1` のみ。既定ポート `8787`(`startApiServer`)。外部公開(`HOST` を変える)ときは `TEXT_TO_MOTION_API_TOKEN` 必須。
- トークン: `Authorization: Bearer <token>`(完全一致比較)。**CLI(`npm run api`)では任意、デスクトップ版の「ローカルHTTP API」ではトークン必須で、設定欄に表示される**(README)。
- Host 検証: トークンなしのとき、Host ヘッダーがループバック名(`127.0.0.1` / `localhost` / `::1`)以外なら403。Origin は「付いていれば」検証(`app://bundle` かループバックのみ)。`Sec-Fetch-Site: cross-site` は403。→ **VMaid の main プロセスが Node の `fetch` で呼ぶ場合、Origin は付かないので通る**(`isAllowedOrigin`)。
- ARDY エンジン本体(`tools/ardy-engine/server.py`)も `127.0.0.1:2337` のみ。

### 2.5 応答・エラー・進捗・キャンセル・バージョン
| 項目 | 確認結果 |
|---|---|
| 成功 | 200 + `model/gltf-binary` |
| エラー形式 | `{ "error": { "message", "type": "api_error", "code" } }`(400/401/403/405/413/415/503/500 など。`code` 例: `invalid_prompt` / `unauthorized` / `ardy_unavailable` / `provider_not_configured`) |
| ARDY 未起動 | 503 `ardy_unavailable`(「ARDYエンジンに接続できません」) |
| **応答は同期** | `/v1/motions` は生成が終わるまで応答を返さない。**非同期ジョブ・進捗の購読はない**(READMEも「HTTPの返却は生成完了後」)。 |
| 進捗 | ARDY エンジンの `GET http://127.0.0.1:2337/progress` に `{active, stage, elapsed, remaining, fraction, text}` がある(`server.py` 約1012行)。ただし VMaid の接続先は 8787 の API。**2337 への接続を VMaid に許可するかは別の判断**(§5) |
| キャンセル | `/v1/motions` に専用のキャンセルはない。クライアントが接続を切る(`AbortSignal`)方式になる。**切ったあと、サーバー側の生成が止まるか(GPUを使い続けるか)は未確認**(`apiServer.js` に `req.on('close')` 等の処理が見当たらないので、止まらない可能性が高い) |
| バージョン | `/health` は `{status, service, engines, generationConfigured, configured, ardyUrl}` で**アプリの版を返さない**。`/openapi.json` の `info.version` は `1.0.0` 固定でAPIの版。アプリの版(1.1.9)はHTTPからは取れない |
| 生存確認 | `GET /health` → `{ "status": "ok", ... }`(確認済み。ARDY の状態は `ardyUrl` への別アクセスが要る) |

## 3. 未確認のこと
- 実際に起動して、`format: "vrma"` の応答が VMaid の `checkVrmaBytes` を通るか(VRM 1.0 の VRMA 想定。VMaid の VRM0 モデルでの見え方、骨の向きの扱い。VMaid は VRMA を VRM1 規約として読んでいる)。**実機での確認が必要。**
- 生成にかかる時間(GPU・CPU別)、失敗の頻度、同じ入力の再現性(`seed` を渡せるのは ARDY 直接のみ。`/v1/motions` に `seed` はない)。
- クライアント切断で生成が止まるか。
- 配布実行ファイル(Electron 版)の通信が、ソースと同じか。macOS・Linux での動作。
- サーバー側が `planner`/`use_jev`/`engine` の指定を無視する条件があるか(ソースを通読した範囲では無い)。

## 4. アダプターの契約(案)
```ts
// 拡張の内部。MotionBackend は計画書5.4のとおり
health():   GET  {endpoint}/health            → { ok: status==='ok', detail: engines/ardyUrl }
generate(): POST {endpoint}/v1/motions         body: { prompt, engine:'ardy', planner:'none',
                                                       use_jev:false, format:'vrma',
                                                       duration?  }   // loop は spec 側の自動判定(isLoopFriendly)
            ヘッダー: Content-Type: application/json、(トークンがあれば) Authorization: Bearer
            → 200: VRMA の Uint8Array / 4xx・5xx: { error: { message, code } } を日本語の短い理由に
```
- `loop` を指定する項目は API に**ない**(`spec.loop = isLoopFriendly(spec, text)` で自動判定。`apiServer.js` / `generateMotionWithArdy`)。計画書5.3の「ループ」入力は、**v1 では持たない**(生成物の `loop` は VRMA に含まれる範囲に任せる)。→ 計画書の修正点。
- 進捗: v1 は「生成中…(経過秒)」の表示だけ(8787 には進捗がないため)。2337 の `/progress` を使う案は、接続先を2つ承認させることになるので v1 では見送り、将来の拡張。
- タイムアウト: 既定 5分(設定で変更可)。VMaid 側で `AbortSignal.timeout`。応答サイズ上限は 30MB(VMaid の VRMA 上限と同じ)。
- キャンセル: 接続を切るだけ(サーバー側は止まらない可能性を、画面と説明書に書く)。
- 版の検出: HTTPからはアプリの版が取れないので、「未検証の版なら警告」は**できない**。代わりに、`/openapi.json` の `info.version`(`1.0.0`)を確認し、**想定外ならのみ警告**する。導入説明書に、動作確認した text-to-vrma の版(例: 1.1.9 のコミット)を書く。
- モック: `test/mock-text-to-vrma.mjs`(Node の `http` で、`/health`・`/v1/motions`(vrma / エラー各種 / 遅延 / 巨大応答 / 不正VRMA)を再現)。実ツールなしで契約テストが動く。

## 5. 決めたいこと(ユーザーへ)
1. 上の「ループ入力は持たない」「進捗は経過秒のみ」で良いか(計画書5.3からの変更)。
2. 8787(API)のみを接続先とし、2337(ARDY直接)は使わない方針で良いか。
3. 動作確認の実機テスト(ユーザーが text-to-vrma を入れる)は、P4 の完了時に依頼する。

## 6. 実装結果(2026-10-17。M16)
- 「モーション生成」は、Mod 中心設計に合わせて、**スクリプト Mod**(`examples/mods/motion-gen-textvrma/`)として実装した。アプリには同梱しない(スクリプトを含む Mod は、配布用(公式)にできず、「開発者向け」が ON のときだけ使える。ADR 0005)。
- §4 の契約どおり(`/v1/motions` に、`engine: ardy`・`planner: none`・`use_jev: false`・`format: vrma` を固定で送る。ループの入力は持たない。進捗は「考え中…」のみ。8787 の API だけを使う)。トークンは、Mod の設定項目(secret)に入れる。
- 契約テスト: `src/shared/scripts/motionGenMod.test.ts`(偽の host と、モックの応答で、リクエストの固定値・Authorization・キャッシュ・エラーの日本語化・キュー・クールダウン・件数の上限を確認)。`checkVrmaBytes` は、`host.motion.add` の中(ホスト側)で通る。
- 導入説明書: `docs/guides/motion-gen-setup.md`(2026-10-17 時点の、公式 README に基づく)。
- **未確認(実機)**: text-to-vrma を実際に起動しての生成・VMaid での再生の見え方・生成にかかる時間・クライアント切断での生成の停止。ユーザーの実機で、確認が必要。
- 変更点: `host.http.fetch` に、要求ごとの `timeoutMs`(1 秒〜10 分)と、応答 32MB までを足した(生成に時間がかかるため)。

## 7. 実機での確認の結果(2026-10-18)
- 環境: Windows 11 / RTX 5060 Ti(VRAM 16GB)/ RAM 31GB。text-to-vrma v1.1.9(`53c5050`)+ ARDY(`nvidia/ARDY-Core-RP-20FPS-Horizon40`)。**§2〜§4 の契約どおりに動いた**: `POST /v1/motions`(`engine: ardy`・`planner: none`・`use_jev: false`・`format: vrma`)が、200 + `model/gltf-binary`(約 55〜72KB、4〜6 秒・20fps)を返し、VMaid の `checkVrmaBytes` を通り、VRM・PMX の両方で再生できた。生成は 1〜4 秒(GPU)。
- **§3 の未確認のうち**: 「VMaid の `checkVrmaBytes` を通るか」= 通った。「生成にかかる時間」= 上記。「クライアント切断で生成が止まるか」= 未確認のまま。
- **新しく分かった通信(重要)**: ARDY のエンジン(`server.py`)は、起動のたびに `huggingface.co`(翻訳モデル FuguMT の取得・更新確認)へ接続する(起動後も、keep-alive の接続が 2 本残る)。README の「セットアップ後はオフライン」は、そのままでは正確ではない。**`HF_HUB_OFFLINE=1` `TRANSFORMERS_OFFLINE=1` を付けて起動すると、外部接続は 0 件で、生成も同じに動く**(初回の起動で、翻訳モデルが取得済みであること)。VMaid の Mod は、8787 の API だけに通信する(変わらず)。導入説明書に、この起動方法を書いた。
- インストーラー(`install.ps1`)は、この環境で、2 か所で止まり、手で補う必要があった(導入説明書「実機で分かったこと」)。
- VRM のモデルでは、かがむ・お辞儀の動きが、窓の下へ沈むことがある(関節の持ち上げは、機能 Mod「足の接地補正」が ON のときだけ)。PMX は、VRMA の再生中、常に持ち上げる(2026-10-18 の修正)。

## 8. 会話中の自動ポーズ(2026-11-18)
- AI の返答に付ける `[pose:動きの説明]` を、感情タグ(`[emotion:…]`)と同じ仕組みで、画面・履歴から取り除いて取り出す(`shared/llm/emotionTag.ts`)。ルールのトリガー `poseTag`(「AI が動き(ポーズ)を指定したとき」)で受け、説明は `{{pose}}` としてアクションに渡せる。
- AI にタグを頼む指示文は、本体には入れず、Mod「会話中に自動でポーズ」(`examples/mods/auto-pose/`)の `prompt` に置く。Mod が OFF なら、AI にタグを頼まない(タグが付いても、取り除くだけ)。
- ルールは、モーション生成 Mod のアクション `generateMotion`(`quiet: true`。「考え中…」・失敗を言わない。待ちがあれば、黙ってやめる)に頼む。確率(既定 0.5)と間隔(既定 30 秒)は、Mod のスロットで変えられる。同じ説明は、キャッシュで作り直さない。
- text-to-vrma へ送るのは、動きの説明だけ(AI の返答の文は、送らない)。新しい通信先は、増えない。
- **未確認(実機)**: 小さな LLM が、頼んだ形でタグを付けるか。付ける頻度。ARDY の動きが、説明に合っているか(動きの質は、ADR 0001 §7 のとおり、毎回変わる)。

## 9. 状態表示ウィンドウ(2026-11-18)
- 「ポーズが作られているか」を、目で確かめるための Mod(`examples/mods/status-window/`)。一覧の窓(`host.ui.list`)に、会話(考え中の経過秒)・モーション生成(生成中の経過秒と説明)・AI が `[pose:…]` を付けた割合・直近の出来事(見送りを含む)を出す。通信はしない。
- 本体に、トリガー「返答を始めるとき」(`replyStart`。`{{message}}` = 入力した文)を足し、「返答が終わったとき」(`replyDone`)に、`{{reply}}`(返答の本文)を足した。
- モーション生成 Mod は、権限 `emit` で、状況をトリガー(`generating` / `cached` / `generated` / `failed`)として知らせる。ほかの Mod のルールが、`motion-gen-textvrma/generating` のように受けられる(説明の文などは、運ばない)。
- 「見送り」は、動きの指定のあと 3.5 秒のうちに、生成も再利用も始まらなかったときに、窓のスクリプトが判断する(確率・間隔・モーション生成 Mod の OFF は、区別できない)。

