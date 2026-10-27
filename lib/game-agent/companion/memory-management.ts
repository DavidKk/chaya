import { recordingFingerprint } from './core/recording-schema'
import type { MemoryManagementRequest } from './core/recording-types'
import { MemoryPersistenceError } from './memory-errors'

export type ManagementAction = { action: 'clear'; preferences?: boolean } | { action: 'set_recording'; enabled: boolean }

/** Keeps ambiguous retries on the original CAS request; a new operation cannot silently replace one. */
export class MemoryManagementSession {
  blocked = false
  private active = false
  private pending?: MemoryManagementRequest
  private requests = new Map<string, MemoryManagementRequest>()

  block(): void {
    if (this.active) throw new MemoryPersistenceError('Memory management is in progress')
    this.blocked = true
  }

  synchronized(): void {
    this.pending = undefined
    this.blocked = false
  }

  async run(
    action: ManagementAction,
    versions: { memoryEpoch: number; recordingRevision: number },
    requestId: string | undefined,
    execute: (request: MemoryManagementRequest) => Promise<void>
  ): Promise<void> {
    if (this.active) throw new MemoryPersistenceError('Memory management is in progress')
    const request = this.pending ||
      (requestId ? this.requests.get(requestId) : undefined) || {
        ...action,
        requestId: requestId || `manage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        expectedMemoryEpoch: versions.memoryEpoch,
        expectedRecordingRevision: versions.recordingRevision,
      }
    const { requestId: savedId, expectedMemoryEpoch: _epoch, expectedRecordingRevision: _revision, ...savedAction } = request
    if ((requestId && requestId !== savedId) || recordingFingerprint(savedAction) !== recordingFingerprint(action) || (this.blocked && !this.pending)) {
      throw new MemoryPersistenceError('Retry pending memory management or synchronize first')
    }
    this.pending = request
    this.requests.set(request.requestId, request)
    if (this.requests.size > 64) this.requests.delete(this.requests.keys().next().value!)
    this.active = true
    this.blocked = true
    try {
      await execute(request)
      this.synchronized()
    } finally {
      this.active = false
    }
  }
}
