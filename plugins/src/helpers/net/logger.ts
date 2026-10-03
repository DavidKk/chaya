/**
 * Plugin logger — always print to console;
 * HTTP report only when Chaya is reachable ("don't send if offline").
 * Server-side store: services/log/file-store.
 */

import { buildChayaConsoleLogArgs, type ChayaConsoleLogLevel } from '@chaya-lib/plugin/console-styles'

import { resolveApiBase, resolveLogUrl } from '../env/env'
import { chayaFetch, chayaPostJson } from './http'

export type ChayaLogLevel = ChayaConsoleLogLevel

type QueueItem = {
  level: ChayaLogLevel
  source: string
  message: string
  meta?: unknown
  ts: number
}

export type LocalPluginLog = QueueItem & { id: number }
type LocalLogStore = { nextId: number; entries: LocalPluginLog[] }
const LOCAL_LOG_EVENT = 'chaya:plugin-log'
const LOCAL_LOG_LIMIT = 300

function localLogStore(): LocalLogStore {
  const host = globalThis as typeof globalThis & { __chayaPluginLogs?: LocalLogStore }
  return (host.__chayaPluginLogs ??= { nextId: 0, entries: [] })
}

/** All plugin IIFEs share this in-game history, including while the Web service is offline. */
export function readLocalPluginLogs(): LocalPluginLog[] {
  return localLogStore().entries
}

export function subscribeLocalPluginLogs(listener: () => void): () => void {
  window.addEventListener(LOCAL_LOG_EVENT, listener)
  return () => window.removeEventListener(LOCAL_LOG_EVENT, listener)
}

export function clearLocalPluginLogs(): void {
  localLogStore().entries = []
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCAL_LOG_EVENT))
}

const queue: QueueItem[] = []
let timer: ReturnType<typeof setTimeout> | null = null
/** null=unknown, true=reachable, false=unreachable (defer reports) */
let connected: boolean | null = null
let probing = false
let probeTimer: ReturnType<typeof setTimeout> | null = null

const PROBE_RETRY_MS = 12_000
const HOME_PATH = /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|\/root|[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+)(?:[\\/][^\s"'<>()[\],;]*)*/g

function redactLocalPaths(text: string): string {
  return text.replace(HOME_PATH, (path) => {
    const normalized = path.replace(/\\/g, '/')
    const home = normalized.replace(/^(?:\/(?:Users|home)\/[^/]+|\/root|[A-Za-z]:\/Users\/[^/]+)/, '')
    const www = home.lastIndexOf('/www/')
    if (www >= 0) return `~/www/${home.slice(www + 5)}`
    const parts = home.split('/').filter(Boolean)
    return parts.length ? `~/${parts.slice(-2).join('/')}` : '~'
  })
}

function safeMeta(meta: unknown): unknown {
  try {
    const value = meta instanceof Error ? { name: meta.name, message: meta.message, stack: meta.stack } : meta
    if (typeof value === 'string') return redactLocalPaths(value)
    const json = JSON.stringify(value, (_key, item: unknown) => (typeof item === 'string' ? redactLocalPaths(item) : item))
    return json === undefined ? undefined : JSON.parse(json)
  } catch {
    return redactLocalPaths(String(meta))
  }
}

function formatMessage(parts: unknown[]): string {
  return parts
    .map((p) => {
      if (p == null) return ''
      if (typeof p === 'string') return redactLocalPaths(p)
      try {
        return JSON.stringify(safeMeta(p))
      } catch {
        return redactLocalPaths(String(p))
      }
    })
    .filter(Boolean)
    .join(' ')
}

/** Browser mode: Env sets `CHAYA_LOG_TRANSPORT = 'link'`; entries reach the page via the game link, never the server */
export function logsViaLink(): boolean {
  try {
    return (window as Window & { CHAYA_LOG_TRANSPORT?: string }).CHAYA_LOG_TRANSPORT === 'link'
  } catch {
    return false
  }
}

function scheduleReconnectProbe() {
  if (probeTimer) return
  probeTimer = setTimeout(() => {
    probeTimer = null
    connected = null
  }, PROBE_RETRY_MS)
}

async function probeConnected(): Promise<boolean> {
  if (connected === true) return true
  if (connected === false) return false
  if (probing) return false
  probing = true
  try {
    const res = await chayaFetch(`${resolveApiBase().replace(/\/$/, '')}/api/runtime/heartbeat`, {
      method: 'GET',
    })
    connected = res.ok
  } catch {
    connected = false
  } finally {
    probing = false
  }
  if (!connected) scheduleReconnectProbe()
  return connected === true
}

function scheduleFlush() {
  if (timer) return
  if (connected === false) return
  timer = setTimeout(() => {
    timer = null
    void flush()
  }, 120)
}

async function flush() {
  if (!queue.length) return
  if (!(await probeConnected())) {
    // Service down: drop pending reports to avoid backlog; already logged to console
    queue.length = 0
    return
  }
  const batch = queue.splice(0, queue.length)
  try {
    const res = await chayaPostJson(resolveLogUrl(), { entries: batch })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    connected = true
  } catch {
    connected = false
    scheduleReconnectProbe()
  }
}

function emit(level: ChayaLogLevel, source: string, ...contents: unknown[]) {
  const message = formatMessage(contents)
  const meta = contents.length === 1 && typeof contents[0] !== 'string' ? safeMeta(contents[0]) : contents.length > 1 ? safeMeta(contents.slice(1)) : undefined
  const safeSource = redactLocalPaths(String(source || 'plugin'))

  const args = buildChayaConsoleLogArgs(safeSource, level, message)
  if (level === 'fail') console.error(...args)
  else if (level === 'warn') console.warn(...args)
  else console.log(...args)

  const local = localLogStore()
  const entry: LocalPluginLog = { id: ++local.nextId, level, source: safeSource, message, meta, ts: Date.now() }
  local.entries = [...local.entries.slice(-(LOCAL_LOG_LIMIT - 1)), entry]
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCAL_LOG_EVENT))

  // Known disconnected, or logs travel over the game link: do not queue HTTP reports
  if (connected === false || logsViaLink()) return

  queue.push({
    level,
    source: safeSource,
    message,
    meta: contents.length === 1 && typeof contents[0] === 'string' ? undefined : meta,
    ts: Date.now(),
  })
  if (queue.length > 200) queue.splice(0, queue.length - 200)
  scheduleFlush()
}

/** Scoped logger (MagickMonkey-style scopes) */
export function createLogger(defaultSource: string) {
  return {
    ok: (...contents: unknown[]) => emit('ok', defaultSource, ...contents),
    info: (...contents: unknown[]) => emit('info', defaultSource, ...contents),
    warn: (...contents: unknown[]) => emit('warn', defaultSource, ...contents),
    fail: (...contents: unknown[]) => emit('fail', defaultSource, ...contents),
  }
}

export const ChayaLog = {
  history: readLocalPluginLogs,
  subscribe: subscribeLocalPluginLogs,
  clear: clearLocalPluginLogs,
  ok(source: string, ...contents: unknown[]) {
    emit('ok', source, ...contents)
  },
  info(source: string, ...contents: unknown[]) {
    emit('info', source, ...contents)
  },
  warn(source: string, ...contents: unknown[]) {
    emit('warn', source, ...contents)
  },
  fail(source: string, ...contents: unknown[]) {
    emit('fail', source, ...contents)
  },
  /** @deprecated */
  error(source: string, ...contents: unknown[]) {
    emit('fail', source, ...contents)
  },
  flush,
  /** Manual probe / reset reachability (for tests) */
  async ping(): Promise<boolean> {
    connected = null
    return probeConnected()
  },
  createLogger,
}

export type ChayaLogApi = typeof ChayaLog
