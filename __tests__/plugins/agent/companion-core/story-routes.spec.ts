import type { ExplorationTarget } from '@/plugins/mv/src/agent/runtime/companion-core/story-exploration'
import { buildStoryRoutes } from '@/plugins/mv/src/agent/runtime/companion-core/story-routes'

const target = (eventId: number, x = eventId): ExplorationTarget => ({ eventId, x, y: 0, kind: 'chest', name: `Chest ${eventId}`, priority: 80 })

describe('story prerequisite routes', () => {
  test('keeps alternative training paths and appends the previously blocked goal only after the threshold', () => {
    const routes = buildStoryRoutes(
      [
        { target: target(1), requiredLevel: 1, expectedGain: 1 },
        { target: target(2), requiredLevel: 1, expectedGain: 1 },
        { target: target(3), requiredLevel: 2, expectedGain: 1 },
      ],
      [{ target: target(11), requiredLevel: 4 }],
      1,
      { x: 0, y: 0 }
    )
    expect(routes).toHaveLength(2)
    expect(new Set(routes.map((route) => route.steps[0].target.eventId)).size).toBe(2)
    for (const route of routes) {
      expect(route.complete).toBe(true)
      expect(route.steps.at(-1)?.target.eventId).toBe(11)
      expect(route.steps.at(-1)?.expectedLevel).toBe(4)
      expect(new Set(route.steps.map((step) => step.target.eventId)).size).toBe(route.steps.length)
    }
  })

  test('reports an incomplete route instead of looping on insufficient experience', () => {
    const routes = buildStoryRoutes([{ target: target(1), requiredLevel: 1, expectedGain: 1 }], [{ target: target(11), requiredLevel: 11 }], 1, { x: 0, y: 0 })
    expect(routes[0]).toMatchObject({ complete: false, goalEventId: 11 })
    expect(routes[0].steps.map((step) => step.target.eventId)).toEqual([1])
  })

  test('never adds an unavailable first step or a zero-gain training loop', () => {
    expect(
      buildStoryRoutes(
        [
          { target: target(1), requiredLevel: 2, expectedGain: 1 },
          { target: target(2), requiredLevel: 1, expectedGain: 0 },
        ],
        [{ target: target(11), requiredLevel: 11 }],
        1,
        { x: 0, y: 0 }
      )
    ).toEqual([])
  })
})
