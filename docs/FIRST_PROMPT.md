# VS Code のエージェントに最初に貼る文章

以下をそのまま貼る(CLAUDE.md は自動で読まれる想定。読まれない場合は先に読ませる)。

---

CLAUDE.md と docs/SPEC.md を読んでください。このプロジェクトは、VRMモデル・VRMAモーション・ローカルLLMを換装できる常駐3Dコンパニオンアプリ(Electron、Win/Mac対応)です。

まず M0(プロジェクトの土台)だけ進めてください。
- electron-vite + TypeScript で雛形を作る(レンダラーのUIは React)
- Vitest、ESLint、型チェックを入れる
- 開発起動で、空のウィンドウが Mac と Windows で立ち上がること
- `.gitignore`(`assets/`、`node_modules/`、ビルド成果物)と、`docs/MANUAL_TEST.md` の雛形を作る
- CLAUDE.md の「よく使うコマンド」を実際の内容に更新する

終わったら、私が手元で確認するための手順を出してください。M1以降は確認が取れてから進めます。
迷う点があれば、先に選択肢と推奨案を短く示してください。

---

## 補足(渡す前に用意しておくもの)
- 手持ちのVRMモデル 1体(`assets/models/` に置く。Gitには入れない)
- 手持ちのVRMAモーション 数個(`assets/motions/`)。無ければ M2 で調達方法を相談する
- 開発用に Ollama を入れておくと、M3 で内蔵LLMなしでも会話を試せる(任意)
