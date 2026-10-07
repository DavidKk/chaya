import { collectTroopEncounters, encounterShares, groupTroopMembers, matchesTroop, normalizeEncounters, normalizeTroops } from '@/lib/game/events'

const enemies = [null, { name: 'スライム' }, { name: 'コウモリ' }]
const names = { troops: ['', '史莱姆×2'], enemies: ['', '史莱姆', ''] }

describe('normalizeTroops', () => {
  it('keeps members with existing enemies, translated names and hidden flags', () => {
    const troops = normalizeTroops(
      [
        null,
        { name: 'スライム*2', members: [{ enemyId: 1 }, { enemyId: 1, hidden: true }, { enemyId: 7 }, { enemyId: 0 }], pages: [{ list: [{ code: 101 }, { code: 0 }] }] },
        { name: '', members: [{ enemyId: 2 }], pages: [] },
      ],
      enemies,
      names
    )
    expect(troops).toHaveLength(2)
    expect(troops[0]).toMatchObject({ id: 1, name: '史莱姆×2', rawName: 'スライム*2', commandCount: 1 })
    expect(troops[0].members).toEqual([
      { enemyId: 1, name: '史莱姆', rawName: 'スライム', hidden: false },
      { enemyId: 1, name: '史莱姆', rawName: 'スライム', hidden: true },
    ])
    expect(troops[1].members).toEqual([{ enemyId: 2, name: 'コウモリ', rawName: 'コウモリ', hidden: false }])
  })

  it('keeps every positive member when enemies are unknown', () => {
    const [troop] = normalizeTroops([null, { members: [{ enemyId: 3 }] }], null, { troops: [], enemies: [] })
    expect(troop.members).toEqual([{ enemyId: 3, name: '', rawName: '', hidden: false }])
  })
})

describe('troop helpers', () => {
  const [troop] = normalizeTroops([null, { name: 'スライム*2', members: [{ enemyId: 1 }, { enemyId: 1 }, { enemyId: 2, hidden: true }] }], enemies, names)

  it('groups members by name', () => {
    expect(groupTroopMembers(troop.members)).toEqual([
      { enemyId: 1, name: '史莱姆', count: 2, hidden: false },
      { enemyId: 2, name: 'コウモリ', count: 1, hidden: true },
    ])
  })

  it('matches id, troop names and member names', () => {
    expect(matchesTroop(troop, '1')).toBe(true)
    expect(matchesTroop(troop, 'スライム*')).toBe(true)
    expect(matchesTroop(troop, '史莱姆')).toBe(true)
    expect(matchesTroop(troop, 'コウモ')).toBe(true)
    expect(matchesTroop(troop, 'dragon')).toBe(false)
    expect(matchesTroop(troop, ' ')).toBe(true)
  })
})

describe('encounters', () => {
  const map = {
    encounterStep: 25,
    encounterList: [
      { troopId: 1, weight: 30, regionSet: [] },
      { troopId: 2, weight: 10, regionSet: [3, 1, 3] },
      { troopId: 3, weight: 10, regionSet: [] },
      { troopId: 0, weight: 5, regionSet: [] },
    ],
  }

  it('normalizes the list, drops entries without a troop and sorts regions', () => {
    expect(normalizeEncounters(map)).toEqual({
      encounterStep: 25,
      encounters: [
        { troopId: 1, weight: 30, regionSet: [] },
        { troopId: 2, weight: 10, regionSet: [1, 3] },
        { troopId: 3, weight: 10, regionSet: [] },
      ],
    })
    expect(normalizeEncounters(null)).toEqual({ encounters: [], encounterStep: 0 })
  })

  it('shares count only entries without regions', () => {
    const { encounters } = normalizeEncounters(map)
    expect(encounterShares(encounters)).toEqual([0.75, null, 0.25])
    expect(encounterShares([{ troopId: 1, weight: 5, regionSet: [2] }])).toEqual([null])
    expect(encounterShares([{ troopId: 1, weight: 0, regionSet: [] }])).toEqual([null])
  })

  it('collects troop → maps', () => {
    expect(collectTroopEncounters([{ id: 4, data: map }])[2]).toEqual([{ mapId: 4, weight: 10, regionSet: [1, 3] }])
    expect(collectTroopEncounters(null)).toEqual({})
  })
})
