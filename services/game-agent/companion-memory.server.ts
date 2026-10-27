import type { MemoryManagementRequest, MemoryManagementState } from '@/lib/game-agent/companion/core/recording-types'
import { bindWriteBatchToGame } from '@/lib/game-agent/companion/memory-durable'
import type { MemoryBackend, MemoryStoreSnapshot, MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import { storageCall } from '@/services/storage/client'

/** One durable backend per library game. runtimeInstanceId is writer identity only. */
const backends = new Map<string, MemoryBackend>()

function backendFor(gameId: string): MemoryBackend {
  const existing = backends.get(gameId)
  if (existing) return existing
  const created: MemoryBackend = {
    async ready() {
      storageCall('companion.load', [gameId])
    },
    async flush() {},
    async loadSnapshot() {
      return storageCall<MemoryStoreSnapshot>('companion.load', [gameId])
    },
    async commitBatch(batch) {
      storageCall('companion.commit', [gameId, bindWriteBatchToGame(batch, gameId)])
    },
    async manage(request) {
      return storageCall<MemoryManagementState>('companion.manage', [gameId, request])
    },
    async clearQueueBarrier(memoryEpoch, recordingRevision, clear) {
      await this.manage!({
        action: 'clear',
        requestId: `barrier-${memoryEpoch}-${recordingRevision}`,
        expectedMemoryEpoch: memoryEpoch - 1,
        expectedRecordingRevision: recordingRevision,
        preferences: clear?.preferences === true,
        episodes: clear?.episodes !== false,
      })
    },
  }
  backends.set(gameId, created)
  return created
}

export async function getCompanionMemorySnapshot(gameId: string, _runtimeInstanceId?: string): Promise<MemoryStoreSnapshot | null> {
  const backend = backendFor(gameId)
  await backend.ready()
  return backend.loadSnapshot()
}

export async function commitCompanionMemoryBatch(gameId: string, batch: MemoryWriteBatch, _runtimeInstanceId?: string): Promise<void> {
  const backend = backendFor(gameId)
  await backend.ready()
  await backend.commitBatch(bindWriteBatchToGame(batch, gameId))
}

export async function manageCompanionMemory(gameId: string, request: MemoryManagementRequest): Promise<MemoryManagementState> {
  return backendFor(gameId).manage!(request)
}

export async function barrierCompanionMemory(
  gameId: string,
  memoryEpoch: number,
  recordingRevision: number,
  _runtimeInstanceId?: string,
  clear?: { libraryGameId?: string; preferences?: boolean; episodes?: boolean }
): Promise<void> {
  const backend = backendFor(gameId)
  await backend.ready()
  await backend.manage!({
    requestId: `barrier-${memoryEpoch}-${recordingRevision}`,
    action: 'clear',
    expectedMemoryEpoch: memoryEpoch - 1,
    expectedRecordingRevision: recordingRevision,
    preferences: clear?.preferences === true,
    episodes: clear?.episodes !== false,
  })
}

export async function flushCompanionMemory(gameId: string, _runtimeInstanceId?: string): Promise<void> {
  const backend = backendFor(gameId)
  await backend.flush()
}
