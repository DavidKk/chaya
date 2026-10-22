export type Point = { x: number; y: number }
export type VisibleBounds = { minX: number; minY: number; maxX: number; maxY: number }
export type RouteEvent = { id: number; x: number; y: number; target?: boolean }
export type RouteStatus = 'reachable' | 'already_there' | 'terrain_blocked' | 'event_boundary' | 'outside_visible_area' | 'no_path'

export type RoutePlan = {
  status: RouteStatus
  path: Point[]
  distance: number | null
  target: Point
  interactionPosition?: Point
  eventBoundaryIds: number[]
  exploredNodes: number
  visibleBounds: VisibleBounds
}

const DIRECTIONS = [
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
]

function key(point: Point) {
  return `${point.x},${point.y}`
}

function inside(point: Point, bounds: VisibleBounds) {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY
}

function search(input: { start: Point; target: Point; bounds: VisibleBounds; passable: (from: Point, to: Point) => boolean; blocked: Set<string> }) {
  const queue: Point[] = [input.start]
  const parents = new Map<string, string | null>([[key(input.start), null]])
  let exploredNodes = 0
  while (queue.length) {
    const current = queue.shift()!
    exploredNodes++
    if (key(current) === key(input.target)) {
      const path: Point[] = []
      let cursor: string | null = key(current)
      while (cursor) {
        const [x, y] = cursor.split(',').map(Number)
        path.unshift({ x, y })
        cursor = parents.get(cursor) ?? null
      }
      return { path, exploredNodes }
    }
    for (const direction of DIRECTIONS) {
      const next = { x: current.x + direction.dx, y: current.y + direction.dy }
      const nextKey = key(next)
      if (!inside(next, input.bounds) || parents.has(nextKey) || input.blocked.has(nextKey) || !input.passable(current, next)) continue
      parents.set(nextKey, key(current))
      queue.push(next)
    }
  }
  return { path: [], exploredNodes }
}

export function planRoute(input: {
  start: Point
  target: Point
  bounds: VisibleBounds
  passable: (from: Point, to: Point) => boolean
  events?: RouteEvent[]
  targetEventId?: number
  interactionPositions?: Point[]
}): RoutePlan {
  const events = input.events ?? []
  if (!inside(input.start, input.bounds) || !inside(input.target, input.bounds)) {
    return { status: 'outside_visible_area', path: [], distance: null, target: input.target, eventBoundaryIds: [], exploredNodes: 0, visibleBounds: input.bounds }
  }
  const blockedEvents = events.filter((event) => !event.target && event.id !== input.targetEventId)
  const blocked = new Set(blockedEvents.map((event) => key(event)))
  const targets = input.interactionPositions?.length ? input.interactionPositions : [input.target]
  let best: { path: Point[]; target: Point; exploredNodes: number } | null = null
  let exploredNodes = 0
  for (const target of targets) {
    if (!inside(target, input.bounds)) continue
    const result = search({ ...input, target, blocked })
    exploredNodes += result.exploredNodes
    if (result.path.length && (!best || result.path.length < best.path.length)) best = { path: result.path, target, exploredNodes: result.exploredNodes }
  }
  if (best) {
    return {
      status: best.path.length === 1 ? 'already_there' : 'reachable',
      path: best.path,
      distance: best.path.length - 1,
      target: input.target,
      interactionPosition: best.target,
      eventBoundaryIds: [],
      exploredNodes,
      visibleBounds: input.bounds,
    }
  }
  let terrain: { path: Point[]; target?: Point; exploredNodes: number } = { path: [], exploredNodes: 0 }
  for (const target of targets) {
    if (!inside(target, input.bounds)) continue
    const candidate = search({ ...input, target, blocked: new Set() })
    if (!terrain.path.length || (candidate.path.length && candidate.path.length < terrain.path.length)) terrain = { ...candidate, target }
  }
  const eventBoundaryIds = terrain.path.length ? blockedEvents.filter((event) => terrain.path.some((point) => key(point) === key(event))).map((event) => event.id) : []
  return {
    status: eventBoundaryIds.length ? 'event_boundary' : terrain.path.length ? 'reachable' : 'terrain_blocked',
    path: [],
    distance: eventBoundaryIds.length && terrain.path.length ? terrain.path.length - 1 : null,
    target: input.target,
    ...(eventBoundaryIds.length && terrain.target ? { interactionPosition: terrain.target } : {}),
    eventBoundaryIds,
    exploredNodes: exploredNodes + terrain.exploredNodes,
    visibleBounds: input.bounds,
  }
}
