import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { mvPluginText } from '@/lib/translate/mv-plugin-text'
import { extractDialogueFromEvents } from '@/services/extract/lib/dialogue'
import { extractTextResource, textResourceFiles } from '@/services/extract/lib/text-resources'

it('reads MV custom questions and choices without treating command arguments as visible text', () => {
  const block = extractDialogueFromEvents(
    [
      {
        id: 1,
        list: [
          { code: 356, parameters: ['LL_GalgeChoiceWindowMV setMessageText OPを見ますか？'] },
          { code: 356, parameters: ['LL_GalgeChoiceWindowMV setChoices 見る（初回推奨）,飛ばす'] },
          { code: 356, parameters: ['LL_GalgeChoiceWindowMV setBackgroundImage 画像名'] },
          { code: 356, parameters: ['OtherPlugin eval 内部処理'] },
        ],
      },
    ],
    { map: 52 }
  )
  expect(block.map((item) => item.lines || item.choices)).toEqual([['OPを見ますか？'], ['見る（初回推奨）', '飛ばす']])
  expect(mvPluginText('LL_GalgeChoiceWindowMV setMessageText')).toEqual({ kind: 'message', texts: [] })
})

it('reads nested JSON values, quoted CSV fields and TXT lines as text resources', () => {
  expect(extractTextResource('strings.json', '\uFEFF{"message":"村へ行こう", "nested":"[\\"こんにちは\\"]", "script":"function() { 内部処理 }"}')).toEqual([
    '村へ行こう',
    'こんにちは',
  ])
  expect(extractTextResource('dialogue.csv', 'id,text\r\n1,"こんにちは、\n村へ行こう"\r\n2,"彼は""勇者""です"')).toEqual(['こんにちは、\n村へ行こう', '彼は"勇者"です'])
  expect(extractTextResource('dialogue.txt', '100\nhello\n村へ行こう\nこんにちは')).toEqual(['hello', '村へ行こう', 'こんにちは'])
})

it('finds additional resources without scanning saves, generated translation files or standard event JSON again', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-text-resources-'))
  try {
    for (const file of [
      'data/Map052.json',
      'data/Items.json',
      'data/extra.json',
      'text/story.csv',
      'story.txt',
      'js/plugins/extra.json',
      'save/file1.json',
      'chaya/translate/seed.json',
      'img/subtitle.txt',
      'js/libs/sample.json',
      'package.json',
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), '{}')
    }
    expect([...textResourceFiles(root, { fs, path })].sort()).toEqual(['data/extra.json', 'js/plugins/extra.json', 'story.txt', 'text/story.csv'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
