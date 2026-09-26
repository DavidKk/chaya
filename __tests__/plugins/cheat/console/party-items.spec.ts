/**
 * @jest-environment jsdom
 */
import { equippedCount, findInDb, needParty, partyCount, setItemLike } from '@/plugins/src/cheat/console/party-items'

type Item = { id: number; name: string; description?: string }

function mockParty(opts: { inv: Map<Item, number>; equips: Item[][] }) {
  ;(globalThis as { $gameParty?: unknown }).$gameParty = {
    numItems: (item: Item) => opts.inv.get(item) ?? 0,
    gainItem: (item: Item, delta: number, _includeEquip?: boolean) => {
      const cur = opts.inv.get(item) ?? 0
      opts.inv.set(item, Math.max(0, cur + delta))
    },
    members: () =>
      opts.equips.map((eq) => ({
        equips: () => eq,
      })),
  }
}

describe('party-items', () => {
  afterEach(() => {
    delete (globalThis as { $gameParty?: unknown }).$gameParty
    delete (window as Window & { ChayaTrans?: unknown }).ChayaTrans
  })

  it('needParty: false without a party', () => {
    expect(needParty()).toBe(false)
    mockParty({ inv: new Map(), equips: [] })
    expect(needParty()).toBe(true)
  })

  it('findInDb: empty db/query, limit, and translated-name hits', () => {
    expect(findInDb(undefined, 'x')).toEqual([])
    expect(findInDb([null], '')).toEqual([])
    window.ChayaTrans = { translate: (s: string) => (s === '回復薬' ? 'Healing Potion' : s) }
    const db: Array<Item | null> = [null, { id: 1, name: '回復薬' }, { id: 2, name: '剣' }, { id: 3, name: '盾' }]
    expect(findInDb(db, 'Healing', 10)).toEqual([{ id: 1, name: '回復薬', zh: 'Healing Potion' }])
    expect(findInDb(db, '2')).toEqual([{ id: 2, name: '剣' }])
    expect(findInDb(db, 'a', 1).length).toBeLessThanOrEqual(1)
  })

  it('equippedCount / partyCount include equipment', () => {
    const potion = { id: 1, name: '薬' }
    mockParty({
      inv: new Map([[potion, 2]]),
      equips: [[potion], [potion, { id: 9, name: 'other' }]],
    })
    expect(equippedCount(potion)).toBe(2)
    expect(partyCount(potion)).toBe(4)
    expect(equippedCount(null)).toBe(0)
  })

  it('setItemLike: no party / invalid id / target includes equipment', () => {
    const potion = { id: 1, name: '薬' }
    const db: Array<Item | null> = [null, potion]
    expect(setItemLike(db, 1, 5)).toBeNull()

    mockParty({
      inv: new Map([[potion, 3]]),
      equips: [[potion]],
    })
    expect(setItemLike(db, 99, 1)).toBeNull()

    // Target total 5 with 1 equipped → inventory target 4
    const r = setItemLike(db, 1, 5)
    expect(r).toMatchObject({ id: 1, count: 5, eq: 1, inv: 4 })

    // Target 0: inventory goes to 0; equipped stays (delta<0 with includeEquip only when unequipping)
    const r0 = setItemLike(db, 1, 0)
    expect(r0?.inv).toBe(0)
    expect(r0?.eq).toBe(1)
  })

  it('setItemLike: NaN/negative treat as 0', () => {
    const potion = { id: 1, name: '薬' }
    mockParty({ inv: new Map([[potion, 2]]), equips: [[]] })
    const r = setItemLike([null, potion], 1, -3)
    expect(r?.inv).toBe(0)
  })
})
