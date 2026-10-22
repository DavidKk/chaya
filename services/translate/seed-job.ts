/** Server-side seed fill jobs survive page refreshes. Run the loop in-process and persist snapshots under data/translate-jobs/ so running jobs resume after HMR or restart. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { TRANSLATE_JOBS_DIR } from '@/constants/paths'
import { type TranslationPerformance, translationPerformance, type TranslationSample } from '@/lib/translate/remain-eta'
import { getResolvedFromConfig } from '@/services/game/binding'

import { getTranslateEngineSwitches } from './engine-switches'
import { createSeedFillSession, getSeedTranslateProgress, type SeedProgress } from './fill-missing'
import { seedFileStamp, seedProgressStamp } from './scheduler/seed-inventory'
import { createSeedBatchBudget } from './seed-batch'

export type SeedJobStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

export type SeedJobLogLevel = 'info' | 'ok' | 'warn' | 'fail'

export type SeedJobLogEntry = {
  id: number
  at: number
  level: SeedJobLogLevel
  text: string
}

export type SeedJobState = {
  contentRoot: string
  status: SeedJobStatus
  startedAt: number | null
  updatedAt: number
  sessionDone: number
  rounds: number
  performance: TranslationPerformance | null
  progress?: SeedProgress
  seedStamp?: string
  progressStamp?: string
  liveStatus: string
  error: string | null
  engines: string[]
  logs: SeedJobLogEntry[]
  failedSources: string[]
}

export type SeedJobSnapshot = SeedProgress & {
  job: SeedJobState
}

const MAX_LOGS = 120
const idleJob = (contentRoot = ''): SeedJobState => ({
  contentRoot,
  status: 'idle',
  startedAt: null,
  updatedAt: Date.now(),
  sessionDone: 0,
  rounds: 0,
  performance: null,
  liveStatus: '',
  error: null,
  engines: [],
  logs: [],
  failedSources: [],
})

type Runtime = {
  state: SeedJobState
  stopRequested: boolean
  running: boolean
  logSeq: number
  session?: ReturnType<typeof createSeedFillSession>
  samples?: TranslationSample[]
  progress?: SeedProgress
  workerVersion?: number
  handoffPending?: boolean
  handoffTimer?: ReturnType<typeof setTimeout>
}

const globalStore = globalThis as typeof globalThis & { __chayaSeedJobs?: Map<string, Runtime>; __chayaSeedWorker?: (root: string) => void }
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

/** Older loops cannot call the new worker themselves. Handoff also works without polling. */
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
    if (rt.state.status !== 'paused') {
      rt.handoffPending = false
      return
    }
    rt.handoffPending = false
    try {
      rt.state.status = 'running'
      pushLog(rt, 'info', 'Translation worker updated; resuming from saved translations')
      persist(rt)
      ensureLoop(rt.state.contentRoot)
    } catch (error) {
      rt.state.status = 'error'
      rt.state.error = error instanceof Error ? error.message : String(error)
    }
  }
  rt.handoffTimer = setTimeout(check, 100)
  rt.handoffTimer.unref?.()
}

function jobKey(contentRoot: string) {
  return createHash('sha1').update(path.resolve(contentRoot)).digest('hex').slice(0, 16)
}

function jobFile(contentRoot: string) {
  return path.join(TRANSLATE_JOBS_DIR, `${jobKey(contentRoot)}.json`)
}

function clip(text: string, max = 72) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

function resolveBoundRoot(): string {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) throw new Error('Please bind a local game in the game library first')
  if (resolved.remote) throw new Error('Remote games must be bound locally before translating')
  return resolved.contentRoot
}

function readDisk(contentRoot: string): SeedJobState | null {
  const file = jobFile(contentRoot)
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SeedJobState>
    if (!raw || typeof raw !== 'object') return null
    return {
      ...idleJob(contentRoot),
      ...raw,
      contentRoot,
      failedSources: Array.isArray(raw.failedSources) ? raw.failedSources.filter((s): s is string => typeof s === 'string') : [],
      logs: Array.isArray(raw.logs) ? raw.logs.slice(-MAX_LOGS) : [],
    }
  } catch {
    return null
  }
}

function writeDisk(state: SeedJobState) {
  fs.mkdirSync(TRANSLATE_JOBS_DIR, { recursive: true })
  const file = jobFile(state.contentRoot)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

function getRuntime(contentRoot: string): Runtime {
  let rt = runtimes.get(contentRoot)
  if (rt) return rt
  const disk = readDisk(contentRoot)
  rt = {
    state: disk ?? idleJob(contentRoot),
    progress: disk?.progressStamp === seedProgressStamp(contentRoot) ? disk.progress : undefined,
    stopRequested: false,
    running: false,
    logSeq: disk?.logs.reduce((m, e) => Math.max(m, e.id), 0) ?? 0,
  }
  runtimes.set(contentRoot, rt)
  return rt
}

function pushLog(rt: Runtime, level: SeedJobLogLevel, text: string) {
  rt.logSeq += 1
  rt.state.logs = [...rt.state.logs, { id: rt.logSeq, at: Date.now(), level, text }].slice(-MAX_LOGS)
}

function visibleJobState(state: SeedJobState): SeedJobState {
  const logs =
    process.env.CHAYA_TRANSLATE_DEBUG === '1'
      ? state.logs
      : state.logs.filter(
          (entry) =>
            !/^\[translation-timing\]|^Requesting batch |^\.\.\. \d+ additional items omitted|^Skipping \d+ failed items this round/.test(entry.text) &&
            !(entry.level === 'ok' && entry.text.includes(' → '))
        )
  return { ...state, logs: [...logs] }
}

function persist(rt: Runtime) {
  if (rt.progress) {
    rt.state.progress = rt.progress
    rt.state.seedStamp = seedFileStamp(rt.state.contentRoot)
    rt.state.progressStamp = seedProgressStamp(rt.state.contentRoot)
  }
  rt.state.updatedAt = Date.now()
  writeDisk(rt.state)
}

async function runLoop(contentRoot: string) {
  const rt = getRuntime(contentRoot)
  if (rt.running) return
  rt.running = true
  rt.stopRequested = false
  rt.workerVersion = WORKER_VERSION
  rt.samples = []
  rt.state.performance = null
  const initialSessionDone = rt.state.sessionDone
  const budget = createSeedBatchBudget(rt.state.engines.length === 1 && rt.state.engines[0] === 'apple' ? 12 : 4)
  const trace = (message: string) => {
    if (message.startsWith('Cache scan unavailable:')) pushLog(rt, 'warn', message)
    if (process.env.CHAYA_TRANSLATE_DEBUG !== '1') return
    const text = `[translation-timing] batch=${rt.state.rounds + 1} ${message}`
    pushLog(rt, 'info', text)
    // eslint-disable-next-line no-console -- Detailed timings are explicitly enabled for diagnostics.
    console.info(text)
  }
  try {
    rt.session ??= createSeedFillSession(contentRoot, trace, { nonBlocking: true })
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
          onItem: () => {
            if (rt.session) rt.progress = rt.session.progress
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
          rt.state.performance = translationPerformance(rt.samples)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        rt.state.status = 'error'
        rt.state.error = msg
        rt.state.liveStatus = ''
        pushLog(rt, 'fail', msg)
        persist(rt)
        return
      }

      rt.state.rounds += 1
      rt.state.sessionDone = rt.session.processed == null ? rt.state.sessionDone + result.translated : initialSessionDone + rt.session.processed
      rt.state.error = null
      pushLog(
        rt,
        result.translated ? 'ok' : result.failed ? 'warn' : 'info',
        `Batch ${rt.state.rounds}: scanned ${result.scanned}, translated ${result.translated}, failed ${result.failed}, remaining ${result.missing}`
      )
      const failures = result.items.filter((item) => item.error || item.zh == null).slice(0, 3)
      for (const item of failures) pushLog(rt, 'warn', `${clip(item.src)} (${item.error || 'No translation returned'})`)

      if (!result.missing && !result.pendingResults) {
        rt.state.status = 'done'
        rt.state.liveStatus = `已完成 · 本会话已译 ${rt.state.sessionDone} 条`
        pushLog(rt, 'ok', `Completed (${result.needCount} items requiring translation)`)
        persist(rt)
        return
      }

      const failed = result.unresolved
      rt.state.failedSources = [...new Set([...rt.state.failedSources, ...failed])]
      if (!result.scanned || (!failed.length && !result.translated)) {
        rt.state.status = 'paused'
        rt.state.liveStatus = `本轮结束 · 仍缺 ${result.missing} 条，继续可重试`
        pushLog(rt, 'warn', `Round finished; ${result.missing} items remaining. Resume to retry.`)
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
      pushLog(rt, 'warn', `Paused (${rt.state.sessionDone} items translated this session)`)
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
    if (rt.handoffPending && rt.state.status === 'paused') {
      rt.handoffPending = false
      rt.state.status = 'running'
      pushLog(rt, 'info', 'Translation worker updated; resuming from saved translations')
      persist(rt)
      ensureLoop(contentRoot)
    }
  }
}

function ensureLoop(contentRoot: string) {
  const rt = getRuntime(contentRoot)
  if (rt.running || rt.state.status !== 'running') return
  globalStore.__chayaSeedWorker?.(contentRoot)
}

/** Return progress and the job snapshot for the bound game; resume the loop if the persisted state is running. */
export function getSeedJobSnapshot(): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot()
  const rt = getRuntime(contentRoot)
  if (rt.handoffPending && !rt.running && rt.state.status === 'paused') {
    rt.handoffPending = false
    rt.state.status = 'running'
    pushLog(rt, 'info', 'Translation worker updated; resuming from saved translations')
  }
  const progressStamp = seedProgressStamp(contentRoot)
  if (!rt.running && rt.state.progressStamp !== progressStamp) rt.progress = undefined
  const rebuildingProgress = rt.progress == null
  const progress = rt.progress ?? getSeedTranslateProgress(contentRoot, false, true)
  rt.progress = progress
  // Keep the recovered disk progress across polling/restarts; never checkpoint a
  // scan against a fingerprint that changed while it was being read.
  if (!rt.running && rebuildingProgress && progressStamp === seedProgressStamp(contentRoot)) persist(rt)
  if (rt.state.contentRoot !== contentRoot) {
    rt.state = readDisk(contentRoot) ?? idleJob(contentRoot)
  }
  if (rt.state.status === 'running' && !rt.running) {
    ensureLoop(contentRoot)
  }
  return { ...progress, job: visibleJobState(rt.state) }
}

/** Start or resume the server-side fill loop. */
export function startSeedJob(): SeedJobSnapshot {
  const contentRoot = resolveBoundRoot()
  const current = getRuntime(contentRoot)
  if (current.running) return getSeedJobSnapshot()
  // Actions must see freshly imported seeds and cleared caches rather than stale polling progress.
  const progress = getSeedTranslateProgress(contentRoot, true, true)
  if (!progress.hasSeed || !progress.total) {
    throw new Error('Seed not found (please extract text first or provide *-trans.seed.json)')
  }
  if (!progress.missing) {
    const rt = getRuntime(contentRoot)
    rt.state.status = 'done'
    rt.state.liveStatus = '已完成'
    rt.state.error = null
    persist(rt)
    return { ...progress, job: visibleJobState(rt.state) }
  }

  let engines: string[] = []
  try {
    engines = getTranslateEngineSwitches(contentRoot).enabled
  } catch {
    engines = []
  }
  if (!engines.length) throw new Error('No translation engines are enabled')

  const rt = getRuntime(contentRoot)
  if (rt.running) return { ...progress, job: visibleJobState(rt.state) }
  rt.state.failedSources = []
  const resume = rt.state.status === 'paused' || rt.state.status === 'running'
  rt.stopRequested = false
  rt.state.contentRoot = contentRoot
  rt.state.status = 'running'
  // Invalidate persisted measurements before publishing the resumed state.
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
  pushLog(rt, 'info', `${resume ? 'Resuming' : 'Starting'} translation (engines: ${engines.join(', ')})`)
  persist(rt)
  rt.session = createSeedFillSession(contentRoot, undefined, { nonBlocking: true })
  rt.progress = rt.session.progress
  ensureLoop(contentRoot)
  return { ...rt.progress, job: visibleJobState(rt.state) }
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
  pushLog(rt, 'warn', 'Pause requested; stopping after the current batch')
  persist(rt)
  return { ...(rt.progress || getSeedTranslateProgress(contentRoot)), job: visibleJobState(rt.state) }
}
