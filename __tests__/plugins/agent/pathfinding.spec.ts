import { planRoute, type Point } from '@/plugins/src/agent/pathfinding'

const bounds = { minX: 0, minY: 0, maxX: 6, maxY: 6 }
const blocked = (walls: Point[] = []) => {
  const keys = new Set(walls.map(({ x, y }) => `${x},${y}`))
  return (_from: Point, to: Point) => !keys.has(`${to.x},${to.y}`)
}

test('uses a real reachable route instead of Manhattan distance', () => {
  const route = planRoute({
    start: { x: 0, y: 0 },
    target: { x: 2, y: 0 },
    bounds,
    passable: blocked([
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]),
  })
  expect(route.status).toBe('reachable')
  expect(route.distance).toBe(6)
  expect(route.path).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 1 },
    { x: 2, y: 0 },
  ])
})

test('chooses the shortest reachable interaction position', () => {
  const route = planRoute({
    start: { x: 0, y: 2 },
    target: { x: 3, y: 2 },
    bounds,
    passable: blocked([{ x: 2, y: 2 }]),
    interactionPositions: [
      { x: 2, y: 2 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 4, y: 2 },
    ],
  })
  expect(route.interactionPosition).toEqual({ x: 3, y: 1 })
  expect(route.distance).toBe(4)
})

test('treats a non-target event as an event boundary, not terrain', () => {
  const narrow = { minX: 0, minY: 0, maxX: 2, maxY: 0 }
  const route = planRoute({
    start: { x: 0, y: 0 },
    target: { x: 2, y: 0 },
    bounds: narrow,
    passable: blocked(),
    events: [{ id: 9, x: 1, y: 0 }],
  })
  expect(route.status).toBe('event_boundary')
  expect(route.eventBoundaryIds).toEqual([9])
})

test('allows the target touch event as the final tile', () => {
  const route = planRoute({
    start: { x: 0, y: 0 },
    target: { x: 2, y: 0 },
    bounds,
    passable: blocked(),
    targetEventId: 7,
    events: [{ id: 7, x: 2, y: 0 }],
  })
  expect(route.status).toBe('reachable')
  expect(route.path.at(-1)).toEqual({ x: 2, y: 0 })
})

test('never searches beyond the visible bounds', () => {
  const route = planRoute({ start: { x: 0, y: 0 }, target: { x: 7, y: 0 }, bounds, passable: blocked() })
  expect(route.status).toBe('outside_visible_area')
  expect(route.exploredNodes).toBe(0)
})
