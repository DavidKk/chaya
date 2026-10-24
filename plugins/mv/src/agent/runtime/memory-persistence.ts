/**
 * Plugin-side companion memory persistence adapter.
 * Cloud → IndexedDB; local launch → /api/game-agent/memory.
 */

import { type CompanionMemoryPersistence, createCompanionMemoryPersistence, createGameplayMemoryStoreWithPersistence } from '@/lib/game-agent/companion/memory-persistence'
import { createGameplayMemoryStore, type GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'

import { chayaFetch } from '../../helpers'

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
export function createCompanionMemoryRuntime(gameId: string, runtimeInstanceId?: string, cloud = cloudRuntime()): CompanionMemoryRuntime {
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => chayaFetch(String(input), init)) as typeof fetch
  const persistence = createCompanionMemoryPersistence(gameId, runtimeInstanceId, { cloud, fetchImpl })
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
