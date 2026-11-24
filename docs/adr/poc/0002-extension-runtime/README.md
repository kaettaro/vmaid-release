# ADR 0002 の PoC(使い捨ての実験コード)

本体(`src/`)には含まれない。拡張の実行方式(非表示の `BrowserWindow` + 専用 partition + 専用プロトコル + CSP + `host.http` ゲート)が成立するかを確かめた。**製品コードではない**(エラー処理・型・テストは省略)。

実行(リポジトリのルートで。`ELECTRON_RUN_AS_NODE` を unset):
```
node_modules/.bin/electron docs/adr/poc/0002-extension-runtime
```
終わると、このフォルダに `result.json`(各試行の結果・メモリ・時間)が書かれる(コミットしない)。
