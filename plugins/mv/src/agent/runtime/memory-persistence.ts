/**
 * Plugin-side companion memory persistence adapter.
 * All hosting modes use the local storage daemon.
 */

import type { MemoryManagementState } from '@/lib/game-agent/companion/core/recording-types'
import { CompanionRecordingWriter } from '@/lib/game-agent/companion/core/recording-writer'
import { bindWriteBatchToGame } from '@/lib/game-agent/companion/memory-durable'
import { type CompanionMemoryPersistence, createCompanionMemoryPersistence, createGameplayMemoryStoreWithPersistence } from '@/lib/game-agent/companion/memory-persistence'
import { createGameplayMemoryStore, type GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { MemoryStoreSnapshot } from '@/lib/game-agent/companion/memory-types'

import { detectGameIdentity } from '../../helpers/game/game-identity'
import { pluginStorageCall } from '../../helpers/storage/client'
import { flushPendingStorage, queueStorageMutation } from '../../helpers/storage/pending'
import { createMemorySynchronization } from './memory-sync'

function cloudRuntime() {
  return typeof window !== 'undefined' && Boolean((window as Window & { CHAYA_LINK_TOKEN?: string }).CHAYA_LINK_TOKEN)
}

export type CompanionMemoryRuntime = {
  store: GameplayMemoryStore
  persistence: CompanionMemoryPersistence
  recording: CompanionRecordingWriter
  ready(): Promise<void>
  flush(): Promise<void>
  synchronize(): Promise<void>
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
      if (batch.battleRecording) {
        // This queue removes evidence only after a durable service acknowledgement.
        await pluginStorageCall('companion.commit', [gameId, bindWriteBatchToGame(batch, gameId), root])
        return
      }
      await queueStorageMutation(root, 'companion.commit', [gameId, bindWriteBatchToGame(batch, gameId), root])
    },
    async manage(request) {
      if (!root) throw new Error('Cannot manage memory without a verified local game root')
      return pluginStorageCall('companion.manage', [gameId, request, root])
    },
    async clearQueueBarrier(memoryEpoch, recordingRevision, clear) {
      await this.manage!({
        requestId: `barrier-${memoryEpoch}-${recordingRevision}`,
        action: 'clear',
        expectedMemoryEpoch: memoryEpoch - 1,
        expectedRecordingRevision: recordingRevision,
        preferences: clear?.preferences === true,
        episodes: clear?.episodes !== false,
      })
    },
  }
  const store = createGameplayMemoryStore({ backend: persistence })
  const recording = new CompanionRecordingWriter({
    loadSnapshot: () => persistence.loadSnapshot(),
    commitBatch: async (batch) => {
      await persistence.commitBatch(batch)
      await store.ready()
      store.acceptCommittedRecording(batch)
    },
  })
  const ready = async () => {
    await Promise.all([store.ready(), recording.ready()])
  }
  const sync = createMemorySynchronization({
    ready,
    state: async () => {
      if (!root) throw new Error('Cannot synchronize memory without a verified local game root')
      return pluginStorageCall<MemoryManagementState>('companion.state', [gameId, null, root])
    },
    storeState: () => ({ memoryEpoch: store.getEpoch(), recordingRevision: store.getRecordingRevision(), recordingEnabled: store.isRecordingEnabled() }),
    recordingState: () => recording.getStatus().versions,
    recordingNeedsRecovery: () => recording.getStatus().persistence === 'degraded',
    synchronizeStore: () => store.synchronize(),
    synchronizeRecording: () => recording.synchronize(),
  })
  return {
    store,
    persistence,
    recording,
    ready,
    synchronize: sync.synchronize,
    flush: async () => {
      await Promise.all([store.flush(), recording.flush()])
    },
    close: async () => {
      await sync.close()
      await Promise.all([store.close(), recording.close()])
    },
  }
}

export { createCompanionMemoryPersistence, createGameplayMemoryStoreWithPersistence }
