// VMD のモーフ名(MMD の表情名)→ VRM の表情プリセット名。VMD を VRM 用に変換するときの逆引き表(純粋データ)。
// 同じ表情に複数のモーフが当たるときは、フレームごとに大きいほうを使う。
// 「ウィンク」は、キャラの左目を閉じるほうとして対応づけている(モデルによって左右が逆のことがある。実機での確認が必要)。

export const MORPH_TO_VRM: Readonly<Record<string, string>> = {
  まばたき: 'blink',
  ウィンク: 'blinkLeft',
  ウィンク２: 'blinkLeft',
  ウィンク右: 'blinkRight',
  ウィンク２右: 'blinkRight',
  あ: 'aa',
  い: 'ih',
  う: 'ou',
  え: 'ee',
  お: 'oh',
  笑い: 'happy',
  にっこり: 'happy',
  にこり: 'happy',
  喜び: 'happy',
  怒り: 'angry',
  悲しい: 'sad',
  悲しみ: 'sad',
  困る: 'sad',
  なごみ: 'relaxed',
  びっくり: 'surprised',
  驚き: 'surprised',
  おどろき: 'surprised'
}
