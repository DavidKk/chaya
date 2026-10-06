/**
 * ChayaAgent game operations beyond keys: see the screen, tap it, walk the player, quit. RPG Maker MV / MZ globals only.
 */

import { AGENT_MOVE_DEFAULT_MS, AGENT_MOVE_MAX_MS, AGENT_SNAP_DEFAULT_WIDTH, AGENT_SNAP_MAX_WIDTH, type AgentParams } from '@/lib/runtime/agent-protocol'

type SnapBitmap = { canvas?: HTMLCanvasElement; _canvas?: HTMLCanvasElement; width: number; height: number }
type RmGlobals = {
  SceneManager?: { snap?: () => SnapBitmap; exit?: () => void; _scene?: unknown }
  Graphics?: { width: number; height: number }
  TouchInput?: { _onTrigger?: (x: number, y: number) => void; _onRelease?: (x: number, y: number) => void }
  Scene_Map?: new () => unknown
  $gameMap?: {
    mapId: () => number
    events?: () => Array<{ _x: number; _y: number; _eventId?: number; _trigger?: number; _erased?: boolean; eventId?: () => number; isStarting?: () => boolean }>
  }
  $gamePlayer?: {
    x: number
    y: number
    isMoving: () => boolean
    findDirectionTo?: (x: number, y: number) => number
    stepToward?: (x: number, y: number) => number
    moveStraight?: (direction: number) => void
  }
  $gameMessage?: { isBusy?: () => boolean }
  $gameTemp?: { _destinationX: number | null; _destinationY: number | null; isDestinationValid: () => boolean }
}

const TAP_DEFAULT_FRAMES = 6
const FRAME_MS = 1000 / 60

const rm = () => globalThis as unknown as RmGlobals
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function finite(value: unknown, key: string): number {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${key} 需为数字`)
  return n
}

function onMap(): boolean {
  const { SceneManager, Scene_Map } = rm()
  return !!Scene_Map && SceneManager?._scene instanceof Scene_Map
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

export async function tapScreen(params: AgentParams<'input.tap'>) {
  const { TouchInput, Graphics } = rm()
  if (!TouchInput?._onTrigger || !TouchInput._onRelease || !Graphics) throw new Error('触摸输入不可用')
  const x = clamp(Math.round(finite(params.x, 'x')), 0, Graphics.width - 1)
  const y = clamp(Math.round(finite(params.y, 'y')), 0, Graphics.height - 1)
  const frames = Math.round(clamp(params.frames == null ? TAP_DEFAULT_FRAMES : finite(params.frames, 'frames'), 1, 120))
  TouchInput._onTrigger(x, y)
  await wait(frames * FRAME_MS)
  TouchInput._onRelease(x, y)
  return { tapped: { x, y }, frames }
}

export async function movePlayer(params: AgentParams<'player.moveTo'>, interrupted: () => boolean = () => false) {
  const { $gamePlayer, $gameTemp, $gameMap } = rm()
  if (!onMap() || !$gamePlayer || !$gameTemp || !$gameMap) throw new Error('只能在地图场景中行走')
  const x = Math.round(finite(params.x, 'x'))
  const y = Math.round(finite(params.y, 'y'))
  const timeout = clamp(params.timeoutMs == null ? AGENT_MOVE_DEFAULT_MS : finite(params.timeoutMs, 'timeoutMs'), 500, AGENT_MOVE_MAX_MS)
  if (params.stepwise) {
    if (!$gamePlayer.moveStraight || (!$gamePlayer.findDirectionTo && !$gamePlayer.stepToward)) throw new Error('当前游戏不支持逐格寻路')
    if (rm().$gameMessage?.isBusy?.() || $gamePlayer.isMoving())
      return { arrived: false, interrupted: true, mapId: $gameMap.mapId(), position: { x: $gamePlayer.x, y: $gamePlayer.y }, target: { x, y } }
    const direction = ($gamePlayer.findDirectionTo || $gamePlayer.stepToward)!.call($gamePlayer, x, y)
    const delta = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] }[direction as 2 | 4 | 6 | 8]
    if (!delta)
      return { arrived: $gamePlayer.x === x && $gamePlayer.y === y, blocked: true, mapId: $gameMap.mapId(), position: { x: $gamePlayer.x, y: $gamePlayer.y }, target: { x, y } }
    const nextX = $gamePlayer.x + delta[0]
    const nextY = $gamePlayer.y + delta[1]
    const event = $gameMap.events?.().find((item) => !item._erased && item._x === nextX && item._y === nextY && (item._trigger === 1 || item._trigger === 2))
    const eventId = event ? (event.eventId?.() ?? event._eventId) : undefined
    if (event && eventId !== params.guard?.targetEventId)
      return { arrived: false, blockedEventId: eventId ?? null, mapId: $gameMap.mapId(), position: { x: $gamePlayer.x, y: $gamePlayer.y }, target: { x, y } }
    const startX = $gamePlayer.x
    const startY = $gamePlayer.y
    const startMap = $gameMap.mapId()
    $gamePlayer.moveStraight(direction)
    const deadline = Date.now() + timeout
    while (Date.now() < deadline && $gameMap.mapId() === startMap && onMap() && !interrupted() && $gamePlayer.isMoving()) await wait(16)
    const transferred = $gameMap.mapId() !== startMap
    const moved = startX !== $gamePlayer.x || startY !== $gamePlayer.y
    return {
      arrived: !transferred && $gamePlayer.x === x && $gamePlayer.y === y,
      moved,
      ...(transferred ? { transferred: true } : {}),
      ...(interrupted() || !onMap() || rm().$gameMessage?.isBusy?.() ? { interrupted: true } : {}),
      ...(eventId != null && (transferred || event?.isStarting?.() || rm().$gameMessage?.isBusy?.()) ? { triggeredEventId: eventId } : {}),
      mapId: $gameMap.mapId(),
      position: { x: $gamePlayer.x, y: $gamePlayer.y },
      target: { x, y },
    }
  }
  // Written directly: with click-move off, `setDestination` is patched into a no-op
  $gameTemp._destinationX = x
  $gameTemp._destinationY = y
  const startMap = $gameMap.mapId()
  const deadline = Date.now() + timeout
  let stopped = false
  while (Date.now() < deadline) {
    await wait(100)
    if (interrupted()) {
      stopped = true
      break
    }
    // A transfer tile on the way moved the player to another map
    if ($gameMap.mapId() !== startMap) break
    if ($gamePlayer.x === x && $gamePlayer.y === y && !$gamePlayer.isMoving()) break
    if (!$gameTemp.isDestinationValid() && !$gamePlayer.isMoving()) break
  }
  const mapId = $gameMap.mapId()
  const transferred = mapId !== startMap
  const arrived = !transferred && $gamePlayer.x === x && $gamePlayer.y === y
  if (!arrived) {
    $gameTemp._destinationX = null
    $gameTemp._destinationY = null
  }
  return { arrived, ...(transferred ? { transferred } : {}), ...(stopped ? { interrupted: true } : {}), mapId, position: { x: $gamePlayer.x, y: $gamePlayer.y }, target: { x, y } }
}

export function quitGame() {
  const exit = rm().SceneManager?.exit
  if (typeof exit !== 'function') throw new Error('游戏未就绪，无法退出')
  // Let the reply leave before the window closes
  setTimeout(() => exit.call(rm().SceneManager), 200)
  return { quit: true }
}
