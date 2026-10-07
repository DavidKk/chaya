import { pickEnemySpot, pickEnemySpots } from '@/lib/game/battle'

const bounds = { width: 816, height: 624 }
const size = { width: 100, height: 100 }
const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 108 && Math.abs(a.y - b.y) < 108

describe('pickEnemySpot', () => {
  it('uses the free centre of the existing row', () => {
    expect(pickEnemySpot({ existing: [{ x: 200, y: 400, ...size }], size, bounds })).toEqual({ x: 408, y: 400 })
  })

  it('moves sideways from the centre to avoid overlap', () => {
    const spot = pickEnemySpot({ existing: [{ x: 408, y: 400, ...size }], size, bounds })
    expect(spot.y).toBe(400)
    expect(Math.abs(spot.x - 408)).toBeGreaterThanOrEqual(108)
  })

  it('tries another row when the first one is full', () => {
    const existing = Array.from({ length: 8 }, (_, i) => ({ x: 51 + i * 102, y: 400, width: 102, height: 100 }))
    const spot = pickEnemySpot({ existing, size, bounds })
    expect(spot.y).not.toBe(400)
    expect(existing.some((e) => overlaps(spot, e))).toBe(false)
  })

  it('still returns a spot (farthest from everyone) when nothing fits', () => {
    const huge = { width: 816, height: 624 }
    const spot = pickEnemySpot({ existing: [{ x: 408, y: 624, ...huge }], size, bounds })
    expect(spot.x).toBeGreaterThanOrEqual(50)
    expect(spot.x).toBeLessThanOrEqual(766)
  })

  it('falls back to the given row, then 60% of the height, without enemies', () => {
    expect(pickEnemySpot({ existing: [], size, bounds, fallbackY: 300 })).toEqual({ x: 408, y: 300 })
    expect(pickEnemySpot({ existing: [], size, bounds }).y).toBe(Math.round(624 * 0.6))
  })

  it('stays inside the screen', () => {
    const wide = { width: 300, height: 100 }
    const existing = [{ x: 408, y: 400, ...wide }]
    const spot = pickEnemySpot({ existing, size: wide, bounds })
    expect(spot.x - 150).toBeGreaterThanOrEqual(0)
    expect(spot.x + 150).toBeLessThanOrEqual(816)
  })
})

describe('pickEnemySpots', () => {
  it('keeps new enemies apart from each other', () => {
    const spots = pickEnemySpots({ existing: [{ x: 408, y: 400, ...size }], sizes: [size, size, size], bounds })
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(overlaps(spots[i]!, spots[j]!)).toBe(false)
  })
})
