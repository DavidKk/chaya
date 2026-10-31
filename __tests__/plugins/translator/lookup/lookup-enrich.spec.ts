/**
 * @jest-environment node
 */
import { collectGameNameSources, createLookupEnrichment } from '@/plugins/mv/src/translator/lookup/lookup-enrich'

function installDb(partial: Record<string, unknown>) {
  const g = globalThis as Record<string, unknown>
  const keys = ['$dataActors', '$dataEnemies', '$dataSkills', '$dataItems', '$dataWeapons', '$dataArmors', '$dataStates', '$dataMapInfos']
  const prev: Record<string, unknown> = {}
  for (const key of keys) {
    prev[key] = g[key]
    delete g[key]
  }
  Object.assign(g, partial)
  return () => {
    for (const key of keys) {
      if (prev[key] === undefined) delete g[key]
      else g[key] = prev[key]
    }
  }
}

describe('createLookupEnrichment', () => {
  it('collects map and actor names without collecting actor descriptions', () => {
    const restore = installDb({ $dataActors: [null, { name: 'Rei', description: "Rei's mother." }], $dataMapInfos: [null, { name: 'Floating City' }] })
    try {
      expect(collectGameNameSources()).toEqual(['Rei', 'Floating City'])
    } finally {
      restore()
    }
  })
  it('with no DB, resolve only uses exact lookup', () => {
    const restore = installDb({})
    const enrich = createLookupEnrichment()
    enrich.reindexAll({ こんにちは: 'Hello' })
    expect(enrich.entryCount).toBe(0)
    expect(enrich.resolve({ こんにちは: 'Hello' }, 'こんにちは')).toBe('Hello')
    expect(enrich.resolve({ こんにちは: 'Hello' }, '未知')).toBeNull()
    restore()
  })

  it('indexes English names and skips too-short non-actor names, # prefixes, and duplicates', () => {
    const restore = installDb({
      $dataActors: [null, { name: 'Alice' }, { name: 'ア' }, { name: 'アリス' }, { name: '#注釈' }, { nickname: 'アリス' }],
      $dataItems: [null, { name: '薬' }, { name: '回復薬' }],
      $dataEnemies: [null, { name: 'スライム' }],
    })
    const enrich = createLookupEnrichment()
    enrich.rebuildGlossary()
    expect(enrich.entryCount).toBeGreaterThanOrEqual(3)
    const lookup = { Alice: '爱丽丝', アリス: 'Alice', 回復薬: 'Healing Potion', スライム: 'Slime' }
    enrich.reindexAll(lookup)
    expect(enrich.resolve(lookup, 'Alice')).toBe('爱丽丝')
    expect(enrich.resolve(lookup, 'アリス')).toBe('Alice')
    expect(enrich.resolve(lookup, '回復薬')).toBe('Healing Potion')
    restore()
  })

  it('trailing-number families: known 2 can infer 5', () => {
    const restore = installDb({})
    const enrich = createLookupEnrichment()
    const lookup: Record<string, string> = { 自警団の団員2: 'Militia Member 2' }
    enrich.notePair('自警団の団員2', 'Militia Member 2', lookup)
    expect(enrich.stemCount).toBeGreaterThan(0)
    expect(enrich.resolve(lookup, '自警団の団員5')).toBe('Militia Member 5')
    restore()
  })

  it('proper-name templates: same sentence pattern can swap people', () => {
    const restore = installDb({
      $dataActors: [null, { name: 'アリス' }, { name: 'ボブ' }, { name: 'キャロル' }],
    })
    const enrich = createLookupEnrichment()
    const lookup: Record<string, string> = {
      アリス: 'Alice',
      ボブ: 'Bob',
      キャロル: 'Carol',
      アリスはボブを殴った: 'Alice hit Bob',
    }
    enrich.reindexAll(lookup)
    expect(enrich.templateCount).toBeGreaterThan(0)
    expect(enrich.resolve(lookup, 'キャロルはボブを殴った')).toBe('Carol hit Bob')
    restore()
  })

  it('refreshes cached glossary translations after a pair update or full reload', () => {
    const restore = installDb({ $dataActors: [null, { name: 'アリス' }, { name: 'ボブ' }] })
    try {
      const enrich = createLookupEnrichment()
      const lookup: Record<string, string> = { アリス: 'Alice', ボブ: 'Bob', アリスは笑った: 'Alice smiled' }
      enrich.reindexAll(lookup)
      expect(enrich.resolve(lookup, 'ボブは笑った')).toBe('Bob smiled')
      lookup.ボブ = 'Bobby'
      enrich.notePair('ボブ', 'Bobby', lookup)
      expect(enrich.resolve(lookup, 'ボブは笑った')).toBe('Bobby smiled')
      lookup.ボブ = 'Robert'
      enrich.reindexAll(lookup)
      expect(enrich.resolve(lookup, 'ボブは笑った')).toBe('Robert smiled')
    } finally {
      restore()
    }
  })

  it('matches text after runtime actor, party, variable and currency controls are expanded', () => {
    const game = globalThis as Record<string, unknown>
    const keys = ['$gameActors', '$gameParty', '$gameVariables', '$dataSystem', 'TextManager']
    const previous = Object.fromEntries(keys.map((key) => [key, game[key]]))
    const actor = (name: string) => ({ name: () => name })
    Object.assign(game, {
      $gameActors: { actor: (id: number) => (id === 8 ? actor('Monquis') : null) },
      $gameParty: { members: () => [actor('Rei'), actor('Monquis')] },
      $gameVariables: { value: (id: number) => (id === 3 ? 42 : 0) },
      $dataSystem: { currencyUnit: 'G' },
    })
    try {
      const enrich = createLookupEnrichment()
      const lookup = {
        Monquis: '蒙基斯',
        '\\N[8] is waiting.': '\\N[8]在等你。',
        '\\P[2] joins.': '\\P[2]加入。',
        'Value: \\V[3]': '数值：\\V[3]',
        'Price: \\G': '价格：\\G',
        'Ambiguous \\N[8]': '别名甲',
        'Ambiguous \\P[2]': '别名乙',
      }
      enrich.reindexAll(lookup)
      expect(enrich.resolve(lookup, '\\N[8] is waiting.')).toBe('\\N[8]在等你。')
      expect(enrich.resolve(lookup, 'Monquis is waiting.')).toBe('蒙基斯在等你。')
      expect(enrich.resolve(lookup, 'Monquis joins.')).toBe('蒙基斯加入。')
      expect(enrich.resolve(lookup, 'Value: 42')).toBe('数值：42')
      expect(enrich.resolve(lookup, 'Price: G')).toBe('价格：G')
      expect(enrich.resolve(lookup, 'Ambiguous Monquis')).toBeNull()
      game.$gameActors = { actor: () => actor('New Name') }
      expect(enrich.resolve(lookup, 'New Name is waiting.')).toBe('New Name在等你。')
      expect(enrich.resolve(lookup, 'Monquis is waiting.')).toBeNull()
      expect(enrich.runtimeAliasCount).toBeGreaterThan(0)
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete game[key]
        else game[key] = previous[key]
      }
    }
  })

  it('reindexAll skips empty keys; notePair without glossary only records stems', () => {
    const restore = installDb({})
    const enrich = createLookupEnrichment()
    enrich.reindexAll({ '': 'x', a: 'b' } as Record<string, string>)
    enrich.notePair('item1', 'Item 1', { item1: 'Item 1' })
    expect(enrich.resolve({ item1: 'Item 1', a: 'b' }, 'a')).toBe('b')
    restore()
  })
})
