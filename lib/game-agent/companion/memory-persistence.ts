/**
 * Persistence factory for companion memory.
 * Browser → local service adapter; Node-only callers use temporary memory.
 */

import { applyWriteBatch, emptyMemorySnapshot } from './memory-durable'
import { createGameplayMemoryStore } from './memory-store'
import { MEMORY_SCHEMA_VERSION, type MemoryBackend, type MemoryStoreSnapshot, type MemoryWriteBatch } from './memory-types'

export type CompanionMemoryPersistence = MemoryBackend & {
  kind: 'browser' | 'service' | 'memory'
  gameId: string
  runtimeInstanceId?: string
}

function serviceBase(gameId: string, runtimeInstanceId?: string) {
  // runtimeInstanceId is writer identity for the request only; durable rows stay game-scoped.
  const search = new URLSearchParams({ gameId, ...(runtimeInstanceId ? { runtimeInstanceId } : {}) })
  return `/api/game-agent/memory?${search}`
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(body.error?.message || `Companion memory request failed: HTTP ${response.status}`)
  return body
}

function createServiceBackend(gameId: string, runtimeInstanceId: string | undefined, fetchImpl: typeof fetch): MemoryBackend {
  let queue = Promise.resolve()
  const endpoint = serviceBase(gameId, runtimeInstanceId)
  return {
    async ready() {
      await json(await fetchImpl(endpoint, { method: 'GET', cache: 'no-store' }))
    },
    async flush() {
      await queue
      await json(await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'flush' }) }))
    },
    async loadSnapshot() {
      const body = await json<{ snapshot?: MemoryStoreSnapshot | null }>(await fetchImpl(endpoint, { method: 'GET', cache: 'no-store' }))
      return body.snapshot || null
    },
    async commitBatch(batch: MemoryWriteBatch) {
      const operation = queue.then(async () => {
        await json(
          await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'commit', batch }),
          })
        )
      })
      queue = operation.catch(() => undefined)
      await operation
    },
    async clearQueueBarrier(memoryEpoch, recordingRevision, clear) {
      const operation = queue.then(async () => {
        await json(
          await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'barrier', memoryEpoch, recordingRevision, clear }),
          })
        )
      })
      queue = operation.catch(() => undefined)
      await operation
    },
  }
}

function createMemoryOnlyBackend(gameId?: string): MemoryBackend {
  let snapshot: MemoryStoreSnapshot | null = null
  return {
    async ready() {},
    async flush() {},
    async loadSnapshot() {
      return snapshot
    },
    async commitBatch(batch) {
      snapshot = applyWriteBatch(snapshot || emptyMemorySnapshot(), batch, { boundGameId: gameId, onConflict: 'throw' })
    },
    async clearQueueBarrier(memoryEpoch, recordingRevision, clear) {
      await this.commitBatch({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        batchId: `barrier-${memoryEpoch}-${recordingRevision}`,
        memoryEpoch,
        recordingRevision,
        at: Date.now(),
        clear: {
          libraryGameId: clear?.libraryGameId || gameId,
          preferences: clear?.preferences === true,
          episodes: clear?.episodes !== false,
        },
      })
    },
  }
}

/**
 * Create the host persistence adapter for a game runtime.
 * - Linked browser games use their injected local transport; no asset IndexedDB.
 * - Locally launched games in a page: existing local service HTTP endpoint
 * - Pure Node callers without window: in-memory fallback (tests / temporary)
 */
export function createCompanionMemoryPersistence(gameId: string, runtimeInstanceId?: string, options?: { cloud?: boolean; fetchImpl?: typeof fetch }): CompanionMemoryPersistence {
  if (typeof window !== 'undefined') {
    const fetchImpl = options?.fetchImpl || fetch.bind(globalThis)
    return { kind: 'service', gameId, runtimeInstanceId, ...createServiceBackend(gameId, runtimeInstanceId, fetchImpl) }
  }
  return { kind: 'memory', gameId, runtimeInstanceId, ...createMemoryOnlyBackend(gameId) }
}

export function createGameplayMemoryStoreWithPersistence(
  gameId: string,
  runtimeInstanceId?: string,
  options?: { cloud?: boolean; fetchImpl?: typeof fetch; maxEpisodes?: number }
) {
  const backend = createCompanionMemoryPersistence(gameId, runtimeInstanceId, options)
  return createGameplayMemoryStore({ backend, maxEpisodes: options?.maxEpisodes })
}
