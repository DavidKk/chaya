import type { LogEntry } from './types'

export const MAX_LOG_ENTRY_BYTES = 16 * 1024
const IMPORTANT_KEYS = ['operationId', 'parentId', 'requestId', 'id', 'operation', 'method', 'path', 'status', 'elapsedMs', 'state', 'outcome', 'phase', 'startedAt', 'finishedAt']

function utf8Bytes(text: string): number {
  let bytes = 0
  for (const character of text) {
    const point = character.codePointAt(0)!
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
  }
  return bytes
}

/** Bound payloads before retaining them in memory or serializing them for transport. */
function compactMeta(value: unknown, depth = 0, budget = { nodes: 128, characters: 4000 }): unknown {
  if (--budget.nodes < 0) return '[omitted]'
  if (typeof value === 'string') {
    const limit = Math.max(0, Math.min(1024, budget.characters))
    budget.characters -= Math.min(value.length, limit)
    return value.length > limit ? `${value.slice(0, limit)} [truncated]` : value
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'bigint') return String(value).slice(0, 128)
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value
  }
  if (depth >= 4) return '[omitted]'
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (let i = 0; i < Math.min(value.length, 16) && budget.nodes > 0; i++) out.push(compactMeta(value[i], depth + 1, budget))
    return out
  }
  const out: [string, unknown][] = []
  // Stop enumeration early rather than allocating every key of a large payload.
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    if (out.length >= 24 || budget.nodes <= 0) {
      out.push(['truncated', true])
      break
    }
    out.push([key.slice(0, 128), compactMeta((value as Record<string, unknown>)[key], depth + 1, budget)])
  }
  return Object.fromEntries(out)
}

export function serializeLogEntry(entry: LogEntry): string {
  const meta = entry.meta as Record<string, unknown> | undefined
  let reduced: unknown
  const important: Record<string, unknown> = {}
  try {
    for (const key of IMPORTANT_KEYS) {
      const value = meta?.[key]
      if (['string', 'number', 'boolean'].includes(typeof value)) important[key] = typeof value === 'string' ? value.slice(0, 128) : value
    }
    reduced = compactMeta(meta)
  } catch {
    reduced = { truncated: true }
  }
  const compact: LogEntry = {
    id: String(entry.id).slice(0, 128),
    ts: Number.isFinite(entry.ts) ? entry.ts : Date.now(),
    level: entry.level,
    source: String(entry.source).slice(0, 64),
    message: String(entry.message).slice(0, 2000),
    meta: reduced && typeof reduced === 'object' && !Array.isArray(reduced) ? { ...reduced, ...important } : reduced,
  }
  let line = `${JSON.stringify(compact)}\n`
  if (utf8Bytes(line) <= MAX_LOG_ENTRY_BYTES) return line
  compact.meta = { truncated: true, ...important }
  line = `${JSON.stringify(compact)}\n`
  return utf8Bytes(line) <= MAX_LOG_ENTRY_BYTES ? line : `${JSON.stringify({ ...compact, message: compact.message.slice(0, 500) })}\n`
}

/** Round-tripping detaches metadata and sliced strings from the original, potentially huge payload. */
export function compactLogEntry(entry: LogEntry): LogEntry {
  return JSON.parse(serializeLogEntry(entry)) as LogEntry
}

export function logEntryBytes(entry: LogEntry): number {
  return utf8Bytes(`${JSON.stringify(entry)}\n`)
}
