/**
 * Persist plugin logs as daily NDJSON files:
 * logs/plugins/YYYY-MM-DD.ndjson
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { PLUGIN_LOGS_DIR, ROOT_PATH } from '@/constants/paths'
import { type LogEntry, type LogLevel, normalizeLogLevel } from '@/lib/log'
import { MAX_LOG_ENTRY_BYTES, serializeLogEntry } from '@/lib/log/entry'

const DEFAULT_RETENTION_DAYS = 14
const DEFAULT_HYDRATE_LIMIT = 2000
const MAX_HYDRATE_BYTES = 4 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024
const FLUSH_INTERVAL_MS = 100
const MAX_PENDING_BYTES = 64 * 1024
const MAX_QUEUED_BYTES = 1024 * 1024
const MAX_QUEUED_ENTRIES = 2000
const MAX_PENDING_FILES = 32
const DAY_MS = 24 * 60 * 60 * 1000
const LOG_FILE_NAME = /^(\d{4}-\d{2}-\d{2})(?:\.\d{13}-[a-f0-9-]+)?\.ndjson$/
const LEVEL_PRIORITY = { debug: 0, info: 1, ok: 1, warn: 2, fail: 3 } as const
const WRITER = Symbol.for('chaya.log-file-writer')
type PendingWrite = { lines: string[]; bytes: number }
type WriterState = { pending: Map<string, PendingWrite>; clears?: Set<string>; timer?: ReturnType<typeof setTimeout>; exitRegistered?: boolean; droppedEntries?: number }
const host = globalThis as typeof globalThis & { [WRITER]?: WriterState }
const writer: WriterState = (host[WRITER] ??= { pending: new Map() })
const pendingClears = (writer.clears ??= new Set<string>())

function pendingStats() {
  const batches = [...writer.pending.values()]
  return {
    sizeBytes: batches.reduce((sum, batch) => sum + batch.bytes, 0),
    entries: batches.reduce((sum, batch) => sum + batch.lines.length, 0),
    files: writer.pending.size,
    maxBytes: MAX_QUEUED_BYTES,
    maxEntries: MAX_QUEUED_ENTRIES,
    maxFiles: MAX_PENDING_FILES,
    droppedEntries: writer.droppedEntries ?? 0,
  }
}

/** Lock contention must not turn the write buffer into an unbounded retry queue. */
function trimPending() {
  let { sizeBytes, entries } = pendingStats()
  for (const [file, batch] of writer.pending) {
    while (batch.lines.length && (sizeBytes > MAX_QUEUED_BYTES || entries > MAX_QUEUED_ENTRIES || writer.pending.size > MAX_PENDING_FILES)) {
      const size = Buffer.byteLength(batch.lines.shift()!)
      batch.bytes -= size
      sizeBytes -= size
      entries--
      writer.droppedEntries = (writer.droppedEntries ?? 0) + 1
    }
    if (!batch.lines.length) writer.pending.delete(file)
    if (sizeBytes <= MAX_QUEUED_BYTES && entries <= MAX_QUEUED_ENTRIES && writer.pending.size <= MAX_PENDING_FILES) break
  }
}

function diskLogLevel(): LogLevel {
  const level = normalizeLogLevel(process.env.CHAYA_LOG_LEVEL?.trim() || 'info')
  return level === 'debug' ? 'info' : level
}

function filePolicy(logDir: string) {
  const slow = path.basename(path.resolve(logDir)) === 'slow-http'
  return {
    minimumLevel: diskLogLevel(),
    flushIntervalMs: FLUSH_INTERVAL_MS,
    maxEntryBytes: MAX_LOG_ENTRY_BYTES,
    maxPendingBytes: MAX_QUEUED_BYTES,
    maxPendingEntries: MAX_QUEUED_ENTRIES,
    maxPendingFiles: MAX_PENDING_FILES,
    maxFileBytes: (slow ? 4 : 32) * 1024 * 1024,
    maxTotalBytes: (slow ? 32 : 256) * 1024 * 1024,
    retentionDays: DEFAULT_RETENTION_DAYS,
    automaticCleanup: true,
    readWindowDays: DEFAULT_RETENTION_DAYS,
  }
}

function logFiles(logDir: string) {
  if (!fs.existsSync(logDir)) return []
  return fs
    .readdirSync(logDir)
    .filter((name) => LOG_FILE_NAME.test(name))
    .sort()
    .flatMap((name) => {
      try {
        const file = path.join(logDir, name)
        const stat = fs.statSync(file)
        return stat.isFile() ? [{ name, file, size: stat.size }] : []
      } catch {
        return []
      }
    })
}

/** A directory lock serializes rotation and pruning across the server and worker processes. */
function withDirectoryLock(logDir: string, run: () => void): boolean {
  fs.mkdirSync(logDir, { recursive: true })
  const lock = path.join(logDir, '.write-lock')
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number
    try {
      fd = fs.openSync(lock, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const owner = Number(fs.readFileSync(lock, 'utf8'))
        let stale = !owner && Date.now() - fs.statSync(lock).mtimeMs > 5000
        if (Number.isInteger(owner) && owner > 0) {
          try {
            process.kill(owner, 0)
          } catch (error) {
            stale = (error as NodeJS.ErrnoException).code === 'ESRCH'
          }
        }
        if (!stale) return false
        fs.unlinkSync(lock)
      } catch {
        // Another process may already have released the lock.
      }
      continue
    }
    try {
      fs.writeFileSync(fd, String(process.pid))
      run()
      return true
    } finally {
      fs.closeSync(fd)
      fs.unlinkSync(lock)
    }
  }
  return false
}

/** Migrate oversized legacy files using only a bounded tail, keeping recent non-debug records. */
function shrinkLegacyFile(file: string, maxBytes: number) {
  const fd = fs.openSync(file, 'r')
  let text: string
  try {
    const size = fs.fstatSync(fd).size
    const length = Math.min(size, maxBytes, MAX_HYDRATE_BYTES)
    const buffer = Buffer.alloc(length)
    const read = fs.readSync(fd, buffer, 0, length, size - length)
    const tail = buffer.subarray(0, read)
    const boundary = size > length ? tail.indexOf(10) : -1
    text = size > length ? (boundary < 0 ? '' : tail.subarray(boundary + 1).toString('utf8')) : tail.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
  const retained: string[] = []
  let bytes = 0
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines[i], file, i + 1)
    if (!entry || entry.level === 'debug' || entry.ts < Date.now() - DEFAULT_RETENTION_DAYS * DAY_MS) continue
    const line = serializeLogEntry(entry)
    bytes += Buffer.byteLength(line)
    if (bytes > maxBytes) break
    retained.push(line)
  }
  const temporary = `${file}.compact.tmp`
  try {
    fs.writeFileSync(temporary, retained.reverse().join(''), 'utf8')
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function pruneFiles(logDir: string) {
  const policy = filePolicy(logDir)
  const cutoff = dayKey(Date.now() - policy.retentionDays * DAY_MS)
  for (const file of logFiles(logDir)) {
    if (file.name.slice(0, 10) < cutoff) fs.unlinkSync(file.file)
    else if (file.size > policy.maxFileBytes) shrinkLegacyFile(file.file, policy.maxFileBytes)
  }
  const files = logFiles(logDir)
  let total = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files) {
    if (total <= policy.maxTotalBytes) break
    fs.unlinkSync(file.file)
    total -= file.size
  }
}

function writeBatch(file: string, batch: PendingWrite): boolean {
  const logDir = path.dirname(file)
  return withDirectoryLock(logDir, () => {
    pruneFiles(logDir)
    const { maxFileBytes } = filePolicy(logDir)
    let size = fs.existsSync(file) ? fs.statSync(file).size : 0
    let lines: string[] = []
    let bytes = 0
    const append = () => {
      if (!lines.length) return
      if (size && size + bytes > maxFileBytes) {
        fs.renameSync(file, path.join(logDir, `${path.basename(file, '.ndjson')}.${Date.now()}-${randomUUID()}.ndjson`))
        size = 0
      }
      fs.appendFileSync(file, lines.join(''), 'utf8')
      size += bytes
      lines = []
      bytes = 0
    }
    for (const line of batch.lines) {
      const length = Buffer.byteLength(line)
      if (bytes + length > maxFileBytes) append()
      lines.push(line)
      bytes += length
    }
    append()
    pruneFiles(logDir)
  })
}

function scheduleFlush() {
  if ((!writer.pending.size && !pendingClears.size) || writer.timer) return
  writer.timer = setTimeout(() => {
    writer.timer = undefined
    flushLogFiles()
  }, FLUSH_INTERVAL_MS)
  writer.timer.unref?.()
}

/** Flush bounded batches; reads and graceful exit also flush pending records. */
export function flushLogFiles(logDir?: string): void {
  for (const dir of pendingClears) {
    if (logDir && dir !== path.resolve(logDir)) continue
    try {
      if (
        !withDirectoryLock(dir, () => {
          for (const name of fs.readdirSync(dir)) {
            if (name.endsWith('.ndjson')) fs.unlinkSync(path.join(dir, name))
          }
        })
      )
        continue
    } catch {
      // Persistence failures must not interrupt API responses.
    }
    pendingClears.delete(dir)
  }
  for (const [file, batch] of writer.pending) {
    if (logDir && path.dirname(file) !== path.resolve(logDir)) continue
    if (pendingClears.has(path.dirname(file))) continue
    try {
      if (!writeBatch(file, batch)) continue
    } catch {
      // Persistence failures must not interrupt API responses.
    }
    writer.pending.delete(file)
  }
  if (!writer.pending.size && !pendingClears.size && writer.timer) {
    clearTimeout(writer.timer)
    writer.timer = undefined
  }
  scheduleFlush()
}

export function resolvePluginLogDir(): string {
  const fromEnv = process.env.CHAYA_LOG_DIR
  if (fromEnv && fromEnv.trim()) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(ROOT_PATH, fromEnv)
  }
  return PLUGIN_LOGS_DIR
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function dayFile(dir: string, day: string): string {
  return path.join(dir, `${day}.ndjson`)
}

export function appendLogToFile(entry: LogEntry, logDir = resolvePluginLogDir(), options: { force?: boolean } = {}): void {
  if (entry.level === 'debug') return
  if (!options.force && LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[diskLogLevel()]) return
  try {
    const file = path.resolve(dayFile(logDir, dayKey(entry.ts)))
    const line = serializeLogEntry(entry)
    const batch = writer.pending.get(file) ?? { lines: [], bytes: 0 }
    batch.lines.push(line)
    batch.bytes += Buffer.byteLength(line)
    writer.pending.set(file, batch)
    trimPending()
    if (!writer.exitRegistered) {
      process.once('exit', () => flushLogFiles())
      writer.exitRegistered = true
    }
    if (batch.bytes >= MAX_PENDING_BYTES) flushLogFiles(logDir)
    scheduleFlush()
  } catch {
    // Persistence failures must not interrupt API responses.
  }
}

function parseLine(line: string, file: string, lineNo: number | string): LogEntry | null {
  const raw = line.trim()
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<LogEntry> & { createdAt?: string }
    const ts = typeof o.ts === 'number' ? o.ts : o.createdAt ? Date.parse(o.createdAt) : Date.now()
    if (!o.source || o.message == null) return null
    return {
      id: String(o.id || `${path.basename(file)}:${lineNo}`),
      ts: Number.isFinite(ts) ? ts : Date.now(),
      level: normalizeLogLevel(o.level),
      source: String(o.source).slice(0, 64),
      message: String(o.message).slice(0, 8000),
      meta: o.meta,
    }
  } catch {
    return null
  }
}

/** Read newest records first with a shared byte budget; startup must not scan multi-GB logs. */
export function loadLogsFromFiles(opts?: { logDir?: string; retentionDays?: number; limit?: number }): LogEntry[] {
  const logDir = opts?.logDir ?? resolvePluginLogDir()
  const retentionDays = opts?.retentionDays ?? DEFAULT_RETENTION_DAYS
  const limit = opts?.limit ?? DEFAULT_HYDRATE_LIMIT
  if (limit <= 0) return []

  flushLogFiles(logDir)
  if (pendingClears.has(path.resolve(logDir))) return []
  if (!fs.existsSync(logDir)) return []

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const files = fs
    .readdirSync(logDir)
    .filter((n) => LOG_FILE_NAME.test(n))
    .sort()
    .reverse()

  const out: LogEntry[] = []
  let remainingBytes = MAX_HYDRATE_BYTES
  for (const name of files) {
    if (out.length >= limit || remainingBytes <= 0) break
    const day = name.slice(0, 10)
    const dayTs = Date.parse(`${day}T00:00:00.000Z`)
    if (Number.isFinite(dayTs) && dayTs < cutoff - 24 * 60 * 60 * 1000) {
      continue
    }
    const full = path.join(logDir, name)
    let fd: number | undefined
    try {
      fd = fs.openSync(full, 'r')
      let position = fs.fstatSync(fd).size
      let pending: Buffer = Buffer.alloc(0)
      while (position > 0 && remainingBytes > 0 && out.length < limit) {
        const size = Math.min(READ_CHUNK_BYTES, position, remainingBytes)
        position -= size
        remainingBytes -= size
        const chunk = Buffer.allocUnsafe(size)
        const read = fs.readSync(fd, chunk, 0, size, position)
        if (read !== size) break
        const data = Buffer.concat([chunk, pending])
        let end = data.length
        for (let i = data.length - 1; i >= 0 && out.length < limit; i--) {
          if (data[i] !== 10) continue
          const entry = parseLine(data.subarray(i + 1, end).toString('utf8'), full, `byte-${position + i + 1}`)
          if (entry && entry.ts >= cutoff) out.push(entry)
          end = i
        }
        pending = data.subarray(0, end)
      }
      if (position === 0 && out.length < limit) {
        const entry = parseLine(pending.toString('utf8'), full, 1)
        if (entry && entry.ts >= cutoff) out.push(entry)
      }
    } catch {
      // A rotated or unreadable file must not prevent reading the remaining days.
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }

  out.reverse().sort((a, b) => a.ts - b.ts)
  return out.length > limit ? out.slice(-limit) : out
}

/** Delete NDJSON files when clearing the log view. */
export function clearLogFiles(logDir = resolvePluginLogDir()): void {
  // Discard queued writes so cleared records cannot reappear on the next flush.
  for (const file of writer.pending.keys()) {
    if (path.dirname(file) === path.resolve(logDir)) writer.pending.delete(file)
  }
  if (fs.existsSync(logDir)) {
    if (pendingClears.size >= MAX_PENDING_FILES) pendingClears.delete(pendingClears.values().next().value!)
    pendingClears.add(path.resolve(logDir))
  }
  flushLogFiles(logDir)
}

export function pluginLogFileStats(logDir = resolvePluginLogDir()) {
  const policy = filePolicy(logDir)
  flushLogFiles(logDir)
  if (fs.existsSync(logDir)) {
    try {
      withDirectoryLock(logDir, () => pruneFiles(logDir))
    } catch {
      // Unavailable storage must not break the log view.
    }
  }
  if (!fs.existsSync(logDir)) {
    return { dir: logDir, files: 0, sizeBytes: 0, policy, pending: pendingStats() }
  }
  let files = 0
  let sizeBytes = 0
  for (const name of fs.readdirSync(logDir)) {
    if (!name.endsWith('.ndjson')) continue
    files += 1
    try {
      sizeBytes += fs.statSync(path.join(logDir, name)).size
    } catch {
      /* */
    }
  }
  return { dir: logDir, files, sizeBytes, policy, pending: pendingStats() }
}
