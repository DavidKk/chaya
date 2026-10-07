import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { DB_SPECS } from '@/lib/translate/database-fields'
import { extractPluginSeed } from '@/plugins/src/translator/runtime/extract'
import { extractDialogueFromEvents } from '@/services/extract/lib/dialogue'
import { runExtract } from '@/services/extract/lib/main'
import { extractPluginsJsText, extractPluginText } from '@/services/extract/lib/plugin-text'

describe('plugin text extraction', () => {
  it('reads enabled plugin parameters and nested JSON values without scanning code', () => {
    const raw = `var $plugins = ${JSON.stringify([
      {
        name: 'BattleHud',
        status: true,
        description: '戦闘表示の説明は設定画面だけ',
        parameters: {
          title: '敵の攻撃',
          layout: JSON.stringify([{ label: '防御する', help: '次の攻撃に備える' }]),
          callback: 'function() { return "内部処理"; }',
        },
      },
      { name: 'Unused', status: false, parameters: { title: '無効の文言' } },
    ])};`

    expect(extractPluginsJsText(raw)).toEqual(['敵の攻撃', '防御する', '次の攻撃に備える'])
    expect(extractPluginsJsText('var $plugins = invalid;')).toEqual([])
  })

  it('keeps MZ plugin-command text in event order', () => {
    const events = [
      {
        id: 1,
        pages: [
          {
            list: [
              { code: 401, parameters: ['戦闘が始まる'] },
              { code: 357, parameters: ['BattleHud', 'show', 'Show', { message: '敵が力をためた！', choices: JSON.stringify(['防御', '逃げる']) }] },
            ],
          },
        ],
      },
    ]
    expect(extractDialogueFromEvents(events, { src: 'troop' })).toEqual([
      { src: 'troop', kind: 'd', eid: 1, lines: ['戦闘が始まる'] },
      { src: 'troop', kind: 'p', eid: 1, lines: ['敵が力をためた！', '防御', '逃げる'] },
    ])
  })

  it('extracts ticker text from move routes without treating script code as dialogue', () => {
    const events = [
      {
        id: 4,
        pages: [
          {
            list: [
              {
                code: 205,
                parameters: [
                  0,
                  {
                    list: [
                      { code: 45, parameters: [String.raw`TickerManager.show('\\c[16]ぐぅぅ……！');`] },
                      { code: 45, parameters: ['TickerManager.show($gameVariables.value(999));'] },
                    ],
                  },
                ],
              },
              { code: 505, parameters: [{ code: 45, parameters: [String.raw`TickerManager.show('\\c[16]ぐぅぅ……！');`] }] },
              { code: 355, parameters: [String.raw`TickerManager.show("こんなの好きになってしまうではないか……！");`] },
              { code: 355, parameters: ["console.log('内部処理')"] },
            ],
          },
        ],
      },
    ]
    expect(extractDialogueFromEvents(events, { src: 'Map010.json' })).toEqual([
      { src: 'Map010.json', kind: 'p', eid: 4, lines: [String.raw`\c[16]ぐぅぅ……！`] },
      { src: 'Map010.json', kind: 'p', eid: 4, lines: ['こんなの好きになってしまうではないか……！'] },
    ])
  })

  it('limits pathological nested or long values', () => {
    expect(extractPluginText('敵'.repeat(1_201))).toEqual([])
    expect(extractPluginText(JSON.stringify({ label: '攻撃', nested: JSON.stringify({ label: '攻撃' }) }))).toEqual(['攻撃'])
    expect(extractPluginText(JSON.stringify({ padding: 'x'.repeat(1_300), label: '防御' }))).toEqual(['防御'])
  })

  it('merges plugin parameters into the in-game seed without overwriting translations', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-plugin-text-'))
    try {
      fs.mkdirSync(path.join(root, 'data'))
      fs.mkdirSync(path.join(root, 'js'))
      fs.writeFileSync(
        path.join(root, 'js', 'plugins.js'),
        `var $plugins = ${JSON.stringify([{ name: 'BattleHud', status: true, parameters: { title: '敵の攻撃', help: '防御する' } }])};`
      )
      const writeJson = jest.fn(async () => {})
      const store = { load: jest.fn(async () => {}), seed: () => ({ 敵の攻撃: '敌人攻击' }), writeJson }
      const result = await extractPluginSeed(root, { fs, path }, store as never)
      expect(result).toEqual({ unique: 2, added: 1, total: 2 })
      expect(writeJson).toHaveBeenCalledWith('seed', { 敵の攻撃: '敌人攻击', 防御する: '' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('includes plugin parameters in the offline extract output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-offline-text-'))
    try {
      fs.mkdirSync(path.join(root, 'data'))
      fs.mkdirSync(path.join(root, 'js'))
      fs.mkdirSync(path.dirname(gameContentPath(root, 'extractStrings')), { recursive: true })
      for (const [file] of DB_SPECS) fs.writeFileSync(path.join(root, 'data', file), '[]')
      for (const file of ['CommonEvents.json', 'Troops.json']) fs.writeFileSync(path.join(root, 'data', file), '[]')
      fs.writeFileSync(path.join(root, 'data', 'System.json'), JSON.stringify({ terms: {} }))
      fs.writeFileSync(path.join(root, 'js', 'plugins.js'), `var $plugins = ${JSON.stringify([{ name: 'BattleHud', status: true, parameters: { title: '敵の攻撃' } }])};`)
      const result = runExtract(root)
      expect(result.allStrings).toContain('敵の攻撃')
      expect(JSON.parse(fs.readFileSync(result.OUT, 'utf8')).db.plugins).toEqual(['敵の攻撃'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
