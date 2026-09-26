import { cycleThreeStateSort } from '@/lib/ui/three-state-sort'

describe('cycleThreeStateSort', () => {
  const defaults = { key: 'updated' as const, order: 'desc' as const }

  it('activates asc on first click', () => {
    expect(cycleThreeStateSort('hits', { key: 'updated', order: 'desc', explicit: false }, defaults)).toEqual({
      key: 'hits',
      order: 'asc',
      explicit: true,
    })
  })

  it('flips asc to desc then restores default', () => {
    const asc = cycleThreeStateSort('hits', { key: 'hits', order: 'asc', explicit: true }, defaults)
    expect(asc).toEqual({ key: 'hits', order: 'desc', explicit: true })
    expect(cycleThreeStateSort('hits', asc, defaults)).toEqual({ key: 'updated', order: 'desc', explicit: false })
  })
})
