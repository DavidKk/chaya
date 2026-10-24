import { bindWriteBatchToGame } from '@/lib/game-agent/companion/memory-durable'
import type { MemoryBackend, MemoryStoreSnapshot, MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import { createCompanionMemoryFileBackend } from '@/services/game-agent/companion-memory-file-store.server'

/** One durable backend per library game. runtimeInstanceId is writer identity only. */
const backends = new Map<string, MemoryBackend>()

function backendFor(gameId: string): MemoryBackend {
  const existing = backends.get(gameId)
  if (existing) return existing
  const created = createCompanionMemoryFileBackend({ libraryGameId: gameId })
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

export async function barrierCompanionMemory(
  gameId: string,
  memoryEpoch: number,
  recordingRevision: number,
  _runtimeInstanceId?: string,
  clear?: { libraryGameId?: string; preferences?: boolean; episodes?: boolean }
): Promise<void> {
  const backend = backendFor(gameId)
  await backend.ready()
  await backend.clearQueueBarrier(memoryEpoch, recordingRevision, {
    libraryGameId: clear?.libraryGameId || gameId,
    preferences: clear?.preferences === true,
    episodes: clear?.episodes !== false,
  })
}

export async function flushCompanionMemory(gameId: string, _runtimeInstanceId?: string): Promise<void> {
  const backend = backendFor(gameId)
  await backend.flush()
}
