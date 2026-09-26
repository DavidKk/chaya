import { type LogEntry, type LogLevel, normalizeLogLevel } from '@/lib/log'
import { canUseDisk } from '@/lib/service-mode'

import { appendLogToFile, clearLogFiles, loadLogsFromFiles, pluginLogFileStats, resolvePluginLogDir } from './file-store'

type Listener = (entry: LogEntry) => void

const MAX = 2000
const buffer: LogEntry[] = []
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
    buffer.push(...loaded)
    if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX)
    // 避免 id 冲突：seq 继续往上
    seq = buffer.length
  } catch {
    /* */
  }
}

/** 进程内日志总线：环形缓冲 + 落盘 + 订阅（供 API / SSE） */
export function appendLog(partial: { level?: string; source: string; message: string; meta?: unknown; ts?: number }): LogEntry {
  hydrateOnce()
  const entry: LogEntry = {
    id: nextId(),
    ts: partial.ts ?? Date.now(),
    level: normalizeLogLevel(partial.level),
    source: String(partial.source || 'unknown').slice(0, 64),
    message: String(partial.message ?? '').slice(0, 8000),
    meta: partial.meta,
  }
  buffer.push(entry)
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX)
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

export function listLogs(opts?: { limit?: number; source?: string; level?: LogLevel; since?: number }): LogEntry[] {
  hydrateOnce()
  const limit = Math.min(1000, Math.max(1, opts?.limit ?? 200))
  let rows = buffer
  if (opts?.source) {
    const s = opts.source.toLowerCase()
    rows = rows.filter((e) => e.source.toLowerCase() === s)
  }
  if (opts?.level) {
    const lv = normalizeLogLevel(opts.level)
    rows = rows.filter((e) => e.level === lv)
  }
  if (opts?.since) rows = rows.filter((e) => e.ts >= opts.since!)
  return rows.slice(-limit)
}

export function clearLogs() {
  buffer.length = 0
  if (canUseDisk()) clearLogFiles()
}

export function subscribeLogs(fn: Listener): () => void {
  hydrateOnce()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function logBusStats() {
  hydrateOnce()
  return {
    entries: buffer.length,
    capacity: MAX,
    listeners: listeners.size,
    file: canUseDisk() ? pluginLogFileStats() : null,
    dir: canUseDisk() ? resolvePluginLogDir() : null,
    persistence: canUseDisk() ? 'disk' : 'memory',
  }
}

export type { LogEntry, LogLevel }
