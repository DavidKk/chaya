import { compactLogEntry, logEntryBytes, MAX_LOG_ENTRY_BYTES } from './entry'
import type { LogEntry } from './types'

/** Keep the newest entries within both a record limit and a serialized payload budget. */
export class LogBuffer {
  private rows: LogEntry[] = []
  private sizes: number[] = []
  private bytes = 0
  private dropped = 0

  constructor(
    readonly capacity = 2000,
    readonly maxBytes = 8 * 1024 * 1024
  ) {}

  append(raw: LogEntry): LogEntry {
    const entry = compactLogEntry(raw)
    const size = logEntryBytes(entry)
    this.rows.push(entry)
    this.sizes.push(size)
    this.bytes += size
    while (this.rows.length > this.capacity || this.bytes > this.maxBytes) {
      this.rows.shift()
      this.bytes -= this.sizes.shift()!
      this.dropped++
    }
    return entry
  }

  list(): readonly LogEntry[] {
    return this.rows
  }

  clear() {
    this.rows = []
    this.sizes = []
    this.bytes = 0
    this.dropped = 0
  }

  stats() {
    return { sizeBytes: this.bytes, maxBytes: this.maxBytes, maxEntryBytes: MAX_LOG_ENTRY_BYTES, droppedEntries: this.dropped }
  }
}
