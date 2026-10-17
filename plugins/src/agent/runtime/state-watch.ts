export type WatchPhase = 'map_navigation' | 'map_interaction' | 'dialogue' | 'choice' | 'battle' | 'menu' | 'transition'
export type WatchPoint = { x: number; y: number }
export type WatchPlan = {
  targetEventIds?: Iterable<number>
  remainingRoute?: WatchPoint[]
  nextPosition?: WatchPoint | null
}

export type WatchChange = {
  kind:
    | 'scene_changed'
    | 'map_changed'
    | 'battle_started'
    | 'battle_ended'
    | 'dialogue_started'
    | 'dialogue_changed'
    | 'choice_opened'
    | 'choice_closed'
    | 'target_added'
    | 'target_removed'
    | 'target_changed'
    | 'route_blocked'
    | 'player_deviated'
    | 'nearby_event_added'
  eventId?: number
  detail?: Record<string, unknown>
}

export type WatchTrigger = {
  phase: WatchPhase
  changes: WatchChange[]
  reason: string
  baselineSeq: number
  currentSeq: number
}

type EventSnapshot = {
  id: number
  x: number | null
  y: number | null
  kind: string | null
  interactive: boolean
  opened: boolean
  routeStatus: string | null
  routeDistance: number | null
  transit: boolean
}

type Snapshot = {
  scene: string | null
  mapId: number | null
  player: WatchPoint | null
  battle: { instanceId?: string | null } | null
  message: { busy: boolean; text: string | null; choices: string[] | null } | null
  events: EventSnapshot[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function point(value: unknown): WatchPoint | null {
  const item = record(value)
  const x = numberOrNull(item.x)
  const y = numberOrNull(item.y)
  return x == null || y == null ? null : { x, y }
}

function snapshotOf(value: unknown): Snapshot {
  const source = record(value)
  const map = record(source.map)
  const message = record(source.message)
  const battle = source.battle && typeof source.battle === 'object' ? record(source.battle) : null
  const events = Array.isArray(source.nearbyEvents)
    ? source.nearbyEvents
        .map((item): EventSnapshot | null => {
          const event = record(item)
          const id = numberOrNull(event.id)
          if (id == null) return null
          return {
            id,
            x: numberOrNull(event.x),
            y: numberOrNull(event.y),
            kind: typeof event.kind === 'string' ? event.kind : null,
            interactive: event.interactive === true,
            opened: event.opened === true,
            routeStatus: typeof event.routeStatus === 'string' ? event.routeStatus : null,
            routeDistance: numberOrNull(event.routeDistance),
            transit: event.transit === true,
          }
        })
        .filter((item): item is EventSnapshot => item !== null)
    : []
  const choices = Array.isArray(message.choices) ? message.choices.filter((item): item is string => typeof item === 'string') : null
  return {
    scene: typeof source.scene === 'string' ? source.scene : null,
    mapId: numberOrNull(map.id),
    player: point(source.player),
    battle: battle
      ? {
          instanceId: typeof battle.instanceId === 'string' ? battle.instanceId : null,
        }
      : null,
    message: source.message && typeof source.message === 'object' ? { busy: message.busy === true, text: typeof message.text === 'string' ? message.text : null, choices } : null,
    events,
  }
}

function key(event: EventSnapshot): string {
  return `${event.id}:${event.x ?? ''},${event.y ?? ''}:${event.kind ?? ''}:${event.interactive ? 1 : 0}:${event.opened ? 1 : 0}:${event.routeStatus ?? ''}:${event.routeDistance ?? ''}:${event.transit ? 1 : 0}`
}

function mapById(events: EventSnapshot[]): Map<number, EventSnapshot> {
  return new Map(events.map((event) => [event.id, event]))
}

function phaseFor(snapshot: Snapshot): WatchPhase {
  if (snapshot.battle) return 'battle'
  if (snapshot.message?.choices?.length) return 'choice'
  if (snapshot.message?.busy) return 'dialogue'
  if (snapshot.scene === 'Scene_Map') return 'map_navigation'
  if (snapshot.scene && /^Scene_(Menu|Item|Skill|Equip|Status|Options|Save|Load)/.test(snapshot.scene)) return 'menu'
  return 'transition'
}

function pointKey(value: WatchPoint | null | undefined): string {
  return value ? `${value.x},${value.y}` : ''
}

/** True only when a dynamic battle scene currently offers something the Agent can act on. */
export function battleRequiresAgentDecision(value: unknown): boolean {
  const state = record(value)
  const battle = record(state.battle)
  if (!state.battle || typeof state.battle !== 'object') return false
  if (state.qte || state.reactionAvailable) return true
  const message = record(state.message)
  if (message.busy === true || (Array.isArray(message.choices) && message.choices.length > 0)) return true
  if (battle.actor || (Array.isArray(state.commandInputs) && state.commandInputs.length > 0)) return true
  return Array.isArray(state.windows) && state.windows.some((window) => record(window).active === true)
}

export function diffGameState(previousValue: unknown, currentValue: unknown, plan: WatchPlan = {}, phase?: WatchPhase): WatchChange[] {
  const previous = snapshotOf(previousValue)
  const current = snapshotOf(currentValue)
  const activePhase = phase || phaseFor(current)
  const changes: WatchChange[] = []
  if (previous.scene !== current.scene) changes.push({ kind: 'scene_changed', detail: { from: previous.scene, to: current.scene } })
  if (previous.mapId !== current.mapId) changes.push({ kind: 'map_changed', detail: { from: previous.mapId, to: current.mapId } })

  if (activePhase === 'battle' || previous.battle || current.battle) {
    if (!previous.battle && current.battle) changes.push({ kind: 'battle_started' })
    if (previous.battle && !current.battle) changes.push({ kind: 'battle_ended' })
    return changes
  }

  const previousMessage = previous.message
  const currentMessage = current.message
  if (!previousMessage?.busy && currentMessage?.busy) changes.push({ kind: 'dialogue_started' })
  if (previousMessage?.busy && currentMessage?.busy && previousMessage.text !== currentMessage.text) changes.push({ kind: 'dialogue_changed' })
  if (!previousMessage?.choices?.length && currentMessage?.choices?.length) changes.push({ kind: 'choice_opened' })
  if (previousMessage?.choices?.length && !currentMessage?.choices?.length) changes.push({ kind: 'choice_closed' })
  if (activePhase === 'dialogue' || activePhase === 'choice') return changes

  const previousEvents = mapById(previous.events)
  const currentEvents = mapById(current.events)
  const targets = new Set(plan.targetEventIds || [])
  for (const id of targets) {
    const before = previousEvents.get(id)
    const after = currentEvents.get(id)
    if (before && !after) changes.push({ kind: 'target_removed', eventId: id })
    else if (!before && after) changes.push({ kind: 'target_added', eventId: id })
    else if (before && after && key(before) !== key(after)) changes.push({ kind: 'target_changed', eventId: id })
  }
  for (const event of current.events) {
    if (previousEvents.has(event.id) || !event.interactive || event.opened || event.kind === 'npc') continue
    if (event.routeDistance != null || event.transit) changes.push({ kind: 'nearby_event_added', eventId: event.id })
  }
  const nextPosition = plan.nextPosition
  if (nextPosition && current.player && pointKey(current.player) !== pointKey(previous.player) && pointKey(current.player) !== pointKey(nextPosition)) {
    changes.push({ kind: 'player_deviated', detail: { expected: nextPosition, actual: current.player } })
  }
  if (nextPosition && current.events.some((event) => event.x === nextPosition.x && event.y === nextPosition.y && event.id !== undefined)) {
    changes.push({ kind: 'route_blocked', detail: { nextPosition } })
  }
  const route = plan.remainingRoute || []
  if (route.length && current.events.some((event) => event.x != null && event.y != null && route.some((tile) => tile.x === event.x && tile.y === event.y))) {
    changes.push({ kind: 'route_blocked', detail: { remainingRoute: route.slice(0, 4) } })
  }
  return changes
}

export function formatWatchTrigger(trigger: WatchTrigger): string {
  const lines = trigger.changes.map((change) => `- ${change.kind}${change.eventId == null ? '' : ` eventId=${change.eventId}`}`)
  return `[GAME_STEERING_EVENT]\n阶段：${trigger.phase}\n请只根据以下相关变化重新评估当前方案：\n${lines.join('\n')}\n[/GAME_STEERING_EVENT]`
}

export function createGameWatchManager() {
  let previous: unknown
  let phase: WatchPhase = 'transition'
  let plan: WatchPlan = {}
  let sequence = 0
  return {
    setPlan(next: WatchPlan, nextPhase?: WatchPhase) {
      plan = next
      if (nextPhase) phase = nextPhase
    },
    reset(value?: unknown, nextPhase?: WatchPhase) {
      previous = value
      const inferred = value == null ? 'transition' : phaseFor(snapshotOf(value))
      phase = nextPhase || (inferred === 'map_navigation' && phase === 'map_interaction' ? phase : inferred)
      sequence += 1
    },
    update(value: unknown, nextPhase?: WatchPhase): WatchTrigger | null {
      const currentPhase = nextPhase || (phase === 'map_interaction' ? phase : phaseFor(snapshotOf(value)))
      const changes = previous == null ? [] : diffGameState(previous, value, plan, currentPhase)
      const baselineSeq = sequence
      previous = value
      phase = currentPhase
      sequence += 1
      if (!changes.length) return null
      return { phase: currentPhase, changes, reason: changes[0].kind, baselineSeq, currentSeq: sequence }
    },
    getPhase: () => phase,
  }
}
