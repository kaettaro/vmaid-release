# 配布(ビルド・署名・公開)

## ビルド
前提: Node.js 22.12 以上(`.nvmrc`)。**Mac の配布物は Mac で、Windows の配布物は Windows で**ビルドする(`node-llama-cpp` のネイティブバイナリが OS・CPU ごとに違うため)。

| 目的 | コマンド | 出力 |
|---|---|---|
| 動作確認用(インストーラなし) | `npm run build:dir` | `release/mac-arm64/VMaid.app`(Windows は `release/win-unpacked/`) |
| Mac(Apple Silicon)の dmg | `npm run build:mac` | `release/VMaid-<version>-arm64.dmg` |
| Windows(x64)のインストーラ | `npm run build:win` | `release/VMaid Setup <version>.exe`(nsis) |

`build:*` は、型チェック → ビルド → サードパーティのライセンス表記の生成(`THIRD_PARTY_LICENSES.md`)→ パッケージ、の順に行う。
GitHub Actions(`.github/workflows/build.yml`)で、Mac と Windows のビルドを自動で行い、成果物を artifact として保存できる(自動公開はしない)。

- **Intel Mac(x64)**: 現在は arm64 のみ。x64 が必要なら、`electron-builder.yml` の `mac.target.arch` に `x64` を足し、Intel の Mac(または Intel ランナー)でビルドする(`@node-llama-cpp/mac-x64` が必要なため、arm64 の Mac からは作れない)。
- **asarUnpack**: `node-llama-cpp` と `@node-llama-cpp/*` は `app.asar` の外(`app.asar.unpacked`)に展開される。ネイティブバイナリ(`.node`・Metal/Vulkan のライブラリ)を asar の中から読めないため。開発機(Mac・arm64)で、パッケージしたアプリから内蔵LLMが動くことを確認済み。**Windows は未確認**(`docs/MANUAL_TEST.md` の M4)。
- **モデル登録表**: `resources/models.json` は、パッケージでは `Resources/models.json`(`extraResources`)に置かれ、main が `process.resourcesPath` から読む。

## 署名・公証(未実施)
開発中は署名しない方針。配布するときの手順(**ここでは文書化のみ**。Apple・Microsoft のアカウントが必要):

### macOS
1. Apple Developer Program に登録し、「Developer ID Application」証明書を作る。
2. 環境変数 `CSC_LINK`(証明書 .p12)・`CSC_KEY_PASSWORD` を設定し、`electron-builder.yml` の `mac.identity` を証明書の名前にする(現在は ad-hoc 署名の `'-'`)。`hardenedRuntime: true` にする。
3. 公証: `mac.notarize: true` と、`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` を設定する。公証にはハードン済みランタイムと、`node-llama-cpp` のネイティブライブラリの署名が必要(electron-builder が `asarUnpack` 内も署名する)。
4. 公証が済んだ dmg は、警告なしで開ける。

**未署名(いまの状態)で配布する場合**: ad-hoc 署名のため、ダウンロードした dmg のアプリは、初回に Gatekeeper の警告が出る。「右クリック(Control+クリック)→ 開く」で起動できる。それでも開けない場合は、ターミナルで `xattr -dr com.apple.quarantine /Applications/VMaid.app`。
(補足: Electron 本体の署名のままリソースを差し替えると、署名が不整合になって Apple Silicon で「壊れている」と表示されるため、`identity: '-'` の ad-hoc 署名で署名し直している。)

### Windows
未署名だと、SmartScreen が「WindowsによってPCが保護されました」と警告する(「詳細情報 → 実行」で起動できる)。警告を避けるには、コードサイニング証明書(OV/EV)が必要。`CSC_LINK` / `CSC_KEY_PASSWORD` を設定すると electron-builder が署名する。

## 公開
GitHub Releases に、dmg と exe をアップロードする想定(自動アップデートは入れない: 外部通信を増やさない方針)。リリースのたびに、`THIRD_PARTY_LICENSES.md` が最新の依存から生成されていること、利用規約(`docs/TERMS.md`)の確認を行う。

## 既知の依存の警告(`npm audit`)
`electron-builder` の内部依存(`sprintf-js` → `roarr` → `global-agent` → `@electron/get`)に、`npm audit` の中程度(moderate)の警告が8件ある。
いずれも**ビルド時にだけ動く開発用の依存**で、配布するアプリには含まれない(本番依存は `npm audit --omit=dev` で 0 件)。修正版がまだ無い(`sprintf-js` の最新が対象範囲)ため、修正版が出るまで許容する。

## 配布物に含まれるライセンスの確認
- 本番依存 149 パッケージ(`THIRD_PARTY_LICENSES.md` の件数。2026-11-18 時点)は、すべて寛容ライセンス(MIT / ISC / BlueOak-1.0.0 / BSD・Apache の選択)。`npm run licenses` が、寛容でないライセンスを検出するとビルドを止める。
- Electron / Chromium のライセンスは、配布物に同梱(`LICENSE.electron.txt` / `LICENSES.chromium.html`)。
- 内蔵モデル(GGUF)は、アプリに同梱せず、利用者の同意のうえダウンロードする(`resources/models.json`)。いずれも Apache-2.0。

## 公開ベータの ZIP 配布(GitHub Releases。2026-11-24)
Windows のみ・インストーラなし・署名なし。ZIP は GitHub Releases に置く。**再配布できると確認できた素材だけ**を入れる。
- 手順(Windows):
  1. `npm run build:dir`(`release/win-unpacked/`)
  2. `node scripts/build-beta-set.mjs`(`beta/mods/news-rss.vmaidmod`。友人限定の初期セットは `--with-starter` を付けたときだけ作る。公開の ZIP には入れない)
  3. `AliciaSolid.vrm` をリポジトリ直下に置く(`.gitignore` 済み)
  4. `node scripts/make-beta-zip.mjs`(`beta/VMaid-beta-<version>-win.zip`。約 540MB。性格系の公式 Mod(`persona-*`)を取り除き、`.pmx` / `.vmd` / `.gguf` / 音声などが混ざっていれば止まる)
- ZIP の中身: `VMaid/`(本体)/ `Mod/news-rss.vmaidmod` / `Sample/AliciaSolid.vrm` / `README.txt`(`docs/beta-readme.txt`)/ `GUIDE.md`(`docs/BETA_GUIDE.md`)
- **素材**: Alicia Solid(ニコニ立体の配布ページで「再配布 可能」と確認。規約の禁止事項は手順書に明記)と、自動生成のモーションだけ。VRoid 公式 VRMA・aikeya の待機・Spicy 由来のモーションは、権利が不明・禁止のため入れない(入手先を手順書で紹介するだけ)
- 同梱しないもの: 「ふっきれた」、私用 Mod(催眠など)、成人向けの素材、`motion-gen-textvrma`、BGM・効果音、性格系 Mod(リポジトリには残す)
- 新規インストールで最初から ON: 「基本」Mod、機能 Mod の「モーションのタグ」「追いかけ」(`DEFAULT_ON_FEATURES`)
- ライセンス: アプリは MIT(`LICENSE`。配布物の `resources/LICENSE` にも入る)。アプリアイコン(`build/icon.png`)とトレイのアイコン(`resources/tray.png`)は、テーマのピンクの円に白抜きの「Vm」の、自作(`scripts/make-icon.ps1` で生成。2026-11-24)
- 公開前に必要(未対応): 署名、公開リポジトリの履歴の点検(再配布不可の素材は、履歴に無いことを確認済み。`git log` の作者のメールアドレスが公開される点は、公開する人が判断する)
