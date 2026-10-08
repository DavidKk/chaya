import {
  type GameSaveEntry,
  type GameSavesIndex,
  newAutoEntryId,
  parseGameSavesIndex,
  parseGameSavesSettings,
  planRotation,
  quickSlots,
  validateGameSavesSettings,
} from '@/lib/game/game-saves'

function auto(id: string, savedAt: number): GameSaveEntry {
  return { id, list: 'auto', tag: 'auto', unsafe: false, savedAt, playtimeFrames: 0, mapId: 1, mapName: '', partyNames: [], versionId: 1, engine: 'mv', bytes: 10, hasThumb: false }
}

function index(entries: GameSaveEntry[]): GameSavesIndex {
  return { version: 1, revision: 1, entries }
}

describe('settings', () => {
  it('fills defaults and clamps stored values', () => {
    expect(parseGameSavesSettings(null)).toEqual(expect.objectContaining({ enabled: false, intervalMin: 5, maxCount: 30, quickEnabled: false }))
    expect(parseGameSavesSettings({ intervalMin: 0, maxCount: 999 })).toEqual(expect.objectContaining({ intervalMin: 1, maxCount: 120 }))
  })

  it('rejects out-of-range values instead of fixing them silently', () => {
    const ok = parseGameSavesSettings(null)
    expect(validateGameSavesSettings(ok)).toBeNull()
    expect(validateGameSavesSettings({ ...ok, maxCount: 14 })).toEqual({ key: 'saves.error.maxCountRange', params: { min: 15, max: 120 } })
    expect(validateGameSavesSettings({ ...ok, intervalMin: 61 })).toEqual({ key: 'saves.error.intervalRange', params: { min: 1, max: 60 } })
  })
})

describe('index', () => {
  it('drops malformed or unsafe entry ids', () => {
    const parsed = parseGameSavesIndex({
      revision: 3,
      entries: [auto('auto-abc123', 1), { ...auto('../evil', 2) }, { ...auto('quick-3', 3), list: 'quick', slot: 4 }, { ...auto('quick-3', 3), list: 'quick', slot: 3 }],
    })
    expect(parsed.entries.map((e) => e.id)).toEqual(['auto-abc123', 'quick-3'])
  })

  it('keeps valid pending removals that are not live entries', () => {
    const parsed = parseGameSavesIndex({ revision: 1, entries: [auto('auto-abc123', 1)], removing: ['quick-1', 'quick-1', 'auto-abc123', '../evil', 3] })
    expect(parsed.removing).toEqual(['quick-1'])
    expect(parseGameSavesIndex({ revision: 1, entries: [], removing: [] })).not.toHaveProperty('removing')
  })

  it('always lays out ten quick slots', () => {
    const slots = quickSlots(index([{ ...auto('quick-2', 1), list: 'quick', slot: 2, tag: 'quick' }]))
    expect(slots).toHaveLength(10)
    expect(slots[2]?.id).toBe('quick-2')
    expect(slots.filter(Boolean)).toHaveLength(1)
  })

  it('generates file-safe auto ids', () => {
    expect(newAutoEntryId(1_700_000_000_000, () => 0.5)).toMatch(/^auto-[0-9a-z]+$/)
  })
})

describe('rotation', () => {
  const entries = [auto('auto-aaaaaa', 1), auto('auto-bbbbbb', 2), auto('auto-cccccc', 3), auto('auto-dddddd', 4)]

  it('removes the oldest entries beyond the limit', () => {
    expect(planRotation(index(entries), 2)).toEqual(['auto-aaaaaa', 'auto-bbbbbb'])
  })

  it('never removes a protected entry, taking the next oldest instead', () => {
    expect(planRotation(index(entries), 3, new Set(['auto-aaaaaa']))).toEqual(['auto-bbbbbb'])
  })

  it('ignores quick saves', () => {
    expect(planRotation(index([...entries, { ...auto('quick-0', 0), list: 'quick', slot: 0 }]), 4)).toEqual([])
  })
})
