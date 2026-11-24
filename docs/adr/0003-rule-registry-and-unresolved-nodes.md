# ADR 0003: ルール定義のレジストリ化と、未解決ノードの扱い

- 状態: **承認(2026-10-16、ユーザー承認)。Mod 中心設計への移行に伴い、用語を「拡張」→「Mod」に読み替える**
- 日付: 2026-10-15
- 関連: `docs/PLAN_extensions_and_motion-gen.md` 4.6 / 不変条件2〜4 / `docs/adr/0002-extension-runtime.md`
- 調査範囲: `src/shared/rules/*`、`src/renderer/settings/rules/*`、`src/renderer/character/useRules.ts`、`src/main/rulesActions.ts`(読んだだけで、コードは変更していない)

## 1. 結論(案)
1. トリガー・条件・アクションの定義(いまは `definitions.ts` の静的な配列)を、**`RuleRegistry` という値**にして、参照する側が**引数(省略時は内蔵のみ)で受け取る**。省略時の結果は今と同一なので、**既存テスト(`rules.test.ts` 44箇所・`edit.test.ts` 37箇所の参照)は無修正で緑のまま**になる。
2. 拡張が足すノードの種類名は、**`<拡張id>/<種類>`**(例 `motion-gen-textvrma/generateMotion`)と**名前空間つき**にする(計画書の例の `generateMotion` 単体から変更)。理由: 内蔵・他の拡張との衝突を避けられ、「未導入の拡張のノードか、ただの打ち間違いか」を**文字列だけで区別できる**(§3)。
3. **未解決ノード**(レジストリに無い、名前空間つきの種類)は、**エラーにせず、中身をそのまま保持する**。「解決できているか」は**保存せず、都度計算する**(`analyzeRuleSet`)。→ YAMLに余計な印が出ず、往復で何も失われない。
4. **未解決ノードを1つでも含むルールは、エンジンが実行しない**(計画書4.6のとおり)。いまのエンジンは未知の条件を**黙って無視する**(§2.3)ため、これを明示的に止める変更が必須。
5. 変数展開(`{{message}}` / `{{rest}}`)は、エンジンの `resolveActions` で、**パラメータが `template: true` のものだけ**に行う。`say.text` も `template: true` にする(§5)。
6. `ActionRequest` に `{ kind: 'extension', extensionId, action, params, ruleId }` を足す。実行はレンダラー → main → 拡張ホストの順で中継する(P3)。P1 では**型とエンジンの出力まで**で、何も実行しない。

## 2. 現状の調査結果

### 2.1 定義を参照している場所(これで全部)
`grep` の結果(テストを除く):
| ファイル | 使い方 |
|---|---|
| `src/shared/rules/schema.ts` | `findDef` / `nodeDefs` / `TYPE_KEY`(`validateNode`。種類が無ければ**エラー**) |
| `src/shared/rules/edit.ts` | `findDef` / `TYPE_KEY`(`newNode`) |
| `src/renderer/settings/rules/NodeEditor.tsx` | `findDef` / `nodeDefs` / `TYPE_KEY`(種類の選択と、パラメータ欄の自動生成) |
| `src/renderer/settings/rules/RuleEditor.tsx` | `nodeDefs`(「アクションを追加」などのメニュー) |
| `src/renderer/settings/rules/ParamField.tsx` | `ParamDef` の型だけ |
| `src/shared/rules/engine.ts` | **定義は参照していない**(種類名の文字列で `switch`) |
| `src/shared/rules/lint.ts` | **定義は参照していない**(`playMotion` / `userMessage` を名前で見る) |
| `src/main/rulesActions.ts` | **定義は参照していない**(取り込み確認で `a.action` の文字列を並べる) |
→ 定義を使うのは**4ファイルだけ**。レジストリ化の影響は小さい。

### 2.2 いまの挙動(変更の前提)
- `validateNode`(`schema.ts` 約50〜95行): 種類が無い → エラー(**ファイル全体が不正**になり、いまのルールが使い続けられる)。未知のキー → エラー(打ち間違いの検出)。`playMotion` の `motion`/`group` 排他は名前で特別扱い。
- `parseRuleSet`: 1件でも問題があれば `ruleSet: null`。
- `stringifyRuleSet`: `yaml` の `stringify(ruleSet)` に**オブジェクトをそのまま渡す**(コメントは落ちる。既知)。→ ノードがプレーンなオブジェクトなら、**中身は往復で保たれる**(キーの順序は保たれる)。
- `NodeEditor.tsx`: 種類が未知のノードは `<option>{type}(未知の種類)</option>` を出し、パラメータ欄は出さない。**種類を選び直さない限り、ノードは書き換わらない**(`onChange` が元の `node` をそのまま保つ)。
- `engine.ts`: `triggerMatches` は未知のトリガーで `false`(安全)。`resolveActions` は `switch (a.action)` で、未知のアクションは**黙って捨てる**。

### 2.3 見つかった落とし穴(重要)
- **`conditionsPass`(`engine.ts` 約168行)は、`probability` と `cooldown` 以外の条件を黙って通す**(未知の条件 = 条件なし扱い)。いまは検証が未知の種類を弾くので起きないが、**未解決ノードを許すと、拡張の条件が無視されたまま、ルールが発火する**。→ 未解決ノードを含むルールは、エンジンが**実行前に止める**必要がある(結論4)。
- `resolveActions` が未知のアクションを黙って捨てると、**同じルールの他のアクションだけが動く**(意図と違う半端な動き)。→ 同上。
- `mergeRuleSets` / `duplicateRule`(`edit.ts`)は、ノードを**そのまま**コピーするので、未解決ノードも失われない(`structuredClone` は、プレーンなデータならすべて保つ)。`renameMotionInRuleSet` / `renameGroup` は `playMotion` だけを書き換えるので、拡張のノードに触れない。
- `importRules`(`rulesActions.ts`)の確認文は `a.action` を並べるだけ。未導入の拡張のノードは、**名前空間つきの名前がそのまま出る**ので、取り込む人が「拡張が要るルール」と分かる。拡張名つきの表示は P2 で足す。

## 3. 設計

### 3.1 `RuleRegistry`
```ts
// src/shared/rules/registry.ts(新規)
export interface RegisteredDef extends NodeDef { extensionId?: string; extensionName?: string }   // 拡張のものにだけ付く
export interface RuleRegistry { defs(kind: NodeKind): readonly RegisteredDef[]; find(kind: NodeKind, type: string): RegisteredDef | undefined }
export const BUILTIN_REGISTRY: RuleRegistry   // definitions.ts の TRIGGERS / CONDITIONS / ACTIONS から作る
export function withExtensions(base: RuleRegistry, contributions: Array<{ extensionId: string; extensionName: string; defs: Record<NodeKind, NodeDef[]> }>): RuleRegistry
```
- 拡張の `type` は、レジストリに入れるときに `<extensionId>/<type>` に直す(manifest 側は修飾なしで書ける)。
- `ParamDef` に `template?: boolean` を足す(任意)。拡張の定義は、`ParamKind` のうち、`secret` 以外のものだけ使える(manifest の zod 検証で縛る。P2)。
- 引数にする関数: `parseRuleSet(raw, registry = BUILTIN_REGISTRY)` / `parseRuleSetYaml(text, registry?)` / `newNode(kind, type, ctx, registry?)` / `newRule(rs, ctx, registry?)` / `lintRuleSet(rs, ctx)`(`ctx.registry?`)/ `new RuleEngine(env, ruleSet?)`(`env.registry?`)と `engine.setRegistry(reg)`。`definitions.ts` の `findDef` / `nodeDefs` / `TYPE_KEY` は、**内蔵だけを見る旧APIとして残す**(テストと内蔵コードが使っている間は)。

### 3.2 未解決ノード
- **名前空間つきの判定**: 種類名が `^[a-z0-9][a-z0-9-]{2,40}/[A-Za-z0-9_-]{1,64}$` に合う。
- `validateNode` の分岐:
  1. 内蔵の種類(名前空間なし) → いまのまま(未知ならエラー)。
  2. 名前空間つきで、レジストリにある → 定義どおりに検証・正規化。**ただし、検証に失敗しても、ファイル全体のエラーにはしない**(拡張の更新でパラメータが変わった場合に、ルールファイル全体が壊れないように)。そのノードは「**解決済みだが不正**」として、解析結果(§3.3)に理由を残し、中身はそのまま保持する。
  3. 名前空間つきで、レジストリにない → **未解決**。中身(キーと値)は、**JSON互換の値だけ**を許し(関数・循環は不可。YAMLから来る値は元々そう)、深さ・サイズの上限(例: 深さ6、全体 20KB)を超えたらエラー(悪意あるYAMLの肥大化を避ける)。
  4. 名前空間つきでない未知の種類 → いまのまま**エラー**(打ち間違いを検出し続ける)。
- **印は保存しない**。`Rule` / `RuleNode` / YAML に余計な項目を足さない。

### 3.3 `analyzeRuleSet`(純粋関数)
```ts
export type NodeProblem = { path: string; kind: NodeKind; type: string } & (
  | { status: 'missing-extension'; extensionId: string }
  | { status: 'invalid-params'; messages: string[]; extensionId: string })
export function analyzeRuleSet(rs: RuleSet, registry: RuleRegistry): Map<string /*ruleId*/, NodeProblem[]>
```
- エンジン(`setRuleSet` / `setRegistry` で `blocked: Set<ruleId>` を作る)、`lintRuleSet`(警告文)、設定画面(バッジ・「拡張『xxx』が必要です」・不正パラメータの理由)が、**同じ関数**を使う。
- 拡張が有効/無効になって**レジストリが変わったら、保存済みのYAMLを、新しいレジストリで読み直す**(`useRules` と `RulesTab` は、`onRulesChanged` に加えて、レジストリの変更通知で再パースする)。→ 拡張を入れた瞬間に、保存済みの未解決ノードが有効になり、既定値の補完・検証が掛かる。

### 3.4 エンジンの変更(`engine.ts`)
- `appliesToCharacter`(キャラの対象)と同じ位置に、`isBlocked(rule)`(= `blocked` に含まれる)を追加し、`tryFire` の最初で止める。**`testFire` も止める**(未解決のルールをテスト発火しても何も起きず、設定画面に理由を出す)。
- `resolveActions(rule, event?)`: 拡張のアクションは、**`defs` の既定値を補い**(`normalizeParams`)、`template: true` のパラメータを展開して、`{ kind: 'extension', extensionId, action, params, ruleId }` を返す(`playMotion` のグループ解決と同じ層)。
- 変数展開の入力: `userMessage` イベントの `text`。`testFire(ruleId, sample?)` は、テスト用の入力例を受け取れる。

### 3.5 設定画面の変更
- `FormContext` に `registry` を足し、`NodeEditor` / `RuleEditor` は `nodeDefs(kind)` / `findDef` の代わりに `ctx.registry` を使う。
- 拡張由来のノードには**拡張名のバッジ**。未解決は、パラメータ欄の代わりに「**拡張『<id>』が必要です**(中身は保持されます)」と、**読み取り専用のJSON表示**を出す(中身が見えない不安を避ける)。種類を選び直すまでノードは変わらない(現状と同じ)。
- 「トリガー/条件/アクションを追加」のメニューには、有効な拡張のものだけが出る。

## 4. YAMLの往復の方針と、先に書くテスト
**方針**: ノードは**プレーンなオブジェクトのまま**保つ(クラス・ラッパー・印を使わない)。`stringifyRuleSet` は今の実装のまま。

**P1 で、実装より先に書くテスト(最初は未実装で赤)**:
1. 未解決の `action: some-ext/doThing`(数値・文字列・真偽値・配列・入れ子のオブジェクト・日本語・空文字・`null` を含むパラメータ)を含むYAMLを、`parseRuleSetYaml` → `stringifyRuleSet` → `parseRuleSetYaml` して、**ルールが deep-equal**。
2. 同じ入力から、**他のルール・グループ・既存ノードが変わらない**(未解決のあるファイルでも、内蔵のルールは検証・正規化される)。
3. 未解決ノードを含むファイルが、**エラーにならず `ruleSet` が返る**。ただし、名前空間なしの未知の種類(`action: dance`)は**エラーのまま**。
4. `mergeRuleSets` / `duplicateRule` / `moveRule` / `toggleRule` / `renameGroup` / `renameMotionInRuleSet` / `deleteRule` のあとでも、未解決ノードが残る。
5. 未解決ノードを含むルールは、**`handle` で発火しない・`testFire` で何も返さない**。他のルールは動く。未解決の**条件**があるルールも発火しない(§2.3 の回帰テスト)。
6. 拡張が登録されたレジストリでは、同じルールが**既定値の補完つきで動く**(`extension` の `ActionRequest` が出る)。パラメータが不正なら、ファイルはエラーにならず、そのルールだけが止まり、`analyzeRuleSet` が理由を返す。
7. 内蔵のみのレジストリ(既定)では、**現在のテストの結果と同一**(既存テストが無修正で緑)。
8. 変数展開: `{{message}}` / `{{rest}}` が、`template: true` のパラメータだけで展開される。`equals` のときは `{{rest}}` が空。区切り(`:` `：` 空白)の除去。一致が全角/半角・大文字小文字で揺れても `rest` が**元の入力**から取れる(§5)。`say` でも使える。**入力文の中の `{{message}}` は再展開されない**。`userMessage` 以外のイベントでは空文字。
9. 種類名の判定(正規表現)の境界: 大文字・`/` が2つ・空の拡張id・長さ。

## 5. 変数展開の詳細(`{{rest}}` の取り方)
- 既存の判定(`keywordMatches`)は、**正規化した文字**(NFKC・小文字・空白と記号を除去)で一致を見る。`{{rest}}` は**元の入力**から取りたいので、正規化時に、**正規化後の各文字 → 元の文字位置**の対応表を作る(NFKC で長さが変わる文字は、元の1文字が複数の文字に対応)。一致した言葉の**最後の位置**の次から、元の文字列を切り出し、先頭の `:` `：` 空白を取り除く。
- 一致が複数ある(`keywords` の複数)ときは、**最初に一致した言葉**(`keywords` の順)を使う。`equals` は常に空。
- 展開は**1回だけ**(展開結果は再展開しない)。変数名は `message` と `rest` の2つ(将来 `{{match}}` などを足せる)。未知の `{{x}}` は、**そのまま残す**(文字として)。
- 計画書の「変数展開は `say` にも使える汎用機能」に沿い、**`say.text` に `template: true` を付ける**。ただし**内蔵 `say` の既存ルール**(`{{` を含まない文)は、変わらない。`{{` をそのまま出したい人のために、**エスケープは用意しない**(必要になったら足す)。

## 6. 影響を受けるファイル(P1 の変更一覧)
| 種別 | ファイル | 変更 |
|---|---|---|
| 新規 | `src/shared/rules/registry.ts`(+ test) | `RuleRegistry` / `BUILTIN_REGISTRY` / `withExtensions` / `analyzeRuleSet` / 種類名の判定 |
| 新規 | `src/shared/rules/template.ts`(+ test) | 変数展開と `rest` の位置対応 |
| 変更 | `src/shared/rules/definitions.ts` | `ParamDef.template`、`say.text` に `template: true`、旧APIは残す |
| 変更 | `src/shared/rules/schema.ts` | `registry` 引数、§3.2 の分岐、サイズ上限 |
| 変更 | `src/shared/rules/yaml.ts` | `registry` 引数を通すだけ |
| 変更 | `src/shared/rules/types.ts` | `ActionRequest` に `extension`、`RuleEvent` はそのまま |
| 変更 | `src/shared/rules/engine.ts` | `isBlocked` / `setRegistry` / `resolveActions(rule, event)` / `testFire` の入力例 |
| 変更 | `src/shared/rules/edit.ts` | `newNode` / `newRule` に `registry` |
| 変更 | `src/shared/rules/lint.ts` | 未解決・不正パラメータの警告 |
| 変更 | `src/renderer/settings/rules/{NodeEditor,RuleEditor,ParamField,RulesTab}.tsx` | `ctx.registry`、バッジ、未解決の表示 |
| 変更 | `src/renderer/character/useRules.ts` | レジストリの変更で再パース。`extension` の `ActionRequest` は、P1 では**何もしない**(P3 で中継) |
| 変更(P2) | `src/main/rulesActions.ts` | 取り込み確認に拡張名・未導入の表示 |
| 新規(P2) | IPC: レジストリの取得と変更通知 | `src/shared/ipc.ts` / preload / main |

## 7. 移行手順(各コミットで `typecheck` / `lint` / `test` が緑)
1. **テストを先に追加**(§4 の 1〜9。実装がないものは `it.todo` ではなく、期待する関数を使って赤で書く → 実装と一緒にコミット、またはブランチ内で赤→緑)。
2. `registry.ts`(内蔵のみ)を足し、引数を通す。**挙動は変えない**(既存テストが緑のまま)。
3. `schema.ts` に未解決ノードの分岐を足す(§4 の 1〜4)。
4. `analyzeRuleSet` と、エンジンの `isBlocked`(§4 の 5・6)。
5. 変数展開と `ActionRequest.extension`(§4 の 8)。
6. 設定画面(バッジ・未解決表示)。実アプリで、拡張が無い状態の「未解決」表示を確認。
7. P2 以降: IPC でレジストリを供給。

## 8. 未確認・リスク
- 名前空間つきの種類名を YAML の平文(`action: motion-gen-textvrma/generateMotion`)で書けること: `yaml` ライブラリで往復する(§4 の 1)で確認する。**未実施**。
- `{{rest}}` の位置対応は、NFKC で文字数が変わる文字(合字・全角カナの濁点結合など)と、サロゲートペア(絵文字)の境界に注意が要る(コードポイント単位で扱う)。テストで固める。
- GUI の `RuleEditor` は、ルールのキー(`characters` を含む)を知っている項目だけを編集する。**将来ルールに新しい項目を足したとき、古い本体がその項目を落とさない**ための方針(未知キーの保持)は、今回の範囲外(今は、未知キーは**エラー**)。
- 条件(condition)の拡張は v2(計画書4.3)。ただし**未解決の条件は、P1 で既に「ルールを止める」扱い**にする(§2.3)。

## 9. 決めたいこと(ユーザーへ)
1. 種類名を `<拡張id>/<種類>` と名前空間つきにする(計画書の例からの変更)で良いか。
2. 拡張ノードのパラメータ検証の失敗は、**ファイル全体のエラーにせず、そのルールだけを止める**で良いか(内蔵ノードは、いまのままエラー)。
3. 未解決ノードを含むルールは、**そのルール全体を実行しない**で良いか(他のアクションだけ動かす案は、半端な動きになるため不採用)。

## 10. 補遺(2026-10-16): Mod が「コアのノードへパラメータを足す」場合
Mod 中心設計(`docs/adr/0005-mod-centered-design.md`)では、Mod が足すのは新しい種類のノードだけでは足りない。例: モーションのタグ Mod が `playMotion` に `tag` を、高度な触れ合い Mod が `click` に `part` / `side` を足す。
1. `RuleRegistry` に **「パラメータの追加(提供元の modId つき)」** を持たせる。書式は名前空間を付けず、今のまま(`tag: ダンス`)。
2. 提供元の Mod が OFF のとき、そのパラメータを持つノード(ルール)は **未解決として扱う**(保持・往復は保つ、実行はしない。§1 の 3・4 と同じ)。
3. 内蔵ノード自体(`playMotion` 等)は常に解決できる。解決できないのは「Mod が足したパラメータ」だけで、lint は「Mod ○○ を ON にすると使えます」と示す。
