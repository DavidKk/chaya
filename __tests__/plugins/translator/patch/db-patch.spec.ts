/**
 * @jest-environment node
 */
import { dbTables, patchCommand, patchDatabaseTexts, patchEventList, patchMapTexts, patchRow, patchSystem } from '@/plugins/src/translator/patch/db-patch'

function installGlobals(partial: Record<string, unknown>) {
  const g = globalThis as Record<string, unknown>
  const keys = Object.keys(partial)
  const prev: Record<string, unknown> = {}
  for (const key of keys) {
    prev[key] = g[key]
    g[key] = partial[key]
  }
  return () => {
    for (const key of keys) {
      if (prev[key] === undefined) delete g[key]
      else g[key] = prev[key]
    }
  }
}

const zh = (t: string) => `ZH:${t}`

describe('patchCommand', () => {
  it('skips null cmd / missing parameters safely', () => {
    expect(() => patchCommand(null, zh)).not.toThrow()
    expect(() => patchCommand(undefined, zh)).not.toThrow()
    expect(() => patchCommand({ code: 401 }, zh)).not.toThrow()
  })

  it('translates 401/405 text lines; leaves empty strings alone', () => {
    const a = { code: 401, parameters: ['こんにちは'] }
    const empty = { code: 401, parameters: [''] }
    patchCommand(a, zh)
    patchCommand(empty, zh)
    expect(a.parameters[0]).toBe('ZH:こんにちは')
    expect(empty.parameters[0]).toBe('')
  })

  it('102 choices: keeps null/empty, translates the rest', () => {
    const cmd = { code: 102, parameters: [['はい', '', null, 'いいえ'] as unknown[]] }
    patchCommand(cmd, zh)
    expect(cmd.parameters[0]).toEqual(['ZH:はい', '', null, 'ZH:いいえ'])
  })

  it('keeps dialogue and choices in the source language for runtime subtitle mode', () => {
    const lines = [
      { code: 401, parameters: ['こんにちは'] },
      { code: 102, parameters: [['はい', 'いいえ']] },
      { code: 405, parameters: ['スクロール'] },
    ]
    patchEventList(lines, zh, true)
    expect(lines[0].parameters).toEqual(['こんにちは'])
    expect(lines[1].parameters).toEqual([['はい', 'いいえ']])
    expect(lines[2].parameters).toEqual(['ZH:スクロール'])
  })

  it('320/324/325 rename codes only rewrite parameters[1]', () => {
    const cmd = { code: 320, parameters: [1, 'アリス'] }
    patchCommand(cmd, zh)
    expect(cmd.parameters).toEqual([1, 'ZH:アリス'])
  })

  it('ignores unrelated codes', () => {
    const cmd = { code: 101, parameters: ['face', 0, 0, 2] }
    patchCommand(cmd, zh)
    expect(cmd.parameters).toEqual(['face', 0, 0, 2])
  })
})

describe('patchRow / patchEventList', () => {
  it('skips null rows and empty fields; skips write-back when unchanged', () => {
    expect(() => patchRow(null, zh)).not.toThrow()
    const row: Record<string, unknown> = { name: 'x', description: '', nickname: null }
    const identity = (t: string) => t
    patchRow(row, identity)
    expect(row.name).toBe('x')
    patchRow(row, zh)
    expect(row.name).toBe('ZH:x')
    expect(row.description).toBe('')
    expect(row.nickname).toBeNull()
  })

  it('tolerates non-array lists and null commands', () => {
    expect(() => patchEventList(null, zh)).not.toThrow()
    expect(() => patchEventList('x', zh)).not.toThrow()
    const list = [null, { code: 401, parameters: ['a'] }, { code: 405, parameters: ['b'] }]
    patchEventList(list, zh)
    expect(list[1]?.parameters?.[0]).toBe('ZH:a')
    expect(list[2]?.parameters?.[0]).toBe('ZH:b')
  })
})

describe('patchSystem / patchMap / patchDatabase', () => {
  it('does nothing when $dataSystem is missing', () => {
    const restore = installGlobals({ $dataSystem: undefined })
    expect(() => patchSystem(zh)).not.toThrow()
    restore()
  })

  it('covers terms / messages / type-name arrays', () => {
    const sys = {
      gameTitle: 'Title',
      currencyUnit: 'G',
      terms: {
        basic: ['HP', ''],
        commands: [null, '攻撃'],
        params: ['攻撃力'],
        messages: { obtainExp: '%1 EXP', empty: '' },
      },
      elements: [null, '炎'],
      switches: [null, 'スイッチ'],
      variables: [null, '変数'],
    }
    const restore = installGlobals({ $dataSystem: sys })
    patchSystem(zh)
    expect(sys.gameTitle).toBe('ZH:Title')
    expect(sys.terms.basic[0]).toBe('ZH:HP')
    expect(sys.terms.basic[1]).toBe('')
    expect(sys.terms.commands[1]).toBe('ZH:攻撃')
    expect(sys.terms.messages.obtainExp).toBe('ZH:%1 EXP')
    expect(sys.terms.messages.empty).toBe('')
    expect(sys.elements[1]).toBe('ZH:炎')
    restore()
  })

  it('is quiet with no map; otherwise patches displayName and events', () => {
    const restoreEmpty = installGlobals({ $dataMap: undefined })
    expect(() => patchMapTexts(zh)).not.toThrow()
    restoreEmpty()

    const map = {
      displayName: '町',
      events: [
        null,
        {
          name: '村人',
          pages: [{ list: [{ code: 401, parameters: ['こんにちは'] }] }],
        },
      ],
    }
    const logs: string[] = []
    const restore = installGlobals({ $dataMap: map })
    patchMapTexts(zh, { quiet: true, log: { ok: (m) => logs.push(m) } })
    expect(map.displayName).toBe('ZH:町')
    expect(map.events[1]!.name).toBe('ZH:村人')
    expect(map.events[1]!.pages[0].list[0].parameters[0]).toBe('ZH:こんにちは')
    expect(logs).toEqual([])
    patchMapTexts(zh, { log: { ok: (m) => logs.push(m) } })
    // Must match production Chinese log text
    expect(logs).toContain('地图文本已套用翻译')
    restore()
  })

  it('full DB patch includes common events and troop pages', () => {
    const actors = [null, { name: '英雄', description: 'd' }]
    const common = [null, { name: 'CE', list: [{ code: 401, parameters: ['公共'] }] }]
    const troops = [
      null,
      {
        name: '群れ',
        pages: [{ list: [{ code: 102, parameters: [['逃げる']] }] }],
      },
    ]
    const restore = installGlobals({
      $dataActors: actors,
      $dataClasses: null,
      $dataSkills: null,
      $dataItems: null,
      $dataWeapons: null,
      $dataArmors: null,
      $dataEnemies: null,
      $dataStates: null,
      $dataTroops: troops,
      $dataAnimations: null,
      $dataTilesets: null,
      $dataCommonEvents: common,
      $dataSystem: { gameTitle: 'G', terms: null },
    })
    patchDatabaseTexts(zh, { quiet: true })
    expect(actors[1]!.name).toBe('ZH:英雄')
    expect(common[1]!.name).toBe('ZH:CE')
    expect(common[1]!.list[0].parameters[0]).toBe('ZH:公共')
    expect(troops[1]!.name).toBe('ZH:群れ')
    expect((troops[1]!.pages[0].list[0].parameters[0] as string[])[0]).toBe('ZH:逃げる')
    restore()
  })

  it('dbTables reads from globalThis; missing tables are undefined', () => {
    const restore = installGlobals({
      $dataActors: [null],
      $dataItems: undefined,
    })
    const tables = dbTables()
    expect(tables[0]).toEqual([null])
    expect(tables[3]).toBeUndefined()
    restore()
  })
})
