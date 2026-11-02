/**
 * Main-process seed-job facade. The translation loop, SQLite writes and inventory
 * preparation live in a dedicated worker so Next.js stays responsive.
 */
import fs from 'node:fs'

import { localGameContentFile } from '@/lib/game/content-files'
import { getResolvedFromConfig } from '@/services/game/binding'
import { shouldDemoteOrphanRunning } from '@/services/jobs'

import {
  emptySeedProgress,
  idleSeedJob,
  readSeedJobState,
  scrubSeedJobLogs,
  type SeedJobLogEntry,
  type SeedJobLogLevel,
  type SeedJobSnapshot,
  type SeedJobState,
  type SeedJobStatus,
  visibleSeedJobState,
  writeSeedJobState,
} from './seed-job-state'
import { commandSeedJobWorker, seedJobWorkerAlive, seedJobWorkerStarted } from './seed-job-worker-client'

export type { SeedJobLogEntry, SeedJobLogLevel, SeedJobSnapshot, SeedJobState, SeedJobStatus }

type LegacyRuntime = {
  running?: boolean
  stopRequested?: boolean
  handoffPending?: boolean
  session?: { pause?: () => void }
}

const globalStore = globalThis as typeof globalThis & {
  __chayaSeedJobs?: Map<string, LegacyRuntime>
  __chayaSeedJobPending?: Map<string, { command: 'start' | 'refresh'; at: number }>
}
const pendingCommands = (globalStore.__chayaSeedJobPending ??= new Map())

function clearPendingCommand(contentRoot: string, command: 'start' | 'refresh') {
  const pending = pendingCommands.get(contentRoot)
  if (pending?.command === command) pendingCommands.delete(contentRoot)
}

/** A hot reload can leave the previous in-process loop alive; drain it before the worker takes over. */
function legacyRuntimeDrained(): Promise<void> {
  const runtimes = globalStore.__chayaSeedJobs
  if (!runtimes) return Promise.resolve()
  const active = [...runtimes.values()].filter((rt) => rt.running)
  if (!active.length) return Promise.resolve()
  for (const rt of active) {
    rt.stopRequested = true
    rt.handoffPending = true
    rt.session?.pause?.()
  }
  return new Promise((resolve) => {
    const deadline = Date.now() + 20_000
    const check = () => {
      if (active.every((rt) => !rt.running) || Date.now() >= deadline) {
        resolve()
        return
      }
      const timer = setTimeout(check, 100)
      timer.unref?.()
    }
    check()
  })
}

function resolveBoundRoot(options?: { gameId?: string; contentRoot?: string }): string {
  if (options?.contentRoot) return options.contentRoot
  const resolved = getResolvedFromConfig(options?.gameId ? { gameId: options.gameId } : undefined)
  if (!resolved.ok) throw new Error('Please bind a local game in the game library first')
  if (resolved.remote) throw new Error('Remote games must be bound locally before translating')
  return resolved.contentRoot
}

/** Cheap existence check — no storage IPC / Atomics.wait. */
function peekHasSeed(contentRoot: string): boolean {
  const file = localGameContentFile(contentRoot, 'seed')
  if (!file) return false
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  return !!stat && stat.size > 2
}

/** Snapshot-only fallback while the worker is starting or unavailable. */
function diskSnapshot(contentRoot: string): SeedJobSnapshot {
  const state = readSeedJobState(contentRoot) ?? idleSeedJob(contentRoot)
  const pending = pendingCommands.get(contentRoot)
  if (pending && (state.status === 'error' || Date.now() - pending.at > 30_000)) pendingCommands.delete(contentRoot)
  const workerRunning = seedJobWorkerStarted()
  const preparing = pendingCommands.has(contentRoot) || (seedJobWorkerAlive() && Boolean(state.inventoryPreparing))
  if (state.status === 'done' && (state.progress?.missing ?? 0) > 0) {
    state.status = 'paused'
    state.liveStatus = ''
    writeSeedJobState(state)
  }
  if (shouldDemoteOrphanRunning(state.status, { running: workerRunning, preparing })) {
    state.status = 'paused'
    state.inventoryPreparing = false
    if (!state.liveStatus) state.liveStatus = `已暂停 · 本会话已译 ${state.sessionDone} 条`
    state.updatedAt = Date.now()
    try {
      writeSeedJobState(state)
    } catch {
      /* snapshot still returned */
    }
  }
  if (scrubSeedJobLogs(state)) {
    try {
      writeSeedJobState(state)
    } catch {
      /* snapshot still returned */
    }
  }
  const progress = state.progress
  if (!progress) {
    return {
      ...emptySeedProgress(contentRoot),
      hasSeed: peekHasSeed(contentRoot),
      job: visibleSeedJobState(state),
      stale: true,
      ...(preparing ? { preparing: true } : {}),
    }
  }
  return { ...progress, job: visibleSeedJobState(state), ...(preparing ? { preparing: true } : {}) }
}

/**
 * Progress poll: disk snapshot only. The worker owns live counters; polling never
 * blocks on translation or inventory work.
 */
export function getSeedJobSnapshot(options?: { gameId?: string; contentRoot?: string }): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot(options)
  return diskSnapshot(contentRoot)
}

/** Explicit refresh: the worker rescans inventory without blocking Next.js. */
export function refreshSeedJobProgress(options?: { gameId?: string; contentRoot?: string }): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot(options)
  const snapshot = diskSnapshot(contentRoot)
  pendingCommands.set(contentRoot, { command: 'refresh', at: Date.now() })
  const clear = () => clearPendingCommand(contentRoot, 'refresh')
  const explicitRoot = options?.contentRoot || (options?.gameId ? contentRoot : undefined)
  void legacyRuntimeDrained()
    .then(() => (explicitRoot ? commandSeedJobWorker('refresh', explicitRoot) : commandSeedJobWorker('refresh')))
    .then(clear, clear)
  return { ...snapshot, preparing: true }
}

/** Start or resume the fill loop inside the worker. */
export function startSeedJob(options?: { gameId?: string; contentRoot?: string; engines?: string[] }): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot(options)
  const snapshot = diskSnapshot(contentRoot)
  const state = readSeedJobState(contentRoot)
  if (state?.status === 'running' && state.inventoryPreparing) return { ...snapshot, preparing: true }
  pendingCommands.set(contentRoot, { command: 'start', at: Date.now() })
  const clear = () => clearPendingCommand(contentRoot, 'start')
  const explicitRoot = options?.contentRoot || (options?.gameId ? contentRoot : undefined)
  void legacyRuntimeDrained()
    .then(() => {
      if (options?.engines) {
        return commandSeedJobWorker('start', explicitRoot, options.engines)
      }
      return explicitRoot ? commandSeedJobWorker('start', explicitRoot) : commandSeedJobWorker('start')
    })
    .then(clear)
    .catch((error) => {
      clear()
      const failed = readSeedJobState(contentRoot) ?? idleSeedJob(contentRoot)
      failed.status = 'error'
      failed.error = error instanceof Error ? error.message : String(error)
      failed.liveStatus = ''
      failed.updatedAt = Date.now()
      try {
        writeSeedJobState(failed)
      } catch {
        /* snapshot remains readable */
      }
    })
  return { ...snapshot, preparing: true }
}

/** Pause after the worker finishes its current batch. */
export function pauseSeedJob(options?: { gameId?: string; contentRoot?: string }): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot(options)
  const snapshot = diskSnapshot(contentRoot)
  const explicitRoot = options?.contentRoot || (options?.gameId ? contentRoot : undefined)
  void legacyRuntimeDrained()
    .then(() => (explicitRoot ? commandSeedJobWorker('pause', explicitRoot) : commandSeedJobWorker('pause')))
    .catch(() => {})
  return snapshot
}
