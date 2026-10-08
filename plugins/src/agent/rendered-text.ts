import type { AgentCommandInput, AgentDirectionKey } from '@/lib/runtime/agent-protocol'

import { hookMethod } from '../helpers/game/method-hook'

type CanvasText = { text: string; at: number; canvas: number; x: number; y: number }

const CURRENT_MS = 1_000
const RECENT_MS = 10_000
const MAX_LINES = 40
const MAX_TEXT_LENGTH = 160
const ARROWS: Record<string, AgentDirectionKey> = {
  '←': 'left',
  '⇐': 'left',
  '⬅': 'left',
  '◀': 'left',
  '◄': 'left',
  '→': 'right',
  '⇒': 'right',
  '➡': 'right',
  '▶': 'right',
  '►': 'right',
  '↑': 'up',
  '⇑': 'up',
  '⬆': 'up',
  '▲': 'up',
  '↓': 'down',
  '⇓': 'down',
  '⬇': 'down',
  '▼': 'down',
}
const ARROW_LINE = new RegExp(`^[${Object.keys(ARROWS).join('')}\\s]+$`)
/** Same-row arrows drawn one glyph at a time sit within this vertical drift */
const ROW_DRIFT = 6
/** How far below its skill name an arrow row may sit */
const LABEL_REACH = 72
/** Rough upper bound of one glyph's advance in RPG Maker's default font */
const GLYPH_WIDTH = 28
const COLUMN_GAP = 40
const MAX_COMMANDS = 16
const MAX_COMMAND_KEYS = 12

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
  const px = Math.round(Number(x)) || 0
  const py = Math.round(Number(y)) || 0
  const key = `${canvasId}:${px}:${py}`
  target.delete(key)
  target.set(key, { text, at: Date.now(), canvas: canvasId, x: px, y: py })
  if (target.size > MAX_LINES) target.delete(target.keys().next().value!)
}

function forget(canvas: number, x: number, y: number, w: number, h: number) {
  for (const source of [current, recent]) {
    for (const [key, entry] of source) {
      if (entry.canvas === canvas && entry.x >= x && entry.x < x + w && entry.y >= y && entry.y <= y + h) source.delete(key)
    }
  }
}

function fresh(source: Map<string, CanvasText>, lifetime: number) {
  const now = Date.now()
  for (const [key, entry] of source) if (now - entry.at > lifetime) source.delete(key)
  return [...source.values()]
}

export function readRenderedText() {
  resetForScene()
  return { visible: fresh(current, CURRENT_MS).map((entry) => entry.text), recentBitmap: fresh(recent, RECENT_MS).map((entry) => entry.text) }
}

/**
 * Command-input battle skills (name above, arrow sequence below, e.g. "★セイバー" / "→ ←").
 * Arrows drawn as icons or images are not text and stay invisible here.
 */
export function readCommandInputs(): AgentCommandInput[] {
  resetForScene()
  // Window contents are offscreen bitmaps drawn once per refresh, so they live in `recent`
  const entries = [...fresh(current, CURRENT_MS), ...fresh(recent, RECENT_MS)]
  const arrows = entries.filter((entry) => ARROW_LINE.test(entry.text)).sort((a, b) => a.canvas - b.canvas || a.y - b.y || a.x - b.x)
  const lines: CanvasText[][] = []
  for (const entry of arrows) {
    const line = lines.find((items) => items[0].canvas === entry.canvas && Math.abs(items[0].y - entry.y) <= ROW_DRIFT)
    if (line) line.push(entry)
    else lines.push([entry])
  }
  // Multi-column windows put several skills on one line; a wide horizontal gap starts a new command
  const rows: CanvasText[][] = []
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    let row: CanvasText[] = []
    for (const entry of line) {
      const prev = row[row.length - 1]
      if (prev && entry.x - (prev.x + [...prev.text].length * GLYPH_WIDTH) > COLUMN_GAP) {
        rows.push(row)
        row = []
      }
      row.push(entry)
    }
    rows.push(row)
  }
  const labels = entries.filter((entry) => !ARROW_LINE.test(entry.text) && /\p{L}/u.test(entry.text))
  const commands: AgentCommandInput[] = []
  for (const row of rows) {
    const keys = [...row.map((entry) => entry.text).join('')].map((char) => ARROWS[char]).filter(Boolean)
    if (!keys.length || keys.length > MAX_COMMAND_KEYS) continue
    const { canvas, x, y } = row[0]
    const label = labels
      .filter((entry) => entry.canvas === canvas && y - entry.y > 0 && y - entry.y <= LABEL_REACH && x - entry.x > -24)
      .sort((a, b) => y - a.y + Math.abs(x - a.x) / 2 - (y - b.y + Math.abs(x - b.x) / 2))[0]
    commands.push({ label: label?.text ?? null, keys })
    if (commands.length >= MAX_COMMANDS) break
  }
  return commands
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
  // Bitmap.clear / clearRect wipe redrawn window contents; drop glyphs drawn there before
  const stopClear = hookMethod(
    prototype,
    'clearRect',
    (original) =>
      function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
        const id = this.canvas ? canvasIds.get(this.canvas) : undefined
        if (id) forget(id, x, y, w, h)
        return original.call(this, x, y, w, h)
      }
  )
  return () => {
    stopClear()
    stopStroke()
    stopFill()
    current.clear()
    recent.clear()
  }
}
