/**
 * ChayaAgent game operations beyond keys: see the screen, tap it, walk the player, quit. RPG Maker MV / MZ globals only.
 */

import { AGENT_MOVE_DEFAULT_MS, AGENT_MOVE_MAX_MS, AGENT_SNAP_DEFAULT_WIDTH, AGENT_SNAP_MAX_WIDTH, type AgentParams } from '@/lib/runtime/agent-protocol'

import { planRoute, type Point, type VisibleBounds } from './pathfinding'

type SnapBitmap = { canvas?: HTMLCanvasElement; _canvas?: HTMLCanvasElement; width: number; height: number }
type RmGlobals = {
  SceneManager?: { _stopped?: boolean; snap?: () => SnapBitmap; exit?: () => void; _scene?: { isActive?: () => boolean }; isGameActive?: () => boolean }
  Graphics?: { frameCount?: number; width: number; height: number; _canvas?: HTMLCanvasElement; pageToCanvasX?: (x: number) => number; pageToCanvasY?: (y: number) => number }
  TouchInput?: {
    isPressed?: () => boolean
    x?: number
    y?: number
    _onMouseMove?: (event: MouseEvent) => void
    _onMouseDown?: (event: MouseEvent) => void
    _onMouseUp?: (event: MouseEvent) => void
  }
  Scene_Map?: new () => unknown
  $gameMap?: {
    mapId: () => number
    width?: () => number
    height?: () => number
    displayX?: () => number
    displayY?: () => number
    screenTileX?: () => number
    screenTileY?: () => number
    tileWidth?: () => number
    tileHeight?: () => number
    isEventRunning?: () => boolean
    isValid?: (x: number, y: number) => boolean
    isPassable?: (x: number, y: number, direction: number) => boolean
    events?: () => Array<{
      _x: number
      _y: number
      _eventId?: number
      _trigger?: number
      _erased?: boolean
      eventId?: () => number
      isStarting?: () => boolean
      isNormalPriority?: () => boolean
      isThrough?: () => boolean
    }>
  }
  $gamePlayer?: {
    x: number
    y: number
    _realX?: number
    _realY?: number
    isMoving: () => boolean
    isTransferring?: () => boolean
    canMove?: () => boolean
    moveStraight?: (direction: number) => void
  }
  $gameSystem?: { isTouchMoveEnabled?: () => boolean }
  $gameMessage?: { isBusy?: () => boolean }
  $gameTemp?: {
    isCommonEventReserved?: () => boolean
    clearDestination?: () => void
    _destinationX: number | null
    _destinationY: number | null
    isDestinationValid: () => boolean
  }
}

const TAP_DEFAULT_FRAMES = 6
const FRAME_MS = 1000 / 60

const rm = () => globalThis as unknown as RmGlobals
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const REVERSE = { 2: 8, 4: 6, 6: 4, 8: 2 } as const

function finite(value: unknown, key: string): number {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${key} 需为数字`)
  return n
}

function onMap(): boolean {
  const { SceneManager, Scene_Map } = rm()
  return !!Scene_Map && SceneManager?._scene instanceof Scene_Map
}

/** RPG Maker's `$gameMap.width()` reads `$dataMap.width`; that throws while the map is unloading. */
function mapTileSize(map: NonNullable<RmGlobals['$gameMap']>): { width: number; height: number } | null {
  try {
    const width = Number(map.width?.())
    const height = Number(map.height?.())
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
    return { width, height }
  } catch {
    return null
  }
}

export function currentVisibleBounds(edge = 1): VisibleBounds | null {
  const map = rm().$gameMap
  const player = rm().$gamePlayer
  if (!map) return null
  const size = mapTileSize(map)
  if (!size) {
    const x = player?.x ?? 0
    const y = player?.y ?? 0
    return { minX: Math.max(0, x - 64), minY: Math.max(0, y - 64), maxX: x + 64, maxY: y + 64 }
  }
  const { width, height } = size
  const displayX = Math.floor(map.displayX?.() ?? 0)
  const displayY = Math.floor(map.displayY?.() ?? 0)
  const screenX = Math.ceil(map.screenTileX?.() ?? width)
  const screenY = Math.ceil(map.screenTileY?.() ?? height)
  return {
    minX: clamp(displayX - edge, 0, width - 1),
    minY: clamp(displayY - edge, 0, height - 1),
    maxX: clamp(displayX + screenX + edge, 0, width - 1),
    maxY: clamp(displayY + screenY + edge, 0, height - 1),
  }
}

function directionBetween(from: Point, to: Point): 2 | 4 | 6 | 8 | 0 {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return dx === 0 && dy === 1 ? 2 : dx === -1 && dy === 0 ? 4 : dx === 1 && dy === 0 ? 6 : dx === 0 && dy === -1 ? 8 : 0
}

export function planVisibleRoute(target: Point, targetEventId?: number, interactionPositions?: Point[]) {
  const { $gameMap: map, $gamePlayer: player } = rm()
  const bounds = currentVisibleBounds()
  if (!map || !player || !bounds) return null
  const events = (map.events?.() ?? [])
    .filter((event) => !event._erased && ((event.isNormalPriority?.() !== false && !event.isThrough?.()) || event._trigger === 1 || event._trigger === 2))
    .map((event) => ({ id: event.eventId?.() ?? event._eventId ?? 0, x: event._x, y: event._y, target: (event.eventId?.() ?? event._eventId) === targetEventId }))
    .filter((event) => event.id > 0)
  return planRoute({
    start: { x: player.x, y: player.y },
    target,
    bounds,
    events,
    targetEventId,
    interactionPositions,
    passable: (from, to) => {
      try {
        const direction = directionBetween(from, to)
        if (!direction || map.isValid?.(to.x, to.y) === false) return false
        if (!map.isPassable) return true
        const reverse = REVERSE[direction as 2 | 4 | 6 | 8]
        return map.isPassable(from.x, from.y, direction) !== false && map.isPassable(to.x, to.y, reverse) !== false
      } catch {
        return false
      }
    },
  })
}

export function snapScreen({ maxWidth }: AgentParams<'game.snap'>) {
  const { SceneManager, Graphics } = rm()
  const bitmap = SceneManager?.snap?.()
  const source = bitmap?.canvas ?? bitmap?._canvas
  if (!bitmap || !source || !Graphics) throw new Error('游戏画面未就绪')
  const width = Math.round(clamp(maxWidth == null ? AGENT_SNAP_DEFAULT_WIDTH : finite(maxWidth, 'maxWidth'), 64, AGENT_SNAP_MAX_WIDTH))
  const scale = Math.min(1, width / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
  return {
    mimeType: 'image/jpeg',
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    width: canvas.width,
    height: canvas.height,
    screen: { width: Graphics.width, height: Graphics.height },
  }
}

/** Use the same mouse handlers as player input, including pressed state and engine input rules. */
async function clickCanvas(x: number, y: number, holdMs: number) {
  const { Graphics, TouchInput } = rm()
  const canvas = Graphics?._canvas ?? document.querySelector<HTMLCanvasElement>('#GameCanvas')
  if (!Graphics || !TouchInput?._onMouseDown || !TouchInput._onMouseUp || !canvas) throw new Error('鼠标输入未就绪，无法模拟地图点击')
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) throw new Error('游戏画布尚未显示，无法模拟点击')
  const clientCoordinate = (value: number, start: number, size: number, resolution: number, scroll: number, convert?: (value: number) => number) => {
    if (!convert) return start + (value / resolution) * size
    const origin = convert(start + scroll)
    const span = convert(start + scroll + size) - origin
    if (!span) throw new Error('游戏画布坐标换算未就绪')
    return start + ((value - origin) / span) * size
  }
  const point = {
    clientX: clientCoordinate(x, rect.left, rect.width, Graphics.width, window.scrollX, Graphics.pageToCanvasX?.bind(Graphics)),
    clientY: clientCoordinate(y, rect.top, rect.height, Graphics.height, window.scrollY, Graphics.pageToCanvasY?.bind(Graphics)),
  }

  const emit = (type: 'mousemove' | 'mousedown' | 'mouseup') => {
    const event = new MouseEvent(type, { ...point, button: 0, buttons: type === 'mousedown' ? 1 : 0, bubbles: true, cancelable: true })
    if (type === 'mousedown') TouchInput._onMouseDown!(event)
    else if (type === 'mouseup') TouchInput._onMouseUp!(event)
    else TouchInput._onMouseMove?.(event)
  }
  emit('mousemove')
  emit('mousedown')
  try {
    await wait(holdMs)
    return {
      pressed: TouchInput.isPressed?.(),
      pointer: { x: TouchInput.x, y: TouchInput.y },
      destinationAccepted: rm().$gameTemp?.isDestinationValid(),
      gameActive: rm().SceneManager?.isGameActive?.(),
      sceneActive: rm().SceneManager?._scene?.isActive?.(),
      mapTouchEnabled: rm().$gameSystem?.isTouchMoveEnabled?.(),
    }
  } finally {
    emit('mouseup')
  }
}

export async function tapScreen(params: AgentParams<'input.tap'>) {
  const { Graphics } = rm()
  if (!Graphics) throw new Error('触摸输入不可用')
  const x = clamp(Math.round(finite(params.x, 'x')), 0, Graphics.width - 1)
  const y = clamp(Math.round(finite(params.y, 'y')), 0, Graphics.height - 1)
  const frames = Math.round(clamp(params.frames == null ? TAP_DEFAULT_FRAMES : finite(params.frames, 'frames'), 1, 120))
  await clickCanvas(x, y, frames * FRAME_MS)
  return { tapped: { x, y }, frames }
}

/** Every engine step must honor dialogue, event and player movement locks. */
function movementBlocked() {
  const state = rm()
  return (
    !onMap() ||
    Boolean(state.SceneManager?._stopped) ||
    Boolean(state.$gameMessage?.isBusy?.()) ||
    Boolean(state.$gameMap?.isEventRunning?.()) ||
    Boolean(state.$gameMap?.events?.().some((event) => event.isStarting?.())) ||
    Boolean(state.$gameTemp?.isCommonEventReserved?.()) ||
    Boolean(state.$gamePlayer?.isTransferring?.()) ||
    state.$gamePlayer?.canMove?.() === false
  )
}

function clearDestination() {
  const temp = rm().$gameTemp
  temp?.clearDestination?.()
  if (temp) {
    temp._destinationX = null
    temp._destinationY = null
  }
}

export async function movePlayer(params: AgentParams<'player.moveTo'>, interrupted: () => boolean = () => false, interactionEventId?: number) {
  const { $gamePlayer: player, $gameTemp: temp, $gameMap: map } = rm()
  if (!onMap() || !player || !temp || !map) throw new Error('只能在地图场景中行走')
  const target = { x: Math.round(finite(params.x, 'x')), y: Math.round(finite(params.y, 'y')) }
  const timeout = clamp(params.timeoutMs == null ? AGENT_MOVE_DEFAULT_MS : finite(params.timeoutMs, 'timeoutMs'), 500, AGENT_MOVE_MAX_MS)
  const startMap = map.mapId()
  const targetEventId = params.guard?.targetEventId ?? interactionEventId
  const frameStarted = rm().Graphics?.frameCount
  const deadline = Date.now() + timeout
  const actualPath = [{ x: player.x, y: player.y }]
  let navigation = planVisibleRoute(target, targetEventId)
  const plannedPath = navigation?.path ?? []
  let stopped = false
  let blockedReason: string | undefined
  let triggeredEventId: number | undefined
  let steps = 0
  try {
    // Remove a previous click destination before checking dialogue or event locks.
    clearDestination()
    while (Date.now() < deadline && map.mapId() === startMap && (player.x !== target.x || player.y !== target.y)) {
      if (interrupted() || movementBlocked()) {
        stopped = true
        break
      }
      const framesBefore = rm().Graphics?.frameCount
      if (framesBefore != null) {
        const tickDeadline = Math.min(deadline, Date.now() + 500)
        while (Date.now() < tickDeadline && rm().Graphics?.frameCount === framesBefore && !interrupted() && !movementBlocked()) await wait(16)
        if (interrupted() || movementBlocked()) {
          stopped = true
          break
        }
        if (rm().Graphics?.frameCount === framesBefore) {
          stopped = true
          blockedReason = 'game_not_updating'
          break
        }
      }
      if (player.isMoving()) {
        await wait(16)
        continue
      }
      const next = navigation ? navigation.path[1] : target
      if (!next) {
        blockedReason = navigation?.status ?? 'no_path'
        break
      }
      const boundary = map.events?.().find((event) => !event._erased && event._x === next.x && event._y === next.y && (event._trigger === 1 || event._trigger === 2))
      const boundaryId = boundary?.eventId?.() ?? boundary?._eventId
      if (boundary && boundaryId !== targetEventId) {
        blockedReason = 'event_boundary'
        break
      }
      const from = { x: player.x, y: player.y }
      const direction = directionBetween(from, next)
      if (!direction) {
        blockedReason = 'no_path'
        break
      }
      if (!player.moveStraight) throw new Error('游戏行走入口未就绪')
      // Do not issue a step after an event or dialogue has taken control.
      if (interrupted() || movementBlocked()) {
        stopped = true
        break
      }
      player.moveStraight(direction)
      await wait(16)
      while (Date.now() < deadline && map.mapId() === startMap && !interrupted() && !movementBlocked() && player.isMoving()) await wait(16)
      clearDestination()
      const moved = from.x !== player.x || from.y !== player.y
      if (moved && map.mapId() === startMap) actualPath.push({ x: player.x, y: player.y })
      steps++
      if (boundaryId != null && (map.mapId() !== startMap || boundary?.isStarting?.() || rm().$gameMessage?.isBusy?.())) triggeredEventId = boundaryId
      if (interrupted() || movementBlocked()) stopped = true
      if (stopped || map.mapId() !== startMap || params.stepwise) break
      if (!moved) {
        blockedReason = 'movement_blocked'
        break
      }
      if (navigation) navigation = planVisibleRoute(target, targetEventId)
    }
  } finally {
    clearDestination()
  }
  const mapId = map.mapId()
  const transferred = mapId !== startMap
  const arrived = !transferred && !stopped && player.x === target.x && player.y === target.y && !player.isMoving()
  return {
    arrived,
    inputMethod: 'guarded_engine_step',
    runtime: {
      frames: frameStarted != null && rm().Graphics?.frameCount != null ? rm().Graphics!.frameCount! - frameStarted : undefined,
      moving: player.isMoving(),
      realPosition: { x: player._realX, y: player._realY },
      playerReplaced: player !== rm().$gamePlayer,
    },
    ...(params.stepwise ? { moved: actualPath.length > 1 } : {}),
    ...(transferred ? { transferred: true } : {}),
    ...(stopped ? { interrupted: true, ...(blockedReason ? { blockedReason } : rm().SceneManager?._stopped ? { blockedReason: 'game_paused' } : {}) } : {}),
    ...(!arrived && !transferred && !stopped ? { blocked: true, blockedReason: blockedReason ?? 'timeout', eventBoundaryIds: navigation?.eventBoundaryIds ?? [] } : {}),
    ...(triggeredEventId != null ? { triggeredEventId } : {}),
    ...(navigation
      ? {
          navigation: {
            ...navigation,
            path: plannedPath,
            actualPath,
            replanCount: Math.max(0, steps - 1),
            finalPosition: { x: player.x, y: player.y },
            outcome: arrived ? 'arrived' : transferred ? 'transit' : stopped ? 'interrupted' : 'blocked',
          },
        }
      : {}),
    mapId,
    position: { x: player.x, y: player.y },
    target,
  }
}

export function quitGame() {
  const exit = rm().SceneManager?.exit
  if (typeof exit !== 'function') throw new Error('游戏未就绪，无法退出')
  // Let the reply leave before the window closes
  setTimeout(() => exit.call(rm().SceneManager), 200)
  return { quit: true }
}
