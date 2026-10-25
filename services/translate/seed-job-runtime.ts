/** Worker-side seed fill loop. The Next.js process only reads snapshots and sends commands. */
import fs from 'node:fs'

import { formatCompactCount } from '@/lib/format-compact-count'
import { type LiveTranslationSample, rollingTranslationPerformance, smoothTranslationPerformance, translationPerformance, type TranslationSample } from '@/lib/translate/remain-eta'
import type { BatchExecutionSource, TranslationBatchLog } from '@/lib/translate/runtime-api'
import { getResolvedFromConfig } from '@/services/game/binding'
import { shouldDemoteOrphanRunning } from '@/services/jobs'

import { getTranslateEngineSwitches } from './engine-switches'
import { createSeedFillSession, type SeedProgress } from './fill-missing'
import { localGameContentFile, seedFileStamp, seedProgressStamp } from './scheduler/seed-inventory'
import { isSeedInventoryPreparing, peekSeedInventory, prepareSeedInventory } from './scheduler/seed-prepare'
import { createSeedBatchBudget } from './seed-batch'
import {
  emptySeedProgress,
  idleSeedJob,
  MAX_SEED_JOB_LOGS,
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
import { charCount } from './text-classify'

export type { SeedJobLogEntry, SeedJobLogLevel, SeedJobSnapshot, SeedJobState, SeedJobStatus }

type Runtime = {
  state: SeedJobState
  stopRequested: boolean
  running: boolean
  logSeq: number
  session?: ReturnType<typeof createSeedFillSession>
  samples?: TranslationSample[]
  liveSamples?: LiveTranslationSample[]
  progress?: SeedProgress
  workerVersion?: number
  handoffPending?: boolean
  handoffTimer?: ReturnType<typeof setTimeout>
}

const globalStore = globalThis as typeof globalThis & {
  __chayaSeedJobs?: Map<string, Runtime>
  __chayaSeedWorker?: (root: string) => void
}
const runtimes = (globalStore.__chayaSeedJobs ??= new Map<string, Runtime>())
const WORKER_VERSION = 14
globalStore.__chayaSeedWorker = (root) => {
  void runLoop(root)
}
// An older loop may still hold its old imports after HMR. Drain it before handing off.
for (const rt of runtimes.values()) {
  if (rt.running && rt.workerVersion !== WORKER_VERSION) {
    rt.stopRequested = true
    rt.session?.pause?.()
    rt.handoffPending = true
    scheduleHandoff(rt)
  }
}

/**
 * Older loops cannot call the new worker themselves. After drain, stay paused —
 * never auto-ensureLoop here: that sync-scans seed/RGSS on the Next.js main
 * thread and freezes `/translate/seed` (and every other API) for seconds–minutes.
 * Resume only via explicit startSeedJob.
 */
function scheduleHandoff(rt: Runtime) {
  if (rt.handoffTimer) return
  const check = () => {
    rt.handoffTimer = undefined
    if (!rt.handoffPending) return
    if (rt.running) {
      rt.handoffTimer = setTimeout(check, 100)
      rt.handoffTimer.unref?.()
      return
    }
    rt.handoffPending = false
    if (rt.state.status !== 'paused' && rt.state.status !== 'running') return
    try {
      rt.state.status = 'paused'
      pushLog(rt, 'info', 'Translation worker updated; job remains paused. Continue translation to resume.')
      persist(rt)
    } catch (error) {
      rt.state.status = 'error'
      rt.state.error = error instanceof Error ? error.message : String(error)
    }
  }
  rt.handoffTimer = setTimeout(check, 100)
  rt.handoffTimer.unref?.()
}

function resolveBoundRoot(): string {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) throw new Error('Please bind a local game in the game library first')
  if (resolved.remote) throw new Error('Remote games must be bound locally before translating')
  return resolved.contentRoot
}

function getRuntime(contentRoot: string): Runtime {
  let rt = runtimes.get(contentRoot)
  if (rt) return rt
  const disk = readSeedJobState(contentRoot)
  // Keep a disk snapshot even when the stamp drifted — polls must never sync-scan.
  rt = {
    state: disk ?? idleSeedJob(contentRoot),
    progress: disk?.progress,
    stopRequested: false,
    running: false,
    logSeq: disk?.logs.reduce((m, e) => Math.max(m, e.id), 0) ?? 0,
  }
  runtimes.set(contentRoot, rt)
  if (scrubSeedJobLogs(rt.state)) writeSeedJobState(rt.state)
  return rt
}

/** Cheap existence check — local contentRoot only (no storage IPC / Atomics.wait). */
function peekHasSeed(contentRoot: string): boolean {
  const file = localGameContentFile(contentRoot, 'seed')
  if (!file) return false
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  return !!stat && stat.size > 2
}

function pushLog(rt: Runtime, level: SeedJobLogLevel, text: string, batch?: SeedJobLogEntry['batch']) {
  rt.logSeq += 1
  rt.state.logs = [...rt.state.logs, { id: rt.logSeq, at: Date.now(), level, text, ...(batch ? { batch } : {}) }].slice(-MAX_SEED_JOB_LOGS)
}

/** Short engine tag for one-line logs. */
function shortEngine(name: string): string {
  const raw = name.trim().replace(/^live:/, '')
  if (!raw) return 'eng'
  if (raw.startsWith('agent:')) return 'agent'
  if (raw.startsWith('cache')) return 'cache'
  return raw.length > 10 ? `${raw.slice(0, 9)}…` : raw
}

function batchSource(name: string | undefined): BatchExecutionSource {
  const raw = (name || '')
    .trim()
    .toLowerCase()
    .replace(/^live:/, '')
  if (raw === 'cache' || raw.startsWith('cache:')) return 'cache'
  if (raw === 'apple' || raw.startsWith('apple:')) return 'apple'
  if (raw === 'agent' || raw.startsWith('agent:')) return 'agent'
  if (raw === 'bergamot' || raw.startsWith('bergamot:')) return 'bergamot'
  if (raw === 'ollama' || raw.startsWith('ollama:')) return 'ollama'
  if (raw === 'platform' || raw.startsWith('google') || raw.startsWith('bing') || raw.startsWith('platform:')) return 'platform'
  return 'unknown'
}

function batchSources(items: Array<{ engine?: string }>): BatchExecutionSource[] {
  const order: BatchExecutionSource[] = ['apple', 'agent', 'platform', 'bergamot', 'ollama', 'unknown', 'cache']
  const present = new Set(items.map((item) => batchSource(item.engine)))
  return order.filter((source) => present.has(source))
}

function batchLabel(batch: TranslationBatchLog): string {
  const sources = batchSources(batch.submittedSources.map((engine) => ({ engine })))
  const final = batchSources(batch.finalSources.map((engine) => ({ engine })))
  const labels = [...sources, ...(batch.cacheUnavailable ? ['cache:unavailable'] : []), ...final.filter((source) => source === 'cache' || !sources.includes(source))].map(
    (source) => (source === 'cache:unavailable' ? 'Cache unavailable' : shortEngine(source))
  )
  return [...new Set(labels)].join('+') || '—'
}

function persist(rt: Runtime) {
  if (rt.progress) {
    rt.state.progress = rt.progress
    rt.state.seedStamp = seedFileStamp(rt.state.contentRoot)
    rt.state.progressStamp = seedProgressStamp(rt.state.contentRoot)
  }
  rt.state.updatedAt = Date.now()
  writeSeedJobState(rt.state)
}

async function runLoop(contentRoot: string) {
  const rt = getRuntime(contentRoot)
  if (rt.running) return
  rt.running = true
  rt.stopRequested = false
  rt.workerVersion = WORKER_VERSION
  rt.samples = []
  rt.liveSamples = [{ at: Date.now(), chars: 0 }]
  rt.state.performance = null
  const initialSessionDone = rt.state.sessionDone
  const budget = createSeedBatchBudget(rt.state.engines.length === 1 && rt.state.engines[0] === 'apple' ? 12 : 4)
  const trace = (message: string) => {
    if (message.startsWith('Cache scan unavailable:')) {
      pushLog(
        rt,
        'warn',
        message.includes('worker not built') ? 'Cache scan failed: cache worker is not built.' : `Cache scan failed: ${message.replace(/^Cache scan unavailable:\s*/i, '')}`
      )
    }
    if (process.env.CHAYA_TRANSLATE_DEBUG !== '1') return
    const text = `[translation-timing] batch=${rt.state.rounds + 1} ${message}`
    pushLog(rt, 'info', text)
    // eslint-disable-next-line no-console -- Detailed timings are explicitly enabled for diagnostics.
    console.info(text)
  }
  try {
    // Never invent inventory on the main thread — beginSeedLoop always passes a bundle;
    // if session was cleared (HMR) without a peek cache, pause for explicit Start/Continue.
    if (!rt.session) {
      const peeked = peekSeedInventory(contentRoot)
      if (!peeked) {
        rt.state.status = 'paused'
        rt.state.liveStatus = rt.state.liveStatus || `已暂停 · 本会话已译 ${rt.state.sessionDone} 条`
        pushLog(rt, 'warn', 'Source inventory missing; job paused. Continue translation to prepare it again.')
        persist(rt)
        return
      }
      rt.session = createSeedFillSession(contentRoot, trace, { nonBlocking: true, inventory: peeked })
    }
    rt.progress = rt.session.progress
    let measuredAt = performance.now()
    while (!rt.stopRequested) {
      rt.state.liveStatus = `正在翻译第 ${rt.state.rounds + 1} 段…`
      persist(rt)

      let result
      try {
        const started = performance.now()
        const slice = budget.current()
        let completed = 0
        let checkpointAt = 0
        result = await rt.session.fill({
          ...slice,
          exclude: new Set(rt.state.failedSources),
          onTrace: trace,
          onItem: (item) => {
            if (rt.session) rt.progress = rt.session.progress
            if (item.zh && !item.error) {
              rt.liveSamples = [...(rt.liveSamples || []), { at: Date.now(), chars: charCount(item.src) }].slice(-120)
              const measured = rollingTranslationPerformance(rt.liveSamples, { cacheMs: rt.state.performance?.cacheMs ?? 0 })
              rt.state.performance = smoothTranslationPerformance(rt.state.performance, measured)
            }
            completed++
            rt.state.liveStatus = `本批已处理 ${completed} 条 · 成功译文已保存`
            if (Date.now() - checkpointAt >= 250) {
              persist(rt)
              checkpointAt = Date.now()
            }
          },
        })
        rt.progress = rt.session.progress
        const measuredNow = performance.now()
        const elapsedMs = measuredNow - started
        const sampleElapsedMs = measuredNow - measuredAt
        measuredAt = measuredNow
        budget.observe(elapsedMs, result.failed, result.scanned)
        if (result.scanned && result.performance) {
          rt.samples = [...(rt.samples || []), { elapsedMs: sampleElapsedMs, ...result.performance }].slice(-8)
          const measured = rollingTranslationPerformance(rt.liveSamples || [], { cacheMs: result.performance.cacheMs }) ?? translationPerformance(rt.samples)
          rt.state.performance = smoothTranslationPerformance(rt.state.performance, measured)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        rt.state.status = 'error'
        rt.state.error = msg
        rt.state.liveStatus = ''
        pushLog(rt, 'fail', `Translation stopped: ${msg}`)
        persist(rt)
        return
      }

      rt.state.rounds += 1
      rt.state.sessionDone = rt.session.processed == null ? rt.state.sessionDone + result.translated : initialSessionDone + rt.session.processed
      rt.state.error = null
      if (result.scanned > 0) {
        const submittedSources = batchSources((result.submittedEngines || []).map((engine) => ({ engine })))
        const accepted = result.items.filter((item) => item.zh != null && !item.error && !result.unresolved.includes(item.src))
        const finalSources = batchSources(accepted)
        const batch = {
          batch: rt.state.rounds,
          success: result.translated,
          total: result.scanned,
          failed: result.failed,
          chars: result.items.reduce((sum, item) => sum + charCount(item.src), 0),
          cacheHits: accepted.filter((item) => item.engine?.startsWith('cache')).length,
          submittedSources,
          finalSources,
          cacheUnavailable: result.cacheUnavailable === true,
        }
        const prefix = `[${batchLabel(batch)}] #${batch.batch}`
        const text =
          batch.failed === 0
            ? `${prefix}: ${batch.success}/${batch.total} items (${batch.chars} chars) complete (${batch.cacheHits} cache hits)`
            : batch.success === 0
              ? `${prefix}: All failed (${batch.total} items / ${batch.chars} chars)`
              : `${prefix}: ${batch.success}/${batch.total} items (${batch.chars} chars) succeeded, ${batch.failed} failed${batch.cacheHits > 0 ? ` (${batch.cacheHits} cache hits)` : ''}`
        pushLog(rt, batch.failed === 0 ? 'ok' : batch.success === 0 ? 'fail' : 'warn', text, batch)
      }
      const failures = result.items.filter((item) => item.error || item.zh == null).slice(0, 1)
      for (const item of failures) pushLog(rt, 'warn', `Translation failed: ${item.src} (${item.error || 'no translation returned'})`)

      if (!result.missing && !result.pendingResults) {
        rt.state.status = 'done'
        rt.state.liveStatus = `已完成 · 本会话已译 ${rt.state.sessionDone} 条`
        pushLog(rt, 'ok', `Translation complete: all source text processed; translated ${formatCompactCount(rt.state.sessionDone)} items this session.`)
        persist(rt)
        return
      }

      const failed = result.unresolved
      rt.state.failedSources = [...new Set([...rt.state.failedSources, ...failed])]
      if (!result.scanned || (!failed.length && !result.translated)) {
        rt.state.status = 'paused'
        rt.state.liveStatus = `本轮结束 · 仍缺 ${result.missing} 条，继续可重试`
        pushLog(rt, 'warn', `No progress this round: ${formatCompactCount(result.missing)} items still missing; retry to continue.`)
        persist(rt)
        return
      }

      rt.state.liveStatus = `第 ${rt.state.rounds} 段完成 · 本会话已译 ${rt.state.sessionDone} 条 · 仍缺 ${result.missing}`
      persist(rt)

      if (rt.stopRequested) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    if (rt.stopRequested) {
      rt.state.status = 'paused'
      rt.state.liveStatus = `已暂停 · 本会话已译 ${rt.state.sessionDone} 条`
      pushLog(rt, 'warn', `Translation paused: ${formatCompactCount(rt.state.sessionDone)} items translated this session.`)
      persist(rt)
    }
  } catch (err) {
    rt.state.status = 'error'
    rt.state.error = err instanceof Error ? err.message : String(err)
    rt.state.liveStatus = ''
    try {
      persist(rt)
    } catch {
      /* 原始落盘错误保留在内存快照中 */
    }
  } finally {
    try {
      await rt.session?.close?.()
      if (rt.session) {
        rt.progress = rt.session.progress
        if (rt.session.processed != null) rt.state.sessionDone = initialSessionDone + rt.session.processed
      }
      persist(rt)
    } catch (error) {
      rt.state.status = 'error'
      rt.state.error = error instanceof Error ? error.message : String(error)
    }
    rt.running = false
    rt.stopRequested = false
    rt.session = undefined
    // Never auto-ensureLoop on handoff — same freeze class as poll. scheduleHandoff /
    // getSeedJobSnapshot demote to paused; user continues via startSeedJob.
  }
}

function ensureLoop(contentRoot: string) {
  const rt = getRuntime(contentRoot)
  if (rt.running || rt.state.status !== 'running') return
  globalStore.__chayaSeedWorker?.(contentRoot)
}

/**
 * Progress poll: memory/disk snapshot only.
 * Never inventory-scan, never ensureLoop / createSeedFillSession, never storage mount —
 * those block the Next.js event loop and freeze the whole console.
 * Orphaned disk `running` (process bounce) demotes to paused; startSeedJob resumes.
 * Stamp drift is not probed here (docs: no stale UX; Start/refresh recompute in a worker).
 */
export function getSeedJobSnapshot(): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot()
  const rt = getRuntime(contentRoot)
  if (rt.handoffPending && !rt.running) {
    rt.handoffPending = false
    if (rt.state.status === 'running') {
      rt.state.status = 'paused'
      pushLog(rt, 'info', 'Translation worker updated; job remains paused. Continue translation to resume.')
    }
  }
  if (rt.state.contentRoot !== contentRoot) {
    rt.state = readSeedJobState(contentRoot) ?? idleSeedJob(contentRoot)
    rt.progress = rt.state.progress
  }
  if (scrubSeedJobLogs(rt.state)) {
    try {
      writeSeedJobState(rt.state)
    } catch {
      /* snapshot still returned */
    }
  }
  const preparingInventory = Boolean(rt.state.inventoryPreparing) || isSeedInventoryPreparing(contentRoot)
  // Process restarted while a job was marked running: keep counts, do not auto-resume.
  // Skip while Start/Continue is still building inventory off-thread (status=running, !rt.running).
  if (shouldDemoteOrphanRunning(rt.state.status, { running: rt.running, preparing: preparingInventory })) {
    rt.state.status = 'paused'
    if (!rt.state.liveStatus) rt.state.liveStatus = `已暂停 · 本会话已译 ${rt.state.sessionDone} 条`
    try {
      persist(rt)
    } catch {
      /* snapshot still returned */
    }
  }
  const progress = rt.progress ?? rt.state.progress
  if (!progress) {
    return {
      ...emptySeedProgress(contentRoot),
      hasSeed: peekHasSeed(contentRoot),
      job: visibleSeedJobState(rt.state),
      stale: true,
      ...(preparingInventory ? { preparing: true } : {}),
    }
  }
  return {
    ...progress,
    job: visibleSeedJobState(rt.state),
    ...(preparingInventory ? { preparing: true } : {}),
  }
}

function applyInventoryBundle(rt: Runtime, bundle: import('./scheduler/seed-prepare').SeedInventoryBundle) {
  const progress = bundle.progress
  rt.progress = progress
  rt.state.progress = progress
  rt.state.progressStamp = seedProgressStamp(rt.state.contentRoot)
  rt.state.seedStamp = seedFileStamp(rt.state.contentRoot)
  if (!progress.hasSeed || !progress.total) {
    rt.state.status = 'idle'
    rt.state.liveStatus = ''
  } else if (!progress.missing && rt.state.status !== 'running') {
    rt.state.status = 'done'
    rt.state.liveStatus = '已完成'
    rt.state.error = null
  }
  persist(rt)
}

/** Explicit full inventory (button). Starts a worker; polls see `preparing` until ready. */
export function refreshSeedJobProgress(): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot()
  const rt = getRuntime(contentRoot)
  if (rt.running) return getSeedJobSnapshot()

  const peeked = peekSeedInventory(contentRoot)
  const seedStampNow = seedFileStamp(contentRoot)
  if (peeked && peeked.stamp === seedStampNow) {
    applyInventoryBundle(rt, peeked)
    return { ...peeked.progress, job: visibleSeedJobState(rt.state) }
  }

  rt.state.inventoryPreparing = true
  if (!rt.state.liveStatus) rt.state.liveStatus = '正在准备原文库存…'
  persist(rt)

  void prepareSeedInventory(contentRoot)
    .then((bundle) => {
      const live = getRuntime(contentRoot)
      live.state.inventoryPreparing = false
      applyInventoryBundle(live, bundle)
    })
    .catch((error) => {
      const live = getRuntime(contentRoot)
      live.state.inventoryPreparing = false
      live.state.status = 'error'
      live.state.error = error instanceof Error ? error.message : String(error)
      live.state.liveStatus = ''
      persist(live)
    })

  return {
    ...(rt.progress ?? rt.state.progress ?? emptySeedProgress(contentRoot)),
    preparing: true,
    job: visibleSeedJobState(rt.state),
  }
}

function beginSeedLoop(contentRoot: string, inventory: import('./scheduler/seed-prepare').SeedInventoryBundle) {
  const progress = inventory.progress
  const rt = getRuntime(contentRoot)
  if (rt.running) return
  rt.progress = progress
  rt.state.progress = progress
  rt.state.progressStamp = seedProgressStamp(contentRoot)
  rt.state.seedStamp = seedFileStamp(contentRoot)
  if (!progress.hasSeed || !progress.total) {
    rt.state.status = 'error'
    rt.state.error = 'Seed not found (please extract text first or provide *-trans.seed.json)'
    persist(rt)
    return
  }
  if (!progress.missing) {
    rt.state.status = 'done'
    rt.state.liveStatus = '已完成'
    rt.state.error = null
    persist(rt)
    return
  }
  let engines: string[] = []
  try {
    engines = getTranslateEngineSwitches(contentRoot).enabled
  } catch {
    engines = []
  }
  if (!engines.length) {
    rt.state.status = 'error'
    rt.state.error = 'No translation engines are enabled'
    persist(rt)
    return
  }
  rt.state.failedSources = []
  const resume = rt.state.status === 'paused' || rt.state.status === 'running'
  rt.stopRequested = false
  rt.state.contentRoot = contentRoot
  rt.state.status = 'running'
  rt.samples = []
  rt.state.performance = null
  rt.state.startedAt = resume && rt.state.startedAt ? rt.state.startedAt : Date.now()
  rt.state.error = null
  rt.state.engines = engines
  rt.state.liveStatus = resume ? '继续翻译…' : '开始翻译…'
  if (!resume) {
    rt.state.sessionDone = 0
    rt.state.rounds = 0
    rt.state.logs = []
    rt.logSeq = 0
  }
  pushLog(rt, 'info', `${resume ? 'Resume' : 'Start'} translation · engines ${engines.map(shortEngine).join('+')}`)
  persist(rt)
  rt.session = createSeedFillSession(contentRoot, undefined, { nonBlocking: true, inventory })
  rt.progress = rt.session.progress
  ensureLoop(contentRoot)
}

/** Start or resume the server-side fill loop. Inventory runs single-flight off the HTTP return path. */
export function startSeedJob(): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot()
  const current = getRuntime(contentRoot)
  if (current.running) return getSeedJobSnapshot()

  let engines: string[] = []
  try {
    engines = getTranslateEngineSwitches(contentRoot).enabled
  } catch {
    engines = []
  }
  if (!engines.length) throw new Error('No translation engines are enabled')

  const peeked = peekSeedInventory(contentRoot)
  const seedStampNow = seedFileStamp(contentRoot)
  if (peeked && peeked.stamp === seedStampNow) {
    beginSeedLoop(contentRoot, peeked)
    const rt = getRuntime(contentRoot)
    return { ...(rt.progress ?? peeked.progress), job: visibleSeedJobState(rt.state) }
  }

  const rt = getRuntime(contentRoot)
  const resume = rt.state.status === 'paused' || rt.state.status === 'running'
  rt.state.contentRoot = contentRoot
  rt.state.status = 'running'
  rt.state.engines = engines
  rt.state.liveStatus = resume ? '正在准备库存以继续…' : '正在准备原文库存…'
  rt.state.error = null
  rt.state.inventoryPreparing = true
  persist(rt)

  void prepareSeedInventory(contentRoot)
    .then((bundle) => {
      const live = getRuntime(contentRoot)
      live.state.inventoryPreparing = false
      if (live.stopRequested) {
        live.state.status = 'paused'
        live.state.liveStatus = `已暂停 · 本会话已译 ${live.state.sessionDone} 条`
        persist(live)
        return
      }
      beginSeedLoop(contentRoot, bundle)
    })
    .catch((error) => {
      const live = getRuntime(contentRoot)
      live.state.inventoryPreparing = false
      live.state.status = 'error'
      live.state.error = error instanceof Error ? error.message : String(error)
      live.state.liveStatus = ''
      persist(live)
    })

  return {
    ...(rt.progress ?? rt.state.progress ?? emptySeedProgress(contentRoot)),
    preparing: true,
    job: visibleSeedJobState(rt.state),
  }
}

/** Pause after the current segment finishes. */
export function pauseSeedJob(): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot()
  const rt = getRuntime(contentRoot)
  rt.handoffPending = false
  if (rt.state.status !== 'running') {
    return getSeedJobSnapshot()
  }
  rt.stopRequested = true
  rt.session?.pause?.()
  rt.state.liveStatus = '正在暂停…'
  pushLog(rt, 'warn', 'Pausing: will stop after the current batch.')
  persist(rt)
  return { ...(rt.progress ?? rt.state.progress ?? emptySeedProgress(contentRoot)), job: visibleSeedJobState(rt.state) }
}
