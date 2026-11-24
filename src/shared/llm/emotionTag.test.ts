import { describe, expect, it } from 'vitest'
import { EmotionTagFilter, stripEmotionTags } from './emotionTag'

/** 断片(チャンク)の列を流して、画面に出る文字と、取り出したタグを返す */
function run(chunks: string[]): { text: string; tags: string[] } {
  const f = new EmotionTagFilter()
  let text = ''
  const tags: string[] = []
  for (const c of chunks) {
    const r = f.push(c)
    text += r.text
    tags.push(...r.tags)
  }
  const last = f.flush()
  return { text: text + last.text, tags: [...tags, ...last.tags] }
}

describe('感情タグのフィルタ', () => {
  it('タグを取り除いて、感情の名前を取り出す', () => {
    expect(run(['こんにちは![emotion:joy]'])).toEqual({ text: 'こんにちは!', tags: ['joy'] })
    expect(run(['[Emotion: shy ]照れるな'])).toEqual({ text: '照れるな', tags: ['shy'] })
    expect(run(['a[emotion:joy]b[emotion:sad]c'])).toEqual({ text: 'abc', tags: ['joy', 'sad'] })
  })

  it('タグが、断片をまたいでも取り逃がさない(1文字ずつ届いても同じ)', () => {
    const whole = '嬉しい[emotion:joy]です。'
    expect(run([...whole])).toEqual({ text: '嬉しいです。', tags: ['joy'] })
    expect(run(['嬉しい[emo', 'tion:j', 'oy', ']です。'])).toEqual({ text: '嬉しいです。', tags: ['joy'] })
  })

  it('タグではない角かっこは、そのまま出す。途中で終わった `[emo` も、文字として出す', () => {
    expect(run(['配列は [1, 2] です'])).toEqual({ text: '配列は [1, 2] です', tags: [] })
    expect(run(['[emotional]'])).toEqual({ text: '[emotional]', tags: [] })
    expect(run(['はい[emo'])).toEqual({ text: 'はい[emo', tags: [] })
    expect(run(['[emotion:'])).toEqual({ text: '[emotion:', tags: [] })
  })

  it('頼んだ形でない、よくある崩れた形も取り除く(`[joy]` `[shy]` など)', () => {
    expect(run(['嬉しい[joy]'])).toEqual({ text: '嬉しい', tags: ['joy'] })
    expect(run(['照れる…[Shy]'])).toEqual({ text: '照れる…', tags: ['Shy'] })
    expect(run(['はい【surprised】'])).toEqual({ text: 'はい', tags: ['surprised'] })
    expect(run(['[emotion=sad]ううっ'])).toEqual({ text: 'ううっ', tags: ['sad'] })
    expect(run(['【emotion:joy】やった'])).toEqual({ text: 'やった', tags: ['joy'] })
  })

  it('崩れた形も、断片をまたいで取り除く(1文字ずつでも同じ)', () => {
    expect(run([...'嬉しい[joy]'])).toEqual({ text: '嬉しい', tags: ['joy'] })
    expect(run(['嬉しい[sh', 'y]'])).toEqual({ text: '嬉しい', tags: ['shy'] })
    expect(run([...'ね[emotion: shy]'])).toEqual({ text: 'ね', tags: ['shy'] })
  })

  it('既知の感情名でない括弧は、残す', () => {
    expect(run(['[メモ] と [abc] と [OK]'])).toEqual({ text: '[メモ] と [abc] と [OK]', tags: [] })
    expect(run(['[sh'])).toEqual({ text: '[sh', tags: [] }) // 途中で終わった形は文字として出す
    expect(run(['[shyness]'])).toEqual({ text: '[shyness]', tags: [] })
  })

  it('stripEmotionTags: 保存済みの返答から取り除く。ふつうの括弧は残す', () => {
    expect(stripEmotionTags('こんにちは![joy]')).toBe('こんにちは!')
    expect(stripEmotionTags('はい[emotion:shy]')).toBe('はい')
    expect(stripEmotionTags('配列は [1, 2] です')).toBe('配列は [1, 2] です')
    expect(stripEmotionTags('括弧なし')).toBe('括弧なし')
  })

  it('長すぎる・空の名前は、タグとして扱わない', () => {
    expect(run(['[emotion:]x']).tags).toEqual([])
    expect(run([`[emotion:${'a'.repeat(30)}]`]).tags).toEqual([])
  })
})

describe('動きの指定タグ [pose:…]', () => {
  const runAll = (chunks: string[]): { text: string; tags: string[]; poses: string[] } => {
    const f = new EmotionTagFilter()
    let text = ''
    const tags: string[] = []
    const poses: string[] = []
    for (const c of chunks) {
      const r = f.push(c)
      text += r.text
      tags.push(...r.tags)
      poses.push(...r.poses)
    }
    const last = f.flush()
    return { text: text + last.text, tags: [...tags, ...last.tags], poses: [...poses, ...last.poses] }
  }

  it('画面に出す文字から取り除き、説明だけを取り出す(感情タグとは別)', () => {
    expect(runAll(['[emotion:joy][pose:両手を上げて喜ぶ]やったね!'])).toEqual({ text: 'やったね!', tags: ['joy'], poses: ['両手を上げて喜ぶ'] })
    expect(runAll(['うん、[Pose: 首をかしげる ]そうだね'])).toEqual({ text: 'うん、そうだね', tags: [], poses: ['首をかしげる'] })
    expect(runAll(['【pose:お辞儀する】こんにちは'])).toEqual({ text: 'こんにちは', tags: [], poses: ['お辞儀する'] })
  })

  it('断片をまたいでも、取り逃がさない・文字を残さない', () => {
    const whole = '[pose:ぺこりとお辞儀する]ありがとう'
    for (let i = 1; i < whole.length; i++) {
      expect(runAll([whole.slice(0, i), whole.slice(i)])).toEqual({ text: 'ありがとう', tags: [], poses: ['ぺこりとお辞儀する'] })
    }
    expect(runAll([...whole])).toEqual({ text: 'ありがとう', tags: [], poses: ['ぺこりとお辞儀する'] })
  })

  it('長すぎる説明は、取り出さない(文字は消える)。ふつうの括弧は残す', () => {
    const long = 'あ'.repeat(101)
    expect(runAll([`[pose:${long}]こんにちは`]).poses).toEqual([])
    expect(runAll(['[メモ]ポーズの話']).text).toBe('[メモ]ポーズの話')
  })

  it('保存済みの文からも、取り除く(履歴を、LLM に渡す前)', () => {
    expect(stripEmotionTags('[emotion:joy][pose:ばんざいする]やった')).toBe('やった')
  })
})
