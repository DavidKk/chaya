import { hookMethod } from '../helpers/game/method-hook'

type CanvasText = { text: string; at: number }

const CURRENT_MS = 1_000
const RECENT_MS = 10_000
const MAX_LINES = 40
const MAX_TEXT_LENGTH = 160

const current = new Map<string, CanvasText>()
const recent = new Map<string, CanvasText>()
const canvasIds = new WeakMap<object, number>()
let nextCanvasId = 0
let scene: unknown

function currentScene() {
  return (globalThis as typeof globalThis & { SceneManager?: { _scene?: unknown } }).SceneManager?._scene
}

function resetForScene() {
  const next = currentScene()
  if (scene === next) return
  scene = next
  current.clear()
  recent.clear()
}

function remember(target: Map<string, CanvasText>, canvas: object, value: unknown, x: unknown, y: unknown) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
  if (!text) return
  let canvasId = canvasIds.get(canvas)
  if (!canvasId) {
    canvasId = ++nextCanvasId
    canvasIds.set(canvas, canvasId)
  }
  const key = `${canvasId}:${Math.round(Number(x))}:${Math.round(Number(y))}`
  const at = Date.now()
  target.delete(key)
  target.set(key, { text, at })
  if (target.size > MAX_LINES) target.delete(target.keys().next().value!)
}

export function readRenderedText() {
  resetForScene()
  const now = Date.now()
  const read = (source: Map<string, CanvasText>, lifetime: number) => {
    for (const [key, entry] of source) if (now - entry.at > lifetime) source.delete(key)
    return [...source.values()].map((entry) => entry.text)
  }
  return { visible: read(current, CURRENT_MS), recentBitmap: read(recent, RECENT_MS) }
}

export function startRenderedTextCapture(): () => void {
  if (typeof CanvasRenderingContext2D === 'undefined') return () => {}
  const prototype = CanvasRenderingContext2D.prototype
  const capture = (context: CanvasRenderingContext2D, value: unknown, x: unknown, y: unknown) => {
    resetForScene()
    const canvas = context.canvas
    if (!canvas) return
    remember(canvas.isConnected ? current : recent, canvas, value, x, y)
  }
  const stopFill = hookMethod(
    prototype,
    'fillText',
    (original) =>
      function (this: CanvasRenderingContext2D, text: string, ...args: unknown[]) {
        capture(this, text, args[0], args[1])
        return original.call(this, text, ...args)
      }
  )
  const stopStroke = hookMethod(
    prototype,
    'strokeText',
    (original) =>
      function (this: CanvasRenderingContext2D, text: string, ...args: unknown[]) {
        capture(this, text, args[0], args[1])
        return original.call(this, text, ...args)
      }
  )
  return () => {
    stopStroke()
    stopFill()
    current.clear()
    recent.clear()
  }
}
