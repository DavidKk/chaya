import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DB_SPECS } from '@/lib/translate/database-fields'
import { detectSourceLanguage, isSourceText } from '@/lib/translate/source-text'
import { extractPluginSeed } from '@/plugins/src/translator/runtime/extract'
import { extractDataFields, extractNoteText } from '@/services/extract/lib/data-fields'
import { runExtract } from '@/services/extract/lib/main'
import { extractPluginText } from '@/services/extract/lib/plugin-text'
import { extractTextResource } from '@/services/extract/lib/text-resources'
import { shouldTranslate } from '@/services/translate/text-classify'

it('classifies source languages from actual prose and filters identifiers without rejecting visible English words', () => {
  expect(detectSourceLanguage(['こんにちは。', '村へ行きましょう。', '勇者'], 'en_US')).toBe('ja')
  expect(detectSourceLanguage(['Welcome to the village.', 'Would you like to enter?', 'Potion'], 'ja_JP')).toBe('en')
  expect(detectSourceLanguage(['欢迎来到村庄。', '是否进入地下室？', '治疗药水'], 'ja_JP')).toBe('zh')
  expect(isSourceText('Potion', 'en')).toBe(true)
  for (const value of ['Continue', 'iPhone', 'fooBar', 'A', 'I', 'ON', 'OFF']) expect(isSourceText(value, 'en')).toBe(true)
  expect(isSourceText('if you need help, ask the guard.', 'en')).toBe(true)
  expect(isSourceText('for the king!', 'en')).toBe(true)
  expect(isSourceText('return to town.', 'en')).toBe(true)
  expect(isSourceText('地下室', 'ja')).toBe(true)
  expect(isSourceText('こんにちは', 'zh')).toBe(false)
  for (const value of [
    'abc_abc',
    'chara_celica_walk_1501',
    'EV003',
    'img/actor.png',
    'img/Actor1',
    'Dragon.png',
    '$gameVariables.value(1)',
    'function() { return "Hello"; }',
    '{actor}',
    String.raw`\C[1]`,
    '_actor _num',
  ]) {
    expect(isSourceText(value)).toBe(false)
  }
  expect(shouldTranslate('Would you like to enter?')).toBe(true)
  expect(shouldTranslate('Potion')).toBe(true)
  expect(shouldTranslate('abc_abc')).toBe(false)
  expect(shouldTranslate('HP 20')).toBe(false)
})

it('collects notes and nested visible fields while rejecting resource names, scripts and configuration tags', () => {
  const data = {
    name: 'Slime',
    battlerName: 'Slime',
    characterName: 'Actor1',
    profile: 'A traveller from the north.',
    description: 'Restores 100 HP.',
    note: 'A legendary sword.\n<TOES変数対象:1004>\nBreath Motion: 1\n<description: Wielded by heroes>\n<Custom Effect>\na.hp += 10;\n</Custom Effect>',
    custom: { label: 'Attack', text: 'Defend', image: { name: 'Dragon' }, bgm: { name: 'Battle Song' }, assetPath: 'img/Actor1.png' },
    list: [{ code: 355, parameters: ['console.log("Hello world");'] }],
  }
  const texts = extractDataFields(data)
  for (const text of ['Slime', 'A traveller from the north.', 'Restores 100 HP.', 'A legendary sword.', 'Wielded by heroes', 'Attack', 'Defend']) expect(texts).toContain(text)
  for (const text of ['Actor1', 'Dragon', 'Battle Song', 'a.hp += 10;', 'Breath Motion: 1', '<TOES変数対象:1004>', 'console.log("Hello world");']) expect(texts).not.toContain(text)
  expect(extractNoteText('<text>Visible help.</text>\n<Switch: 10>')).toEqual(['Visible help.'])
  expect(extractNoteText('<lore>A sword passed down through generations.</lore>\n<Custom Effect>hidden.call();</Custom Effect>')).toEqual([
    'A sword passed down through generations.',
  ])
  expect(extractPluginText({ label: 'Potion', image: 'Dragon', fileName: 'Actor1', mode: 'add', text: 'Take it now.' })).toEqual(['Potion', 'Take it now.'])
  expect(extractDataFields({ unknown: 'Continue', nested: ['Back', 'iPhone', 'A'], mode: 'add', assetPath: 'img/Actor1', token: 'abc_abc' })).toEqual([
    'Continue',
    'Back',
    'iPhone',
    'A',
  ])
  expect(extractPluginText({ unknown: 'Continue', nested: JSON.stringify(['Back', 'iPhone', 'A']) })).toEqual(['Continue', 'Back', 'iPhone', 'A'])
  expect(extractDataFields({ type: 'Warrior', key: 'Continue', callback: 'doSomething()', name: 'Potion' })).toEqual(['Warrior', 'Continue', 'Potion'])
  expect(extractTextResource('items.csv', 'id,name,description,battlerName\n1,Potion,Restores health.,Slime')).toEqual(['Potion', 'Restores health.'])
})

it.each([
  { language: 'ja', title: '冒険の物語', name: 'ポーション', note: '勇者が使う薬です。', line: '地下室へ行きましょう。', extra: '未知の文章です', other: 'English only text.' },
  {
    language: 'en',
    title: 'A New Adventure',
    name: 'Potion',
    note: 'A medicine used by heroes.',
    line: 'Would you like to enter the basement?',
    extra: 'Another visible sentence.',
    other: 'これは日本語です。',
  },
  { language: 'zh', title: '勇者的冒险故事', name: '恢复药水', note: '勇者使用的治疗药物。', line: '是否进入地下室？', extra: '另一个可见的句子', other: 'English only text.' },
])('uses $language text consistently in offline and in-game extraction', async ({ language, title, name, note, line, extra, other }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-source-language-'))
  try {
    fs.mkdirSync(path.join(root, 'data'))
    for (const [file] of DB_SPECS) fs.writeFileSync(path.join(root, 'data', file), '[]')
    for (const file of ['CommonEvents.json', 'Troops.json']) fs.writeFileSync(path.join(root, 'data', file), '[]')
    const write = (file: string, data: unknown) => fs.writeFileSync(path.join(root, 'data', file), JSON.stringify(data))
    write('System.json', { locale: 'ja_JP', gameTitle: title, terms: {} })
    write('Items.json', [null, { id: 1, name, note: `${note}\n<Switch: 2>\nBreath Motion: 1`, battlerName: 'Slime', characterName: 'abc_abc' }])
    write('Map040.json', { events: [null, { id: 2, name, pages: [{ list: [{ code: 401, parameters: [line] }] }] }] })
    write('MapInfos.json', [null, { name: title }])
    write('Animations.json', [null, { name, animation1Name: 'Slime' }])
    const candidate = language === 'en' ? 'Continue' : language === 'ja' ? '戻ります' : '继续'
    write('extra.json', { unknown: candidate, nested: { description: extra }, name: 'abc_abc', text: other })
    const offline = runExtract(root)
    expect(JSON.parse(fs.readFileSync(offline.OUT, 'utf8')).meta.sourceLanguage).toBe(language)
    for (const text of [name, note.replace(/[。.]$/, ''), extra.replace(/[。.]$/, '')]) expect(offline.allStrings).toContain(text)
    expect(offline.allStrings).toContain(candidate)
    expect([...offline.allStrings].indexOf(candidate)).toBeGreaterThan([...offline.allStrings].indexOf(note.replace(/[。.]$/, '')))
    for (const text of ['Slime', 'abc_abc', 'Breath Motion: 1', 'Switch', other]) expect(offline.allStrings).not.toContain(text)
    const store = { load: jest.fn(async () => {}), seed: () => ({}), lookup: () => null, writeJson: jest.fn(async () => {}) }
    const exported = await extractPluginSeed(root, { fs, path }, store as never, undefined, { entries: true })
    expect(Object.keys(exported.entries || {}).sort()).toEqual([...offline.originalStrings].sort())
    const pluginKeys = Object.keys(exported.entries || {})
    expect(pluginKeys.indexOf(candidate)).toBeGreaterThan(pluginKeys.indexOf(note))
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

it('detects English candidates even when the game has no known text fields', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-unknown-source-'))
  try {
    fs.mkdirSync(path.join(root, 'data'))
    for (const [file] of DB_SPECS) fs.writeFileSync(path.join(root, 'data', file), '[]')
    for (const file of ['CommonEvents.json', 'Troops.json']) fs.writeFileSync(path.join(root, 'data', file), '[]')
    fs.writeFileSync(path.join(root, 'data', 'System.json'), JSON.stringify({ locale: 'ja_JP', terms: {} }))
    fs.writeFileSync(path.join(root, 'data', 'extra.json'), JSON.stringify({ unknown: 'Continue', more: ['Back', 'A'] }))
    const offline = runExtract(root)
    expect([...offline.allStrings]).toEqual(['Continue', 'Back', 'A'])
    const store = { load: jest.fn(async () => {}), seed: () => ({}), lookup: () => null, writeJson: jest.fn(async () => {}) }
    const plugin = await extractPluginSeed(root, { fs, path }, store as never, undefined, { entries: true })
    expect(plugin.entries).toEqual({ Continue: '', Back: '', A: '' })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
