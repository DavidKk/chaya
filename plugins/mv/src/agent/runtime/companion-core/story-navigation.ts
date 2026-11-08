import { planMapRoute } from '../../game-control'

export class StuckDetector {
  private lastPosition: { mapId: number; x: number; y: number } | null = null
  private lastChangeTime = Date.now()

  constructor(private readonly thresholdMs = 25_000) {}

  public update(mapId: number, x: number, y: number): boolean {
    const now = Date.now()
    if (!this.lastPosition || this.lastPosition.mapId !== mapId || this.lastPosition.x !== x || this.lastPosition.y !== y) {
      this.lastPosition = { mapId, x, y }
      this.lastChangeTime = now
      return false
    }
    return now - this.lastChangeTime > this.thresholdMs
  }

  public reset(): void {
    this.lastPosition = null
    this.lastChangeTime = Date.now()
  }
}

export function storyApproachEvent(eventId: number, eligible: (eventId: number) => boolean): number | null {
  const map = (globalThis as any).$gameMap
  const visited = new Set<number>()
  const resolve = (targetId: number): number | null => {
    if (visited.has(targetId) || visited.size >= 32) return null
    visited.add(targetId)
    const event = map?.event?.(targetId)
    if (!event || event._erased || event._pageIndex < 0) return null
    const target = { x: Number(event._x), y: Number(event._y) }
    const positions =
      event.isNormalPriority?.() === false
        ? undefined
        : [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ].map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))
    const route = planMapRoute(target, targetId, positions)
    if (route?.status === 'terrain_blocked' || route?.status === 'outside_visible_area') return null
    if (route?.status === 'event_boundary') {
      const first = route.eventBoundaryIds.find((boundaryId) => boundaryId !== targetId)
      return first === undefined ? null : resolve(first)
    }
    return eligible(targetId) ? targetId : null
  }
  return resolve(eventId)
}
