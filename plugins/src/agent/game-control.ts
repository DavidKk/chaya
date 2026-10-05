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
  $gameMap?: { mapId: () => number }
  $gamePlayer?: { x: number; y: number; isMoving: () => boolean }
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

export async function movePlayer(params: AgentParams<'player.moveTo'>) {
  const { $gamePlayer, $gameTemp, $gameMap } = rm()
  if (!onMap() || !$gamePlayer || !$gameTemp || !$gameMap) throw new Error('只能在地图场景中行走')
  const x = Math.round(finite(params.x, 'x'))
  const y = Math.round(finite(params.y, 'y'))
  const timeout = clamp(params.timeoutMs == null ? AGENT_MOVE_DEFAULT_MS : finite(params.timeoutMs, 'timeoutMs'), 500, AGENT_MOVE_MAX_MS)
  // Written directly: with click-move off, `setDestination` is patched into a no-op
  $gameTemp._destinationX = x
  $gameTemp._destinationY = y
  const startMap = $gameMap.mapId()
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await wait(100)
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
  return { arrived, ...(transferred ? { transferred } : {}), mapId, position: { x: $gamePlayer.x, y: $gamePlayer.y }, target: { x, y } }
}

export function quitGame() {
  const exit = rm().SceneManager?.exit
  if (typeof exit !== 'function') throw new Error('游戏未就绪，无法退出')
  // Let the reply leave before the window closes
  setTimeout(() => exit.call(rm().SceneManager), 200)
  return { quit: true }
}
