import { blockedMask, nearestSpot, terrainBlockedMask } from '@/lib/game/events'

describe('nearestSpot', () => {
  it('keeps the target when it is standable', () => {
    expect(nearestSpot(2, 2, 5, 5, () => true)).toEqual({ x: 2, y: 2 })
  })

  it('picks the closest standable tile', () => {
    const blocked = new Set(['2,2', '2,3', '1,2', '3,2', '2,1'])
    expect(nearestSpot(2, 2, 5, 5, (x, y) => !blocked.has(`${x},${y}`))).toEqual({ x: 1, y: 1 })
  })

  it('searches the whole map', () => {
    expect(nearestSpot(0, 0, 4, 4, (x, y) => x === 3 && y === 3)).toEqual({ x: 3, y: 3 })
  })

  it('returns null when nothing is standable', () => {
    expect(nearestSpot(1, 1, 3, 3, () => false)).toBeNull()
  })
})

describe('blockedMask', () => {
  it('is row-major', () => {
    expect(blockedMask(3, 2, (x, y) => x === 2 || y === 1)).toBe('001111')
  })
})

describe('terrainBlockedMask', () => {
  // tile 1 floor (all directions open), 2 wall (all closed), 3 star (no effect), 0 empty star
  const flags = [0x10, 0x00, 0x0f, 0x10]
  /** 3×1 map; layer 0 is floor / wall / floor, layer 2 puts a star tile over x=0 and a wall over x=2 */
  const map = (layer2: number[]) => ({
    width: 3,
    height: 1,
    data: [1, 2, 1, 0, 0, 0, ...layer2, 0, 0, 0],
  })

  it('reads the top non-star layer first', () => {
    expect(terrainBlockedMask(map([3, 0, 2]), flags)).toBe('011')
  })

  it('is passable when any direction is open', () => {
    expect(terrainBlockedMask({ width: 1, height: 1, data: [5, 0, 0, 0] }, [0x10, 0, 0, 0, 0, 0x07])).toBe('0')
  })

  it('returns null without tile data or flags', () => {
    expect(terrainBlockedMask({ width: 3, height: 1, data: [] }, flags)).toBeNull()
    expect(terrainBlockedMask(map([0, 0, 0]), undefined)).toBeNull()
  })
})
