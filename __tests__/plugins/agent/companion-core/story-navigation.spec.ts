jest.mock('@/plugins/mv/src/agent/game-control', () => ({ planMapRoute: jest.fn() }))

import { planMapRoute } from '@/plugins/mv/src/agent/game-control'
import { storyApproachEvent } from '@/plugins/mv/src/agent/runtime/companion-core/story-navigation'

describe('story approach dependencies', () => {
  const engine = globalThis as any
  let previous: unknown

  beforeEach(() => {
    previous = engine.$gameMap
    engine.$gameMap = { event: (eventId: number) => ({ _x: eventId, _y: 0, _pageIndex: 0 }) }
    jest.mocked(planMapRoute).mockReset()
  })

  afterEach(() => {
    engine.$gameMap = previous
  })

  test('resolves a reachable passage before a failed trap and offering chest', () => {
    jest.mocked(planMapRoute).mockImplementation((_, eventId) => {
      const boundaries = eventId === 19 ? [22, 60] : eventId === 22 ? [60] : []
      return { status: boundaries.length ? 'event_boundary' : 'reachable', eventBoundaryIds: boundaries } as any
    })
    expect(storyApproachEvent(19, (eventId) => eventId === 60)).toBe(60)
  })

  test('does not retry a failed reachable prerequisite', () => {
    jest.mocked(planMapRoute).mockImplementation((_, eventId) => ({ status: eventId === 19 ? 'event_boundary' : 'reachable', eventBoundaryIds: [60] }) as any)
    expect(storyApproachEvent(19, () => false)).toBeNull()
  })

  test('terminates cyclic passage dependencies', () => {
    jest.mocked(planMapRoute).mockImplementation((_, eventId) => ({ status: 'event_boundary', eventBoundaryIds: [eventId === 19 ? 22 : 19] }) as any)
    expect(storyApproachEvent(19, () => true)).toBeNull()
  })
})
