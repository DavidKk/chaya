import path from 'node:path'

import { filterLogEntries, type LogEntry, type LogLevel, type LogQuery, normalizeLogLevel } from '@/lib/log'
import { LogBuffer } from '@/lib/log/buffer'
import { canUseDisk } from '@/lib/service-mode/mode'

import { appendLogToFile, clearLogFiles, loadLogsFromFiles, pluginLogFileStats, resolvePluginLogDir } from './file-store'

type Listener = (entry: LogEntry) => void

const MAX = 2000
export const MAX_LOG_SUBSCRIBERS = 64
const buffer = new LogBuffer(MAX)
const listeners = new Set<Listener>()
let seq = 0
let hydrated = false

function nextId() {
  seq += 1
  return `${Date.now().toString(36)}-${seq}`
}

function hydrateOnce() {
  if (hydrated) return
  hydrated = true
  if (!canUseDisk()) return
  try {
    const loaded = loadLogsFromFiles({ limit: MAX })
    for (const entry of loaded) buffer.append(entry)
    pluginLogFileStats()
    pluginLogFileStats(path.join(resolvePluginLogDir(), 'slow-http'))
    // Continue the sequence after restoring buffered entries.
    seq = buffer.list().length
  } catch {
    /* */
  }
}

/** In-process log buffer with persistence and API/SSE subscribers. */
export function appendLog(partial: { level?: string; source: string; message: string; meta?: unknown; ts?: number }): LogEntry {
  hydrateOnce()
  const entry = buffer.append({
    id: nextId(),
    ts: partial.ts ?? Date.now(),
    level: normalizeLogLevel(partial.level),
    source: String(partial.source || 'unknown').slice(0, 64),
    message: String(partial.message ?? '').slice(0, 8000),
    meta: partial.meta,
  })
  if (canUseDisk()) appendLogToFile(entry)
  for (const fn of listeners) {
    try {
      fn(entry)
    } catch {
      /* ignore subscriber errors */
    }
  }
  return entry
}

export function listLogs(opts?: LogQuery): LogEntry[] {
  hydrateOnce()
  return filterLogEntries(buffer.list(), opts)
}

export function clearLogs() {
  buffer.clear()
  if (canUseDisk()) clearLogFiles()
}

export function subscribeLogs(fn: Listener): () => void {
  hydrateOnce()
  if (listeners.size >= MAX_LOG_SUBSCRIBERS) throw new Error('Log subscriber limit reached')
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function logBusStats() {
  hydrateOnce()
  return {
    entries: buffer.list().length,
    capacity: MAX,
    memory: buffer.stats(),
    listeners: listeners.size,
    maxListeners: MAX_LOG_SUBSCRIBERS,
    file: canUseDisk() ? pluginLogFileStats() : null,
    slowFile: canUseDisk() ? pluginLogFileStats(path.join(resolvePluginLogDir(), 'slow-http')) : null,
    dir: canUseDisk() ? resolvePluginLogDir() : null,
    persistence: canUseDisk() ? 'disk' : 'memory',
  }
}

export type { LogEntry, LogLevel }
