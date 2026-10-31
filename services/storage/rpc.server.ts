import path from 'node:path'

import type { SourceGameEvent } from '@/lib/game-agent/audit'
import type { MemoryManagementRequest } from '@/lib/game-agent/companion/core/recording-types'
import { bindWriteBatchToGame } from '@/lib/game-agent/companion/memory-durable'
import type { MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import type { AgentSyncDocument } from '@/lib/game-agent/settings-sync'
import { agentSettingsFromSyncDocument } from '@/lib/game-agent/settings-sync'
import { createAgentTraceFileStore } from '@/services/game-agent/activity-file-store.server'
import type { CompanionDb } from '@/services/game-agent/companion-memory-db'
import {
  loadOwnedGameAgentSettings,
  loadOwnedGameAgentSyncDocument,
  mergeOwnedGameAgentSyncDocument,
  saveOwnedGameAgentSettings,
  saveOwnedGameAgentSyncDocument,
  updateOwnedGameAgentSyncFromSettings,
} from '@/services/game-agent/settings'
import { startOperation } from '@/services/log/operation'
import { openOwnedSharedCache } from '@/services/translate/shared-cache'
import type { SharedCacheDb } from '@/services/translate/shared-cache/db'
import { waitSharedCacheHeavyMigrate } from '@/services/translate/shared-cache/migrate-bg'

import { createCompanionSqliteStore } from './companion-store'
import { createPublicConfigurationStore } from './configuration.server'
import { storageLibraryEntries } from './game-library'
import { createPublicGameStore } from './game-store'
import { importLegacyAgentSettings } from './migration/agent-settings'
import { migrateCompanionMemory } from './migration/companion-migrator.server'
import { createTranslationObservationStore } from './translation-observation-store'
import { createTranslationResourceStore } from './translation-resource-store'
import { commitTranslations, type TranslationCommitInput } from './translation-store'

export function createStorageRpc(shared: SharedCacheDb, companion: CompanionDb, dataDir: string) {
  const games = createPublicGameStore(shared, dataDir)
  const configuration = createPublicConfigurationStore(dataDir)
  const memory = createCompanionSqliteStore(companion)
  const traces = createAgentTraceFileStore()
  let migration: Promise<unknown> | undefined
  let cache: ReturnType<typeof openOwnedSharedCache> | undefined
  let resources: ReturnType<typeof createTranslationResourceStore> | undefined
  let observations: ReturnType<typeof createTranslationObservationStore> | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const refreshRoots = new Set<string>()
  let refreshAll = false
  async function refreshGameCaches(complete = false) {
    const timing = startOperation('storage', 'storage.cache-projections', { complete }, { start: false })
    try {
      cache ??= openOwnedSharedCache(path.join(dataDir, 'translate-cache/shared.sqlite'))
      const roots = refreshAll ? new Set([...cache.gameCacheRoots(), ...refreshRoots]) : new Set(refreshRoots)
      refreshAll = false
      refreshRoots.clear()
      for (const root of roots) {
        await games.mount(root)
        if (cache.flushBackfill(root, { projectionBudgetMs: complete ? Infinity : 25 }).pending) refreshRoots.add(root)
      }
      if (refreshRoots.size) scheduleGameCacheRefresh(refreshRoots.values().next().value!)
      timing.end('completed', { roots: roots.size, pendingRoots: refreshRoots.size })
    } catch (error) {
      timing.fail(error)
      throw error
    }
  }
  function scheduleGameCacheRefresh(root?: string) {
    if (root) refreshRoots.add(root)
    else refreshAll = true
    if (refreshTimer) return
    // Bound each projection slice so engine reads and writes can run between refreshes.
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
      queue = queue.then(() => refreshGameCaches()).catch((error) => process.emitWarning(String(error), { code: 'CHAYA_GAME_CACHE_REFRESH' }))
    }, 100)
    refreshTimer.unref()
  }
  const settingsFile = path.join(dataDir, 'game-agent/settings.json')
  const syncFile = path.join(dataDir, 'game-agent/settings.sync.json')
  importLegacyAgentSettings(dataDir)
  function library() {
    return storageLibraryEntries()
  }
  const migrate = () =>
    (migration ??= migrateCompanionMemory(companion, path.join(dataDir, 'companion-memory'), { gameIds: library().map((entry) => entry.id) }).catch((error) => {
      migration = undefined
      throw error
    }))
  async function execute(method: string, args: unknown[]) {
    if (method === 'ping') return { ok: true }
    if (method.startsWith('observations.')) {
      observations ??= createTranslationObservationStore(shared.$client)
      if (method === 'observations.append') return observations.append(args[0] as unknown[])
      if (method === 'observations.export') return observations.export(args[0] as Parameters<typeof observations.export>[0])
      throw new Error('Unknown observation operation')
    }
    if (method.startsWith('resources.')) {
      resources ??= createTranslationResourceStore(shared.$client)
      switch (method) {
        case 'resources.preview':
          return resources.preview(String(args[0]))
        case 'resources.apply':
          return resources.apply(String(args[0]), String(args[1]))
        case 'resources.install':
          return resources.apply(String(args[0]), String(args[1]), false)
        case 'resources.activate':
          return resources.activate(String(args[0]), String(args[1]))
        case 'resources.disable':
          return resources.disable(String(args[0]))
        case 'resources.list':
          return resources.list()
        case 'resources.export':
          return resources.export(String(args[0]), String(args[1]))
        case 'resources.snapshot':
          return resources.snapshot()
        default:
          throw new Error('Unknown resource operation')
      }
    }
    if (method === 'translations.commit') {
      const input = args[0] as TranslationCommitInput
      const result = commitTranslations(shared, input)
      games.refresh(input.gameId)
      scheduleGameCacheRefresh()
      return result
    }
    if (method === 'config.get') return configuration.read(String(args[0]))
    if (method === 'config.set') return configuration.write(String(args[0]), args[1], args[2] as number | undefined)
    if (method === 'game.mount') return games.mount(String(args[0]))
    if (method === 'game.append' || method === 'game.write') {
      const root = String(args[0])
      const result = method === 'game.append' ? await games.append(root, args[1] as unknown[], args[2] as string | undefined) : await games.write(root, String(args[1]), args[2])
      scheduleGameCacheRefresh(root)
      return result
    }
    if (method === 'game.read') return games.read(String(args[0]), String(args[1]))
    if (method === 'companion.load' || method === 'companion.state' || method === 'companion.commit' || method === 'companion.manage') {
      await migrate()
      let gameId = String(args[0])
      if (!gameId || gameId.length > 200) throw new Error('Invalid companion game ID')
      const entry = library().find((item) => item.id === gameId && !item.remote)
      const root = typeof args[2] === 'string' ? args[2] : entry?.gameRoot
      if (root) gameId = (await games.mount(root)).gameId
      if (gameId === 'default') throw new Error('Companion memory requires a verified game identity')
      if (method === 'companion.load') return memory.load(gameId)
      if (method === 'companion.state') return memory.state(gameId)
      if (method === 'companion.manage') return memory.manage(gameId, args[1] as MemoryManagementRequest)
      return memory.commit(gameId, bindWriteBatchToGame(args[1] as MemoryWriteBatch, gameId))
    }
    if (method === 'settings.get') return loadOwnedGameAgentSettings(settingsFile)
    if (method === 'settings.set') return saveOwnedGameAgentSettings(args[0] as Partial<import('@/services/game-agent/settings').GameAgentSettings>, settingsFile)
    if (method === 'settings.save') return saveOwnedGameAgentSyncDocument(args[0] as AgentSyncDocument, syncFile, settingsFile)
    if (method === 'settings.update')
      return updateOwnedGameAgentSyncFromSettings(
        args[0] as Partial<import('@/services/game-agent/settings').GameAgentSettings>,
        args[1] as string | undefined,
        args[2] as AgentSyncDocument | undefined,
        syncFile,
        settingsFile
      )
    if (method === 'settings.mergeResult') return mergeOwnedGameAgentSyncDocument(args[0] as AgentSyncDocument, syncFile, settingsFile)
    if (method === 'settings.load') {
      const current = loadOwnedGameAgentSyncDocument(syncFile, settingsFile)
      return agentSettingsFromSyncDocument(current).profiles.length ? current : mergeOwnedGameAgentSyncDocument(current, syncFile, settingsFile).sync
    }
    if (method === 'settings.merge') return mergeOwnedGameAgentSyncDocument(args[0] as AgentSyncDocument, syncFile, settingsFile).sync
    if (method === 'trace.append') return traces.append(args[0] as AgentTask, args[1] as AgentTaskEvent)
    if (method === 'trace.source') return traces.appendSource(args[0] as SourceGameEvent)
    if (method === 'trace.list') return (await traces.list()).filter((task) => (!args[0] || task.gameId === args[0]) && (!args[1] || task.runtimeInstanceId === args[1]))
    if (method === 'trace.read' || method === 'trace.export') {
      const task = await traces.read(String(args[1]))
      if (!task || (args[0] && task.gameId !== args[0]) || (args[2] && task.runtimeInstanceId !== args[2])) return null
      return method === 'trace.export' ? traces.export(task.id) : task
    }
    if (method === 'trace.remove')
      return args[2]
        ? traces.removeForRuntime(String(args[2]), args[1] as string | undefined, String(args[0]))
        : args[0]
          ? traces.removeForGame(String(args[0]), args[1] as string | undefined)
          : traces.remove(args[1] as string | undefined)
    if (method.startsWith('shared.')) {
      cache ??= openOwnedSharedCache(path.join(dataDir, 'translate-cache/shared.sqlite'))
      await waitSharedCacheHeavyMigrate(path.join(dataDir, 'translate-cache/shared.sqlite'))
      const name = method.slice(7)
      if (name === 'close' || name === '__proto__' || name === 'constructor') throw new Error('Unsupported shared operation')
      if (!Object.hasOwn(cache, name)) throw new Error('Unknown shared operation')
      if (['queueBackfill', 'flushBackfill', 'queueGameProjections', 'syncGameCache'].includes(name) && typeof args[0] === 'string') await games.mount(args[0])
      const operation = cache[name as keyof typeof cache]
      if (typeof operation !== 'function') return operation
      if (name === 'flushBackfill' && typeof args[0] === 'string') {
        const result = cache.flushBackfill(args[0], { projectionBudgetMs: 25 })
        if (result.pending) scheduleGameCacheRefresh(args[0])
        return result
      }
      const result = (operation as (...values: unknown[]) => unknown)(...args)
      if (
        ['writeMany', 'upsertMany', 'upsertOptimizeMany', 'importIgnoreExisting', 'appendManual', 'update', 'remove', 'scrubDirty', 'setAlignment', 'confirmSegments'].includes(
          name
        )
      ) {
        scheduleGameCacheRefresh()
      }
      if (result instanceof Map) return { storageMap: [...result] }
      if (name === 'numericRecords') return { items: result, limited: Boolean((result as { limited?: boolean }).limited) }
      return result
    }
    throw new Error('Unknown storage operation')
  }
  return {
    call(method: string, args: unknown[], requestId?: string, report?: (timing: { queueMs: number; executeMs: number }) => void) {
      const timing = startOperation('storage', 'storage.execute', { method }, { operationId: requestId, start: false })
      const result = queue.then(() =>
        timing.run(async () => {
          const queueMs = timing.elapsedMs()
          const started = performance.now()
          try {
            const value = await execute(method, args)
            const executeMs = Math.round((performance.now() - started) * 10) / 10
            report?.({ queueMs, executeMs })
            timing.end('completed', { queueMs, executeMs })
            return value
          } catch (error) {
            const executeMs = Math.round((performance.now() - started) * 10) / 10
            report?.({ queueMs, executeMs })
            timing.fail(error, { queueMs, executeMs })
            throw error
          }
        })
      )
      queue = result.catch(() => undefined)
      return result
    },
    async close() {
      await queue
      if (refreshTimer) clearTimeout(refreshTimer)
      if (refreshAll || refreshRoots.size) await refreshGameCaches(true)
      cache?.close()
    },
  }
}
