/**
 * Plugin-side companion memory persistence adapter.
 * All hosting modes use the local storage daemon.
 */

import { bindWriteBatchToGame } from '@/lib/game-agent/companion/memory-durable'
import { type CompanionMemoryPersistence, createCompanionMemoryPersistence, createGameplayMemoryStoreWithPersistence } from '@/lib/game-agent/companion/memory-persistence'
import { createGameplayMemoryStore, type GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import { MEMORY_SCHEMA_VERSION, type MemoryStoreSnapshot } from '@/lib/game-agent/companion/memory-types'

import { detectGameIdentity } from '../../helpers/game/game-identity'
import { pluginStorageCall } from '../../helpers/storage/client'
import { flushPendingStorage, queueStorageMutation } from '../../helpers/storage/pending'

function cloudRuntime() {
  return typeof window !== 'undefined' && Boolean((window as Window & { CHAYA_LINK_TOKEN?: string }).CHAYA_LINK_TOKEN)
}

export type CompanionMemoryRuntime = {
  store: GameplayMemoryStore
  persistence: CompanionMemoryPersistence
  ready(): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

/**
 * Build the memory runtime used by companion-host.
 * Does not use localStorage for episodes.
 */
export function createCompanionMemoryRuntime(gameId: string, runtimeInstanceId?: string, _cloud = cloudRuntime()): CompanionMemoryRuntime {
  const root = detectGameIdentity()?.contentRoot
  const persistence: CompanionMemoryPersistence = {
    kind: 'service',
    gameId,
    runtimeInstanceId,
    async ready() {
      if (!root) throw new Error('Cannot persist memory without a verified local game root')
      await pluginStorageCall('companion.load', [gameId, null, root])
    },
    async flush() {
      if (root) await flushPendingStorage(root)
    },
    async loadSnapshot() {
      if (!root) throw new Error('Cannot persist memory without a verified local game root')
      return pluginStorageCall<MemoryStoreSnapshot>('companion.load', [gameId, null, root])
    },
    async commitBatch(batch) {
      if (!root) throw new Error('Cannot persist memory without a verified local game root')
      await queueStorageMutation(root, 'companion.commit', [gameId, bindWriteBatchToGame(batch, gameId), root])
    },
    async clearQueueBarrier(memoryEpoch, recordingRevision, clear) {
      await this.commitBatch({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        batchId: `barrier-${memoryEpoch}-${recordingRevision}`,
        memoryEpoch,
        recordingRevision,
        at: Date.now(),
        clear: { libraryGameId: clear?.libraryGameId || gameId, preferences: clear?.preferences === true, episodes: clear?.episodes !== false },
      })
    },
  }
  const store = createGameplayMemoryStore({ backend: persistence })
  return {
    store,
    persistence,
    ready: () => store.ready(),
    flush: () => store.flush(),
    close: () => store.close(),
  }
}

export { createCompanionMemoryPersistence, createGameplayMemoryStoreWithPersistence }
