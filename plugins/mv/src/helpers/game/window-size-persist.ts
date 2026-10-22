/**
 * Persist NW window size after user resize into package.json → window.width/height
 * for the next launch (same place as the console "window size" control).
 */
import { createLogger } from '../net/logger'
import { tryNodeRequire } from '../node/node-require'
import { detectGameIdentity } from './game-identity'

const log = createLogger('WindowSize')

type NwWindow = {
  width: number
  height: number
  isFullscreen?: boolean
  on: (ev: string, fn: (...args: unknown[]) => void) => void
}

type NwGlobal = {
  Window?: { get: () => NwWindow }
}

const SAVE_DEBOUNCE_MS = 450
const MIN_W = 320
const MIN_H = 240

function resolvePackageJsonPath(): string | null {
  const req = tryNodeRequire()
  const id = detectGameIdentity()
  if (!req || !id?.contentRoot) return null
  const fs = req('fs') as typeof import('fs')
  const path = req('path') as typeof import('path')
  for (const file of [path.join(id.contentRoot, 'package.json'), path.join(path.dirname(id.contentRoot), 'package.json')]) {
    if (fs.existsSync(file)) return file
  }
  return null
}

function clampSize(w: number, h: number): { width: number; height: number } | null {
  const width = Math.round(w)
  const height = Math.round(h)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width < MIN_W || height < MIN_H) return null
  return { width, height }
}

function writeWindowSize(width: number, height: number): boolean {
  const file = resolvePackageJsonPath()
  const req = tryNodeRequire()
  if (!file || !req) return false
  const fs = req('fs') as typeof import('fs')
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    const prev = raw.window && typeof raw.window === 'object' && !Array.isArray(raw.window) ? (raw.window as Record<string, unknown>) : {}
    const prevW = Number(prev.width)
    const prevH = Number(prev.height)
    if (prevW === width && prevH === height) return false
    raw.window = { ...prev, width, height }
    const tmp = `${file}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
    fs.renameSync(tmp, file)
    return true
  } catch (err) {
    log.warn('写入窗口大小失败', err && (err as Error).message ? (err as Error).message : err)
    return false
  }
}

/** Listen for NW window resize; debounce write-back to package.json */
export function startWindowSizePersist() {
  const g = globalThis as typeof globalThis & { __chayaWindowSizePersist?: boolean; nw?: NwGlobal }
  if (g.__chayaWindowSizePersist) return
  const nw = g.nw
  if (!nw?.Window?.get) return

  let win: NwWindow
  try {
    win = nw.Window.get()
  } catch {
    return
  }

  g.__chayaWindowSizePersist = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastLogged = ''

  const flush = (w?: number, h?: number) => {
    try {
      if (win.isFullscreen) return
      const size = clampSize(w ?? win.width, h ?? win.height)
      if (!size) return
      if (!writeWindowSize(size.width, size.height)) return
      const key = `${size.width}x${size.height}`
      if (key !== lastLogged) {
        lastLogged = key
        log.ok(`已记住窗口 ${key}`)
      }
    } catch {
      /* */
    }
  }

  const schedule = (w?: number, h?: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      flush(w, h)
    }, SAVE_DEBOUNCE_MS)
  }

  try {
    win.on('resize', (w, h) => {
      schedule(typeof w === 'number' ? w : undefined, typeof h === 'number' ? h : undefined)
    })
  } catch {
    /* Older NW without resize events: ignore */
  }
}
