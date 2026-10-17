import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

  it('uses the same dialogue segments in offline and in-game exports', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-offline-text-'))
    try {
      fs.mkdirSync(path.join(root, 'data'))
      fs.mkdirSync(path.join(root, 'js'))
      for (const [file] of DB_SPECS) fs.writeFileSync(path.join(root, 'data', file), '[]')
      for (const file of ['CommonEvents.json', 'Troops.json']) fs.writeFileSync(path.join(root, 'data', file), '[]')
      fs.writeFileSync(path.join(root, 'data', 'System.json'), JSON.stringify({ terms: {} }))
      const template = String.raw`_actorは「\I[_icon]_name」 を\C[14]_num個\C[24]手に入れた！\n\C[6]_desc1`
      fs.writeFileSync(
        path.join(root, 'js', 'plugins.js'),
        `var $plugins = ${JSON.stringify([
          { name: 'BattleHud', status: true, parameters: { title: '敵の攻撃' } },
          { name: 'GetInformation', status: true, parameters: { 'Get Item Text Num': template, 'Battle Show List': 'item,gold,exp' } },
        ])};`
      )
      fs.writeFileSync(
        path.join(root, 'data', 'CommonEvents.json'),
        JSON.stringify([
          {
            id: 1,
            list: [
              { code: 101, parameters: [] },
              { code: 401, parameters: ['「こんにちは、'] },
              { code: 401, parameters: ['村へ行こう。」'] },
              { code: 0, parameters: [] },
            ],
          },
        ])
      )
      fs.writeFileSync(path.join(root, 'story.txt'), 'これは追加の文章です')
      fs.writeFileSync(path.join(root, 'choices.csv'), 'id,text\n1,冒険を始める')
      fs.writeFileSync(path.join(root, 'data', 'extra.json'), JSON.stringify({ label: '村へ戻ります' }))
      fs.writeFileSync(
        path.join(root, 'data', 'Map040.json'),
        JSON.stringify({
          name: '地下の地図',
          displayName: '調教部屋',
          events: [null, { id: 1, name: '地下室へ', pages: [] }, { id: 2, name: '地下室へ', pages: [{ list: [] }] }, { id: 3, name: 'EV003', pages: [] }],
        })
      )
      const result = runExtract(root)
      expect(result.allStrings).toContain('敵の攻撃')
      expect(result.allStrings).toContain(template)
      expect(result.allStrings).not.toContain('_actorは')
      expect(result.allStrings).not.toContain('item,gold,exp')
      for (const text of ['地下の地図', '調教部屋', '地下室へ']) expect(result.allStrings).toContain(text)
      expect([...result.allStrings].filter((text) => text === '地下室へ')).toHaveLength(1)
      expect(result.allStrings).not.toContain('EV003')
      for (const text of ['これは追加の文章です', '冒険を始める', '村へ戻ります']) expect(result.allStrings).toContain(text)
      expect(result.allStrings).toContain('こんにちは、\n村へ行こう')
      const store = { load: jest.fn(async () => {}), seed: () => ({ '「こんにちは、': '', 古い原文: '旧译文' }), lookup: () => null, writeJson: jest.fn(async () => {}) }
      const exported = await extractPluginSeed(root, { fs, path }, store as never, undefined, { entries: true })
      expect(exported.entries).toEqual(Object.fromEntries([...result.originalStrings].map((src) => [src, ''])))
      expect(exported.entries).toHaveProperty('「こんにちは、\n村へ行こう。」', '')
      expect(exported.entries).not.toHaveProperty('「こんにちは、')
      expect(exported.entries).toHaveProperty('地下室へ', '')
      expect(store.writeJson).toHaveBeenCalledWith('seed', expect.objectContaining({ 古い原文: '旧译文' }))
      expect(JSON.parse(fs.readFileSync(result.OUT, 'utf8')).db.plugins).toEqual(['敵の攻撃', template])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
