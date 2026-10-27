import { estimateRecordBytes, MEMORY_PENDING_QUEUE_MAX, MEMORY_PENDING_QUEUE_MAX_BYTES } from '../memory-limits'
import { MEMORY_SCHEMA_VERSION, type MemoryBackend, type MemoryWriteBatch } from '../memory-types'
import { validateBattleRecord } from './recording-schema'
import type { BattleRecordEvent, MemoryManagementState } from './recording-types'

type RecordingBackend = Pick<MemoryBackend, 'loadSnapshot' | 'commitBatch'>
export type RecordingWriterStatus = {
  persistence: 'loading' | 'ready' | 'degraded' | 'closed'
  pending: number
  dropped: number
  versions: MemoryManagementState | null
  error?: string
}

/** The execution loop only enqueues. Transport, retries and barriers run asynchronously. */
export class CompanionRecordingWriter {
  private events: BattleRecordEvent[] = []
  private bytes = 0
  private batch?: MemoryWriteBatch
  private versions: MemoryManagementState | null = null
  private persistence: RecordingWriterStatus['persistence'] = 'loading'
  private dropped = 0
  private error?: string
  private timer?: ReturnType<typeof setTimeout>
  private operation?: Promise<void>
  private syncing?: Promise<void>
  private closed = false
  private closing = false
  private failures = 0
  private sequence = 0
  private readonly writerId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  private readonly initial: Promise<void>

  constructor(private readonly backend: RecordingBackend) {
    // No retroactive recording of events observed before management state was loaded.
    this.initial = this.synchronize().catch(() => undefined)
  }

  ready(): Promise<void> {
    return this.initial
  }

  getStatus(): RecordingWriterStatus {
    return { persistence: this.persistence, pending: this.events.length, dropped: this.dropped, versions: this.versions ? { ...this.versions } : null, error: this.error }
  }

  enqueue(raw: BattleRecordEvent): boolean {
    if (this.closed || this.closing || !this.versions?.recordingEnabled || this.syncing) return false
    const event = validateBattleRecord(raw)
    const bytes = estimateRecordBytes(event)
    if (this.events.length >= MEMORY_PENDING_QUEUE_MAX || this.bytes + bytes > MEMORY_PENDING_QUEUE_MAX_BYTES) {
      this.dropped++
      this.error = 'Recording queue full; evidence gap'
      return false
    }
    this.events.push(event)
    this.bytes += bytes
    if (this.failures <= 3) this.schedule(this.failures ? 1000 * this.failures : 200)
    return true
  }

  /** Invoke on a management notification or reconnect; pending events keep their original versions. */
  synchronize(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.syncing) return this.syncing
    this.cancelTimer()
    const operation = (async () => {
      await this.operation?.catch(() => undefined)
      const snapshot = await this.backend.loadSnapshot()
      if (!snapshot) throw new Error('Recording management state unavailable')
      if (
        this.versions &&
        (snapshot.memoryEpoch !== this.versions.memoryEpoch ||
          snapshot.recordingRevision !== this.versions.recordingRevision ||
          snapshot.recordingEnabled !== this.versions.recordingEnabled)
      ) {
        this.dropped += this.events.length
        this.events = []
        this.bytes = 0
        this.batch = undefined
      }
      this.versions = { memoryEpoch: snapshot.memoryEpoch, recordingRevision: snapshot.recordingRevision, recordingEnabled: snapshot.recordingEnabled }
      this.persistence = 'ready'
      this.error = undefined
      this.failures = 0
    })()
    const tracked = operation
      .catch((error: unknown) => {
        this.persistence = 'degraded'
        this.error = error instanceof Error ? error.message : 'Recording state unavailable'
        throw error
      })
      .finally(() => {
        this.syncing = undefined
        if (this.events.length && this.persistence === 'ready') this.schedule(200)
      })
    this.syncing = tracked
    return tracked
  }

  flush(): Promise<void> {
    if (this.operation) return this.operation
    if (this.closed) return Promise.resolve()
    this.cancelTimer()
    const operation = (async () => {
      if (this.syncing) await this.syncing
      if (!this.versions) throw new Error('Recording management state unavailable')
      while (this.events.length && this.versions.recordingEnabled) {
        const batch = this.batch || this.makeBatch()
        this.batch = batch
        try {
          await this.backend.commitBatch(batch)
        } catch (error) {
          // A remote barrier can arrive even when its broadcast was missed.
          const current = await this.backend.loadSnapshot().catch(() => null)
          if (current && (current.memoryEpoch !== batch.memoryEpoch || current.recordingRevision !== batch.recordingRevision || !current.recordingEnabled)) {
            this.dropped += this.events.length
            this.events = []
            this.bytes = 0
            this.batch = undefined
            this.versions = { memoryEpoch: current.memoryEpoch, recordingRevision: current.recordingRevision, recordingEnabled: current.recordingEnabled }
          }
          throw error
        }
        const count = batch.battleRecording!.events.length
        this.events.splice(0, count)
        this.bytes = this.events.reduce((sum, event) => sum + estimateRecordBytes(event), 0)
        this.batch = undefined
      }
      this.failures = 0
      this.persistence = 'ready'
      this.error = undefined
    })()
    const tracked = operation
      .catch((error: unknown) => {
        this.persistence = 'degraded'
        this.error = error instanceof Error ? error.message : 'Recording flush failed'
        this.failures++
        if (this.events.length && this.failures <= 3) this.schedule(1000 * this.failures)
        throw error
      })
      .finally(() => {
        this.operation = undefined
      })
    this.operation = tracked
    return tracked
  }

  async close(): Promise<void> {
    this.closing = true
    this.cancelTimer()
    try {
      await this.flush()
    } finally {
      this.closed = true
      this.cancelTimer()
      this.persistence = 'closed'
    }
  }

  private makeBatch(): MemoryWriteBatch {
    return {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      batchId: `battle-${this.writerId}-${++this.sequence}`,
      memoryEpoch: this.versions!.memoryEpoch,
      recordingRevision: this.versions!.recordingRevision,
      at: Date.now(),
      battleRecording: { schemaVersion: 1, events: this.events.slice(0, 128) },
    }
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule(delay: number): void {
    if (this.timer || this.closed || this.closing) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush().catch(() => undefined)
    }, delay)
  }
}
