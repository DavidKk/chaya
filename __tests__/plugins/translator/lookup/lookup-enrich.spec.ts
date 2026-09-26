/**
 * @jest-environment node
 */
import { createLookupEnrichment } from '@/plugins/src/translator/lookup/lookup-enrich'

function installDb(partial: Record<string, unknown>) {
  const g = globalThis as Record<string, unknown>
  const keys = ['$dataActors', '$dataEnemies', '$dataSkills', '$dataItems', '$dataWeapons', '$dataArmors', '$dataStates']
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
  it('with no DB, resolve only uses exact lookup', () => {
    const restore = installDb({})
    const enrich = createLookupEnrichment()
    enrich.reindexAll({ こんにちは: 'Hello' })
    expect(enrich.entryCount).toBe(0)
    expect(enrich.resolve({ こんにちは: 'Hello' }, 'こんにちは')).toBe('Hello')
    expect(enrich.resolve({ こんにちは: 'Hello' }, '未知')).toBeNull()
    restore()
  })

  it('skips latin-only names, too-short non-actor names, # prefixes, and duplicates', () => {
    const restore = installDb({
      $dataActors: [null, { name: 'Alice' }, { name: 'ア' }, { name: 'アリス' }, { name: '#注釈' }, { nickname: 'アリス' }],
      $dataItems: [null, { name: '薬' }, { name: '回復薬' }],
      $dataEnemies: [null, { name: 'スライム' }],
    })
    const enrich = createLookupEnrichment()
    enrich.rebuildGlossary()
    // Alice has no JP; ア length 1 < minLen 2; 薬 length 1 filtered; アリス deduped via nickname
    expect(enrich.entryCount).toBeGreaterThanOrEqual(2)
    const lookup = { アリス: 'Alice', 回復薬: 'Healing Potion', スライム: 'Slime' }
    enrich.reindexAll(lookup)
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

  it('reindexAll skips empty keys; notePair without glossary only records stems', () => {
    const restore = installDb({})
    const enrich = createLookupEnrichment()
    enrich.reindexAll({ '': 'x', a: 'b' } as Record<string, string>)
    enrich.notePair('item1', 'Item 1', { item1: 'Item 1' })
    expect(enrich.resolve({ item1: 'Item 1', a: 'b' }, 'a')).toBe('b')
    restore()
  })
})
