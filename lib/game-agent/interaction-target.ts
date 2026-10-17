type Loose = Record<string, unknown>

type Target = {
  id: number
  kind: string
  routeStatus: string
  routeDistance: number
  eventBoundaryIds: number[]
}

export type InteractionGoal = {
  multi: boolean
  asksPeople: boolean
  asksDoor: boolean
  asksTransit: boolean
  excludedKinds: string[]
}

export type InteractionTargetDecision =
  { accepted: true } | { accepted: false; reason: 'target_missing' | 'target_excluded' | 'target_unreachable'; eventId: number; kind?: string }

function objects(value: unknown): Loose[] {
  return Array.isArray(value) ? value.filter((item): item is Loose => !!item && typeof item === 'object' && !Array.isArray(item)) : []
}

export function isMultiInteractionGoal(goal: string): boolean {
  return /(?:全部|所有|都|每个|逐个|all|every|each)/i.test(goal)
}

function excluded(goal: string, terms: string[]) {
  return terms.some((term) => new RegExp(`(?:除|排除|不要|不含|except|excluding|exclude)[^\\n，。,.]{0,24}${term}`, 'i').test(goal))
}

/** Compile natural-language scope once; execution still enforces it on every fresh state. */
export function compileInteractionGoal(goal: string): InteractionGoal {
  const asksPeople = /(?:人物|角色|npc|person|people|character)/i.test(goal) && !excluded(goal, ['人物', '角色', 'npc', 'person', 'people', 'character'])
  const asksDoor = /(?:门|door|gate)/i.test(goal) && !excluded(goal, ['门', 'door', 'gate'])
  const asksTransit = /(?:入口|出口|传送|离开|进入|entrance|exit|transit)/i.test(goal) && !excluded(goal, ['入口', '出口', '传送', 'entrance', 'exit', 'transit'])
  const excludedKinds = [...(!asksPeople ? ['npc'] : []), ...(!asksDoor ? ['door'] : []), ...(!asksTransit ? ['transit'] : [])]
  return { multi: isMultiInteractionGoal(goal), asksPeople, asksDoor, asksTransit, excludedKinds }
}

export function effectiveInteractionKind(event: Loose, state?: Loose) {
  const declared = String(event.kind ?? 'unknown')
  if (['door', 'exit'].includes(declared)) return declared
  if (event.transit === true) return 'exit'
  if (/door|gate/i.test(String(event.sprite ?? ''))) return 'door'
  if (event.look === 'character') return 'npc'
  if (declared === 'npc' || declared === 'pickup') return declared
  const bounds = state?.map && typeof state.map === 'object' ? ((state.map as Loose).visibleBounds as Loose | undefined) : undefined
  const x = Number(event.x)
  const y = Number(event.y)
  const nearEdge =
    !!bounds && Number.isFinite(x + y) && (x <= Number(bounds.minX) + 1 || x >= Number(bounds.maxX) - 1 || y <= Number(bounds.minY) + 1 || y >= Number(bounds.maxY) - 1)
  const effects = Array.isArray(event.effects) ? event.effects.map(String) : []
  if (
    nearEdge &&
    (event.trigger === 'player_touch' || event.trigger === 'event_touch') &&
    (event.look === 'tile' || event.look === 'none') &&
    effects.length > 0 &&
    effects.every((effect) => effect === 'text' || effect === 'common_event')
  )
    return 'exit'
  return declared
}

function eventMatchesGoal(event: Loose, goal: InteractionGoal, state?: Loose) {
  const kind = effectiveInteractionKind(event, state)
  if (event.interactive === false || event.opened === true) return false
  if (kind === 'npc' && !goal.asksPeople) return false
  if (kind === 'door' && !goal.asksDoor) return false
  if ((kind === 'exit' || event.transit === true) && !goal.asksTransit) return false
  return true
}

function reachableTarget(event: Loose, byId: Map<number, Loose>, state?: Loose) {
  const routeStatus = String(event.routeStatus ?? '')
  const routeDistance = Number(event.routeDistance)
  if (!['reachable', 'already_there', 'event_boundary'].includes(routeStatus) || !Number.isFinite(routeDistance)) return false
  if (routeStatus !== 'event_boundary') return true
  const boundaries = Array.isArray(event.eventBoundaryIds) ? event.eventBoundaryIds.map(Number).filter(Number.isFinite) : []
  return boundaries.length > 0 && boundaries.every((boundaryId) => effectiveInteractionKind(byId.get(boundaryId) ?? {}, state) === 'door')
}

export function interactionEventSignature(state: unknown, eventId: number): string | null {
  const events = objects(state && typeof state === 'object' ? (state as Loose).nearbyEvents : undefined)
  const event = events.find((candidate) => Number(candidate.id) === eventId)
  if (!event) return null
  return JSON.stringify([event.pageIndex ?? null, event.kind ?? 'unknown', event.transit === true, event.sprite ?? null, event.effects ?? []])
}

/** Hard execution guard: the model can propose, but cannot override user scope or stale state. */
export function validateInteractionTarget(state: unknown, goalText: string, eventId: number, interacted: ReadonlySet<number>): InteractionTargetDecision {
  const goal = compileInteractionGoal(goalText)
  const source = state && typeof state === 'object' ? (state as Loose) : {}
  const events = objects(source.nearbyEvents)
  const byId = new Map(events.map((event) => [Number(event.id), event]))
  const event = events.find((candidate) => Number(candidate.id) === eventId)
  if (!event) return { accepted: false, reason: 'target_missing', eventId }
  const kind = effectiveInteractionKind(event, source)
  if (interacted.has(eventId) || !eventMatchesGoal(event, goal, source)) return { accepted: false, reason: 'target_excluded', eventId, kind }
  if (!reachableTarget(event, byId, source)) return { accepted: false, reason: 'target_unreachable', eventId, kind }
  return { accepted: true }
}

export function remainingInteractionTargets(state: unknown, goalText: string, interacted: ReadonlySet<number>) {
  const goal = compileInteractionGoal(goalText)
  if (!goal.multi) return []
  const source = state && typeof state === 'object' ? (state as Loose) : {}
  const events = objects(source.nearbyEvents)
  const byId = new Map(events.map((event) => [Number(event.id), event]))
  return events
    .filter((event) => eventMatchesGoal(event, goal, source) && !interacted.has(Number(event.id)) && reachableTarget(event, byId, source))
    .map((event) => Number(event.id))
    .filter(Number.isFinite)
}

/**
 * Pick the nearest currently reachable event for broad multi-interaction goals.
 * The plugin remains the source of truth for visible-area routing; this layer
 * prevents small models from reverting to event id or Manhattan ordering.
 */
export function nearestInteractionTarget(state: unknown, goal: string, interacted: ReadonlySet<number>): number | null {
  if (!isMultiInteractionGoal(goal) || !state || typeof state !== 'object') return null
  const source = state as Loose
  const events = objects(source.nearbyEvents)
  const byId = new Map(events.map((event) => [Number(event.id), event]))
  const { asksPeople, asksDoor, asksTransit } = compileInteractionGoal(goal)

  const targets: Target[] = []
  for (const event of events) {
    const id = Number(event.id)
    const kind = effectiveInteractionKind(event, source)
    const routeStatus = String(event.routeStatus ?? '')
    const routeDistance = Number(event.routeDistance)
    const boundaries = Array.isArray(event.eventBoundaryIds) ? event.eventBoundaryIds.map(Number).filter(Number.isFinite) : []
    if (!Number.isFinite(id) || interacted.has(id) || event.opened === true || event.interactive === false) continue
    if (kind === 'npc' && !asksPeople) continue
    if (kind === 'door' && !asksDoor) continue
    if ((kind === 'exit' || event.transit === true) && !asksTransit) continue
    if (!reachableTarget(event, byId, source)) continue
    targets.push({ id, kind, routeStatus, routeDistance, eventBoundaryIds: boundaries })
  }
  targets.sort((a, b) => a.routeDistance - b.routeDistance || a.eventBoundaryIds.length - b.eventBoundaryIds.length || a.id - b.id)
  return targets[0]?.id ?? null
}
