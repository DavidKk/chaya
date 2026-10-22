/**
 * Interact with one map event the way a player would: walk next to it (or onto it when it lies under / over the
 * player), face it, press ok and advance its dialogue. Stops at choices, battles, scene changes and transfers so the
 * caller decides what happens next. RPG Maker MV / MZ globals only.
 */

import { AGENT_INTERACT_MAX_MS, type AgentParams } from '@/lib/runtime/agent-protocol'

import { movePlayer, planVisibleRoute } from './game-control'
import { readHistory } from './history'

type MapEvent = {
  _x: number
  _y: number
  _erased?: boolean
  _pageIndex?: number
  _trigger?: number
  event?: () => { name?: string } | undefined
  list?: () => Array<{ code: number }> | undefined
  isNormalPriority?: () => boolean
  isStarting?: () => boolean
}
type RmGlobals = {
  SceneManager?: { _scene?: unknown }
  Scene_Map?: new () => unknown
  $gameMap?: {
    mapId: () => number
    width?: () => number
    height?: () => number
    event?: (id: number) => MapEvent | undefined
    eventsXy?: (x: number, y: number) => Array<MapEvent & { eventId?: () => number; isThrough?: () => boolean }>
    isValid?: (x: number, y: number) => boolean
    isPassable?: (x: number, y: number, d: number) => boolean
    isEventRunning?: () => boolean
    _interpreter?: { eventId?: () => number; _eventId?: number }
  }
  $gamePlayer?: {
    x: number
    y: number
    isMoving: () => boolean
    isCollidedWithCharacters?: (x: number, y: number) => boolean
    isMapPassable?: (x: number, y: number, d: number) => boolean
  }
  $gameMessage?: { isNumberInput?: () => boolean; isItemChoice?: () => boolean }
}
type Entry = { id: unknown; name: unknown; count: unknown }
type StateView = {
  scene?: string | null
  gold?: unknown
  map?: { id?: number | null } | null
  inventory?: { items: Entry[]; weapons: Entry[]; armors: Entry[] } | null
  message?: { busy: boolean; speaker: unknown; text: string | null; choices: string[] | null } | null
  nearbyEvents?: Array<{ id: unknown; trigger: unknown; effects?: unknown }>
}
export type InteractIo = {
  press: (key: 'ok' | 'up' | 'down' | 'left' | 'right') => Promise<unknown>
  readState: () => StateView
  interrupted: () => boolean
}

const TICK_MS = 100
const MAX_PRESSES = 3
const MAX_MESSAGES = 12
/** Leave room for the dialogue after the walk. */
const WALK_SHARE = 0.6
/** Neighbour offset and the direction that faces the event from there. */
const SIDES = [
  [0, 1, 8],
  [0, -1, 2],
  [1, 0, 4],
  [-1, 0, 6],
] as const
const STEPS = [
  [0, 1, 2],
  [-1, 0, 4],
  [1, 0, 6],
  [0, -1, 8],
] as const
const MAX_SCAN_TILES = 40_000
const UNSAFE_PASSAGE = ['transfer', 'battle', 'shop']

const rm = () => globalThis as unknown as RmGlobals
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function onMap() {
  const { SceneManager, Scene_Map } = rm()
  return !!Scene_Map && SceneManager?._scene instanceof Scene_Map
}

function sceneName() {
  return ((rm().SceneManager?._scene as { constructor?: { name?: string } } | undefined)?.constructor?.name as string | undefined) ?? null
}

function running(eventId: number) {
  const map = rm().$gameMap
  const interpreter = map?._interpreter
  return Boolean(map?.event?.(eventId)?.isStarting?.()) || (interpreter?.eventId?.() ?? interpreter?._eventId) === eventId
}

/** Tiles to stand on, nearest first: the event tile itself when it does not block, else its walkable sides. */
function standTiles(event: MapEvent) {
  const { $gameMap: map, $gamePlayer: player } = rm()
  if (!map || !player) return []
  if (event.isNormalPriority?.() === false) return [{ x: event._x, y: event._y, face: 0 }]
  return SIDES.map(([dx, dy, face]) => ({ x: event._x + dx, y: event._y + dy, face }))
    .filter(({ x, y }) => map.isValid?.(x, y) !== false && [2, 4, 6, 8].some((d) => map.isPassable?.(x, y, d) !== false))
    .filter(({ x, y }) => (player.x === x && player.y === y) || !player.isCollidedWithCharacters?.(x, y))
}

/** Events on the shortest tile path that ignores characters: what stands in the way, such as a closed door. */
function blockers(goals: Array<{ x: number; y: number }>, targetId: number) {
  const { $gameMap: map, $gamePlayer: player } = rm()
  let width = 0
  let height = 0
  try {
    width = Number(map?.width?.()) || 0
    height = Number(map?.height?.()) || 0
  } catch {
    return []
  }
  if (!map?.eventsXy || !player?.isMapPassable || !goals.length || width * height > MAX_SCAN_TILES) return []
  const key = (x: number, y: number) => y * width + x
  const wanted = new Set(goals.map(({ x, y }) => key(x, y)))
  const parent = new Map<number, number>([[key(player.x, player.y), -1]])
  const queue = [key(player.x, player.y)]
  let found = -1
  for (let i = 0; i < queue.length && found < 0; i++) {
    const at = queue[i]
    const x = at % width
    const y = Math.floor(at / width)
    for (const [dx, dy, d] of STEPS) {
      const next = key(x + dx, y + dy)
      if (x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height || parent.has(next) || !player.isMapPassable(x, y, d)) continue
      parent.set(next, at)
      if (wanted.has(next)) found = next
      queue.push(next)
    }
  }
  const blocking: Array<{ eventId: number; name: string | null }> = []
  for (let at = found; at >= 0; at = parent.get(at) ?? -1) {
    for (const event of map.eventsXy(at % width, Math.floor(at / width))) {
      const id = event.eventId?.()
      if (id == null || id === targetId || event._erased || event.isNormalPriority?.() === false || event.isThrough?.()) continue
      if (!blocking.some((item) => item.eventId === id)) blocking.unshift({ eventId: id, name: event.event?.()?.name ?? null })
    }
  }
  return blocking
}

/** Commands of the active page; [] without an active page, undefined when the engine does not expose them. */
function pageCommands(event: MapEvent) {
  if ((event._pageIndex ?? 0) < 0) return []
  try {
    return event.list?.()
  } catch {
    return undefined
  }
}

function inventoryChanges(before: StateView, after: StateView) {
  const changes: Array<{ name: unknown; change: number }> = []
  for (const kind of ['items', 'weapons', 'armors'] as const) {
    const was = new Map((before.inventory?.[kind] ?? []).map((entry) => [entry.id, entry]))
    const now = new Map((after.inventory?.[kind] ?? []).map((entry) => [entry.id, entry]))
    for (const id of new Set([...was.keys(), ...now.keys()])) {
      const change = Number(now.get(id)?.count ?? 0) - Number(was.get(id)?.count ?? 0)
      if (change) changes.push({ name: now.get(id)?.name ?? was.get(id)?.name ?? null, change })
    }
  }
  return changes
}

type Outcome = { outcome: string } & Record<string, unknown>
type NavigationAttempt = {
  target: { x: number; y: number }
  durationMs: number
  arrived: boolean
  transferred: boolean
  interrupted: boolean
  blocked: boolean
  finalPosition?: unknown
}
type NavigationTrace = {
  start: { x: number; y: number }
  targetEvent: { id: number; x: number; y: number }
  candidates: Tile[]
  chosenStand?: Tile
  attempts: NavigationAttempt[]
}
type Run = { io: InteractIo; deadline: number; startMap: number; messages: Array<{ speaker: unknown; text: string }>; navigation: NavigationTrace }

/**
 * A blocker a player would simply walk into: touch-triggered and not leaving the map, fighting or trading
 * (closed doors that open and let the player through).
 */
function opensByTouch(state: StateView, eventId: number) {
  const facts = state.nearbyEvents?.find((item) => item.id === eventId)
  const effects = Array.isArray(facts?.effects) ? (facts.effects as unknown[]) : []
  return (facts?.trigger === 'player_touch' || facts?.trigger === 'event_touch') && !effects.some((effect) => UNSAFE_PASSAGE.includes(String(effect)))
}

type Tile = ReturnType<typeof standTiles>[number]

async function approach(run: Run, event: MapEvent, eventId: number): Promise<{ tiles: Tile[]; stand?: Tile; triggered?: boolean; transferred?: boolean; interrupted?: boolean }> {
  const player = rm().$gamePlayer!
  const candidates = standTiles(event)
  const plan = planVisibleRoute({ x: event._x, y: event._y }, eventId, candidates)
  const chosen = plan?.interactionPosition
  const tiles = chosen ? [...candidates].sort((a, b) => (a.x === chosen.x && a.y === chosen.y ? -1 : b.x === chosen.x && b.y === chosen.y ? 1 : 0)) : candidates
  run.navigation.candidates = tiles
  for (const tile of tiles) {
    if (run.io.interrupted()) return { interrupted: true, tiles }
    if (running(eventId)) return { triggered: true, tiles }
    if (player.x === tile.x && player.y === tile.y) {
      run.navigation.chosenStand = tile
      return { stand: tile, tiles }
    }
    const budget = (run.deadline - Date.now()) * WALK_SHARE
    if (budget < 500) break
    const startedAt = Date.now()
    const walk = await movePlayer({ x: tile.x, y: tile.y, timeoutMs: budget }, run.io.interrupted, eventId)
    const walkResult = walk as Record<string, unknown>
    run.navigation.attempts.push({
      target: { x: tile.x, y: tile.y },
      durationMs: Date.now() - startedAt,
      arrived: walkResult.arrived === true,
      transferred: walkResult.transferred === true,
      interrupted: walkResult.interrupted === true,
      blocked: walkResult.blocked === true || walkResult.blockedEventId != null,
      finalPosition: walkResult.position,
    })
    if ('transferred' in walk && walk.transferred) return { transferred: true, tiles }
    if (running(eventId) || walkResult.triggeredEventId === eventId) return { triggered: true, tiles }
    if (walkResult.interrupted === true) return { interrupted: true, tiles }
    if (walk.arrived) {
      run.navigation.chosenStand = tile
      return { stand: tile, tiles }
    }
  }
  return { tiles }
}

async function trigger(run: Run, eventId: number, openDoors: boolean): Promise<Outcome> {
  const event = rm().$gameMap?.event?.(eventId)
  if (!event || event._erased) return { outcome: 'gone' }
  if ((event._trigger ?? 0) >= 3) return { outcome: 'runs_by_itself', hint: 'Autorun / parallel event; the player cannot trigger it.' }
  if (pageCommands(event)?.every((command) => command.code === 0)) return { outcome: 'nothing_to_run', hint: 'Its current page has no commands.' }
  const startPage = event._pageIndex
  const before = run.io.readState()
  let reached = await approach(run, event, eventId)
  if (reached.interrupted) return { outcome: 'interrupted' }
  if (reached.transferred) return { outcome: 'transferred_on_the_way' }
  if (!reached.stand && !reached.triggered) {
    const blockedBy = blockers(reached.tiles, eventId)
    const state = run.io.readState()
    if (!openDoors || !blockedBy.length || !blockedBy.every((item) => opensByTouch(state, item.eventId))) {
      return {
        outcome: 'no_path',
        ...(blockedBy.length ? { blockedBy, hint: 'These events stand in the way; interacting with them may open the path.' } : {}),
      }
    }
    for (const item of blockedBy) {
      const opened = await trigger(run, item.eventId, false)
      if (opened.outcome !== 'done') return { outcome: 'no_path', blockedBy, openFailed: { eventId: item.eventId, ...opened } }
    }
    reached = await approach(run, event, eventId)
    if (reached.interrupted) return { outcome: 'interrupted' }
    if (reached.transferred) return { outcome: 'transferred_on_the_way' }
    if (!reached.stand && !reached.triggered) return { outcome: 'no_path', openedOnTheWay: blockedBy }
  }

  let triggered = Boolean(reached.triggered)
  let presses = 0
  let lastText = ''
  for (;;) {
    if (run.io.interrupted()) return { outcome: 'interrupted' }
    if (Date.now() > run.deadline) return { outcome: 'timeout', hint: 'The event is still running; observe and continue with chaya_live_press.' }
    if ((rm().$gameMap?.mapId() ?? run.startMap) !== run.startMap) return { outcome: 'transferred' }
    if (!onMap()) return { outcome: 'scene_changed' }
    triggered ||= running(eventId)
    const message = run.io.readState().message
    if (message?.busy) {
      const text = message.text?.trim() ?? ''
      if (text && text !== lastText && run.messages.length < MAX_MESSAGES) run.messages.push({ speaker: message.speaker, text: text.slice(0, 300) })
      lastText = text
      if (message.choices?.length) return { outcome: 'choice', choices: message.choices, hint: 'Pick with chaya_live_press up/down, then ok.' }
      if (rm().$gameMessage?.isNumberInput?.() || rm().$gameMessage?.isItemChoice?.()) return { outcome: 'input_required' }
      await run.io.press('ok')
      await wait(TICK_MS)
      continue
    }
    if (rm().$gameMap?.isEventRunning?.() || rm().$gamePlayer?.isMoving()) {
      await wait(TICK_MS)
      continue
    }
    const now = run.io.readState()
    if (triggered || event._erased || event._pageIndex !== startPage || now.gold !== before.gold || inventoryChanges(before, now).length) return { outcome: 'done' }
    if (presses >= MAX_PRESSES) return { outcome: 'no_reaction', hint: 'Nothing happened; the event may have no action for ok here.' }
    if (reached.stand?.face) {
      const key = { 2: 'down', 4: 'left', 6: 'right', 8: 'up' } as const
      await run.io.press(key[reached.stand.face as keyof typeof key])
      if (run.io.interrupted()) return { outcome: 'interrupted' }
      if (running(eventId) || run.io.readState().message?.busy) continue
    }
    presses += 1
    await run.io.press('ok')
    await wait(TICK_MS * 2)
  }
}

export async function interactEvent(params: AgentParams<'player.interact'>, io: InteractIo) {
  const { $gameMap: map, $gamePlayer: player } = rm()
  if (!onMap() || !map || !player) throw new Error('只能在地图场景中互动')
  const eventId = Math.round(Number(params.eventId))
  const event = map.event?.(eventId)
  if (!event || event._erased) throw new Error(`事件 ${eventId} 不在当前地图上`)
  const before = io.readState()
  if (before.message?.busy || map.isEventRunning?.())
    return { eventId, outcome: 'input_required', hint: 'Finish the current dialogue or event before interacting with another target.' }
  const historyBefore = readHistory({ limit: 1 }).lastSeq
  const startedAt = Date.now()
  const run: Run = {
    io,
    deadline: startedAt + AGENT_INTERACT_MAX_MS,
    startMap: map.mapId(),
    messages: [],
    navigation: {
      start: { x: player.x, y: player.y },
      targetEvent: { id: eventId, x: event._x, y: event._y },
      candidates: [],
      attempts: [],
    },
  }
  const openDoors = params.openDoors !== false
  const result = await trigger(run, eventId, openDoors)
  const after = io.readState()
  const mapId = rm().$gameMap?.mapId() ?? null
  const historyAfter = readHistory({ afterSeq: historyBefore, limit: 1 })
  return {
    eventId,
    name: event.event?.()?.name ?? null,
    ...result,
    messages: run.messages,
    goldChange: Number(after.gold ?? 0) - Number(before.gold ?? 0),
    inventoryChanges: inventoryChanges(before, after),
    ...(mapId !== run.startMap ? { transferred: true } : {}),
    mapId,
    scene: sceneName(),
    position: { x: rm().$gamePlayer?.x ?? null, y: rm().$gamePlayer?.y ?? null },
    historyRange: { fromSeq: historyAfter.lastSeq > historyBefore ? historyBefore + 1 : null, toSeq: historyAfter.lastSeq },
    navigation: {
      ...run.navigation,
      plannedSteps: run.navigation.chosenStand
        ? Math.abs(run.navigation.chosenStand.x - run.navigation.start.x) + Math.abs(run.navigation.chosenStand.y - run.navigation.start.y)
        : null,
      replanCount: Math.max(0, run.navigation.attempts.length - 1),
      ...(Array.isArray(result.blockedBy) ? { blockedBy: result.blockedBy } : {}),
      durationMs: Date.now() - startedAt,
      finalPosition: { x: rm().$gamePlayer?.x ?? null, y: rm().$gamePlayer?.y ?? null },
      outcome: run.navigation.chosenStand ? 'arrived' : result.outcome,
    },
  }
}
