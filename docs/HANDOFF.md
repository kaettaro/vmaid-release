# 引き継ぎメモ(別のPC・別のClaude Codeセッションで作業を続けるとき)

Mac で進めた作業を、Windows の PC(VS Code の Claude Code 拡張)でも続けられるようにするためのメモ。**Claude の記憶(ユーザー設定の `~/.claude`)は PC ごとに別なので、続きに必要な事情はここと `CLAUDE.md` / `docs/` に書く。**

## 0. 最初にやること(Windows)
1. `git clone https://github.com/kaettaro/vmaid-release.git C:\dev\VMaid`(英数字だけの短いパスに置く。詳細は `docs/WINDOWS_TEST.md`)。
2. Node.js 22.12 以上を入れて `npm ci`。起動は `npm run dev`(VS Code のシェルで `ELECTRON_RUN_AS_NODE` が設定されていたら、先に `Remove-Item Env:ELECTRON_RUN_AS_NODE`)。
3. `CLAUDE.md` と `docs/SPEC.md` を読む(**返答は日本語**、確定事項は勝手に変えない、など)。
4. 手持ちのモデル(`.vrm`)とモーション(`.vrma`)は、リポジトリに入れない(`assets/` は `.gitignore`)。`assets/` に置いて使う。
5. 作業は**ブランチを切って**行い、小さくコミットして push する(Mac 側は、ブランチを見て続きを取り込む)。`main` に直接積まない。

## 1. いまの状態(2026-10-17 時点)
- **M0〜M16 が、一通り完成**(Mod 中心設計への移行を含む)。`main` に取り込み済み。経緯と設計は、`docs/adr/0005-mod-centered-design.md`(Mod 中心設計)、`docs/adr/0001〜0004`、`docs/SPEC.md` §10・§13。
- できたこと(要点): ルールのレジストリ化(Mod の ON/OFF で、使える種類が変わる)/ 公式の機能 Mod(モーションのタグ・足の接地補正・音声合成・効果音(SE)・美化(リアル/トゥーン)・親密度と気分・高度な触れ合い・状態と感情・小道具・MMD 対応・FBX インポーター・PMX インポーター)/ データ Mod(性格 4 種・ダンス・感情反応・ふれあい基本。スロット・`.vmaidmod` の書き出しと取り込み)/ BVH・FBX・VMD の取り込み / 効果を今すぐ解除(Ctrl+Alt+Shift+X)/ スクリプト Mod(「開発者向け」が ON のときだけ。サンドボックス・権限・通信の代行)/ モーション生成 Mod の例(`examples/mods/motion-gen-textvrma`)/ VOICEVOX の自動起動 / ゲーム(機能 Mod `game`。○×を、盤面の窓とチャットで遊ぶ。試作)/ 触れ合いの部位の拡張点(Mod が `touchParts` で部位を宣言)/ 追いかけ(機能 Mod `chase`。視線・頭と首・体ごと。画面全体のカーソルを main が約 30fps で読む)/ 表情・衣装セットの差分レイヤー(重ねる・個別に外す)/ モーション試し再生の別窓 / 内蔵モーションの PMX での再生(骨のクリップを手続き生成。腕の傾きを補正。足は IK 任せ)。
- **以前の最優先の問題(ダンスで足だけが滑る)は、解決済み**: 公式の機能 Mod「足の接地補正」(足ロック・股関節の補正・床へのめり込み補正)。
- **実機での確認が、必要なもの**: `docs/MANUAL_TEST.md` の「未確認」(特に **Mac 列は、ほぼ未実施**。取り込み・書き出し・権限確認のダイアログ、ホットキー、実際の会話での性格・感情タグ、実際の VOICEVOX、text-to-vrma を使った生成)。Windows は、別の userData で、実アプリを起動して、確認した項目が多い。
- 既知の未実装・見送り: 性格 Mod の並べ替え・Mod 単位のルール優先度・マイ Mod の書き出しでのスロット作成・VPD・MMD の物理の細かい設定・`.x` 形式(寛容ライセンスのローダーを確認できず)・スクリプト Mod の更新で権限が増えたときの再確認。
- ダンス Mod(0.2.0): 楽曲の表(設定 → Mod → ダンス。楽曲の名前 → モーション + BGM + 開始位置・音量)。「踊って ○○」「○○を踊って」で、行のモーションと BGM を、同時に始める。表に無い名前は、従来どおり、モーション名として BGM なしで再生。曲のファイルは、利用者が選ぶ(同梱しない)。スロットの値の上限は 20000 文字(表が JSON のため)。
- `release/`(zip・dmg)は `.gitignore` 対象。必要なら、各PCで作る(`npm run build:dir` / `build:win` / `build:mac`)。配布版では、`three/examples` が除外されるため、main で使う three は、バンドルに含めている(`electron.vite.config.ts`)。
- 通信の実測(2026-10-17): Chromium のネットワークログで、外部への通信が 0 件(Chromium のプロキシ自動検出 `wpad` も、`no-proxy-server` で止めた)。

## 2. 次にやること(提案)
1. `docs/MANUAL_TEST.md` の「未確認」を、Mac と Windows の実機で、確かめる。
2. アプリ名・ライセンス(MIT を提案中)・`docs/TERMS.md` の〔 〕の部分を決める。
3. 公式の性格 Mod(特にヤンデレ)の指示文の、文面のレビュー。
4. ADR 0002 の基準値(スクリプト Mod 1 つあたり約 +80MB)の、最終承認。

## 3. 実機確認・デバッグの方法(Mac で使っていたもの)
- ヘッドレスでは透過ウィンドウ・GPU は確認できない。**実アプリを起動して、CDP(Chrome DevTools Protocol)で操作・スクリーンショット**を撮っていた: `npx electron-vite dev -- --remote-debugging-port=9333 --user-data-dir=<別のフォルダ>` で起動し、`http://127.0.0.1:9333/json` の WebSocket に接続して、`Runtime.evaluate` / `Input.dispatchMouseEvent`(Shift は `modifiers: 8`)/ `Page.captureScreenshot` を使う。**`--user-data-dir` は必ず別のフォルダにする**(本物のデータを触らない)。
- 疑似の LLM サーバー: `node scripts/fake-llm-server.mjs 18080`。設定を `backend: openai`、`baseUrl: http://127.0.0.1:18080/v1`、`model: fake` にすると、実LLMなしで会話の画面を確認できる。
- 検証コマンド: `npm run typecheck` / `npm run lint` / `npm test`(すべて緑にしてからコミット)。

## 4. 方針・注意(`CLAUDE.md` の要点と、実装で踏んだ落とし穴)
- 外部通信禁止(モデルのダウンロードと、ユーザーが設定したLLMだけ)。依存は寛容ライセンスのみ。ネイティブ依存は増やさない。素材は同梱しない。
- ロジックは `src/shared/` の純粋な TypeScript に置いて Vitest で試す。パスは `path`、OS差は関数に隔離。Windows でしか確認できない点は `docs/MANUAL_TEST.md` に書く。
- 推測で外部情報を書かない(分からなければ「未確認」)。
- ダイアログは**同期版**(`showOpenDialogSync` など)+ `app.focus({ steal: true })`(macOS で、非同期だと完了が遅れた。Windows では未確認)。
- 透過ウィンドウでは、ドラッグ&ドロップが効かなかった前例がある(ファイル選択ダイアログを使う)。
- VRM0 は `rotateVRM0` で向きを直す。VRMA は VRM1 規約。`vrm.update` の順序: モーション → 表情 → `vrm.update` → モーフ。
- `.gitignore` の `models/` / `assets/` は、**先頭固定(`/models/`)**にしてある(`src/main/models` を巻き込んで追跡されなかった事故があった)。

## 5. Mac 側との受け渡し
- push / pull は、ブランチ単位で。`git pull --rebase` してから push する。衝突したら、止まって相談する。
- 迷ったら、本人(tamo)に確認する。確認すべき未決事項: アプリ名・アプリのライセンス(MIT を提案中)・`docs/TERMS.md`(ドラフト)・アイコン。

## 6. 追記(2026-10-16): ふれあいの拡張とパック(`feat/touch`)
- 触っている領域: `src/shared/rules/*`(新しいトリガー・条件・アクション)、`src/shared/touch/{gesture,charState}.ts`、`src/shared/packs/*`、`src/main/{packStore,packActions,charStateStore}.ts`、`src/renderer/character/{useRules,characterController,App}.tsx`、`src/renderer/settings/PacksTab.tsx`、`resources/mods/official/`。
- **私用パックは、Git に入らない**(再配布不可の素材)。作り方: `node scripts/fetch-private-pack.mjs`。別のPCへ移すには、`.vmaidpack`(`docs/WINDOWS_TEST.md` §10)。素材の出典・規約: `docs/MOTION_SOURCES.md`。**確認できない素材を、`resources/mods/official/`(配布物)に入れない**(テストが `.vrma` 等の混入と、`redistributable: true` の無いモーションを検出する)。

