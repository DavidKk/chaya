import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { CACHE_WORKER_PATH, TRANSLATE_JOBS_DIR } from '@/constants/paths'

import type { SeedProgress } from './fill-missing'

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
  performance: import('@/lib/translate/remain-eta').TranslationPerformance | null
  progress?: SeedProgress
  seedStamp?: string
  progressStamp?: string
  liveStatus: string
  error: string | null
  engines: string[]
  logs: SeedJobLogEntry[]
  failedSources: string[]
  /** Worker is building inventory for Start/Continue or an explicit refresh. */
  inventoryPreparing?: boolean
}

export type SeedJobSnapshot = SeedProgress & {
  job: SeedJobState
  /** Seed/cache files changed since the last checkpoint; counts are the previous snapshot until the user refreshes or starts a job. */
  stale?: boolean
  /** Inventory is building off the request thread (Start/Continue). */
  preparing?: boolean
}

export const MAX_SEED_JOB_LOGS = 120

export function idleSeedJob(contentRoot = ''): SeedJobState {
  return {
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
    inventoryPreparing: false,
  }
}

export function emptySeedProgress(contentRoot: string): SeedProgress {
  return {
    contentRoot,
    hasSeed: false,
    total: 0,
    done: 0,
    missing: 0,
    needCount: 0,
    skipCount: 0,
    needChars: 0,
    skipChars: 0,
    missingChars: 0,
    doneChars: 0,
    lines: 0,
    batchSize: 40,
    batchesLeft: 0,
  }
}

function seedJobKey(contentRoot: string) {
  return createHash('sha1').update(path.resolve(contentRoot)).digest('hex').slice(0, 16)
}

export function seedJobFile(contentRoot: string) {
  return path.join(TRANSLATE_JOBS_DIR, `${seedJobKey(contentRoot)}.json`)
}

export function readSeedJobState(contentRoot: string): SeedJobState | null {
  const file = seedJobFile(contentRoot)
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SeedJobState>
    if (!raw || typeof raw !== 'object') return null
    return {
      ...idleSeedJob(contentRoot),
      ...raw,
      contentRoot,
      failedSources: Array.isArray(raw.failedSources) ? raw.failedSources.filter((s): s is string => typeof s === 'string') : [],
      logs: Array.isArray(raw.logs) ? raw.logs.slice(-MAX_SEED_JOB_LOGS) : [],
    }
  } catch {
    return null
  }
}

export function writeSeedJobState(state: SeedJobState) {
  fs.mkdirSync(TRANSLATE_JOBS_DIR, { recursive: true })
  const file = seedJobFile(state.contentRoot)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

function isObsoleteCacheWorkerLog(text: string) {
  if (/Cannot find module .+chaya-cache-worker/i.test(text)) return true
  if (fs.existsSync(CACHE_WORKER_PATH) && /Cache scan unavailable:.*(?:worker not built|CACHE_WORKER_MISSING|chaya-cache-worker)/i.test(text)) return true
  return false
}

export function visibleSeedJobState(state: SeedJobState): SeedJobState {
  const logs =
    process.env.CHAYA_TRANSLATE_DEBUG === '1'
      ? state.logs
      : state.logs.filter(
          (entry) =>
            !isObsoleteCacheWorkerLog(entry.text) &&
            !/^\[translation-timing\]|^Requesting batch |^\.\.\. \d+ additional items omitted|^Skipping \d+ failed items this round/.test(entry.text) &&
            !(entry.level === 'ok' && entry.text.includes(' → '))
        )
  return { ...state, logs: [...logs] }
}

/** Drop sticky worker-module errors from the persisted job. */
export function scrubSeedJobLogs(state: SeedJobState): boolean {
  const next = state.logs.filter((entry) => !/Cannot find module .+chaya-cache-worker/i.test(entry.text))
  if (next.length === state.logs.length) return false
  state.logs = next
  return true
}
