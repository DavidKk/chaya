/**
 * 服务端后台下载任务注册表：请求立即返回，页面经 SSE（`/api/downloads/stream`）看进度。
 * 同种类同时只跑一个；结束的任务保留一段时间供页面展示结果。
 * 快照写入 `data/download-jobs.json`，进程重启后恢复列表；未完成的 running → error（不可续跑）。
 *
 * 有意不进 `services/jobs`：这是下载注册表 + SSE，不是 one-shot worker / paused 孤儿语义
 *（seed/sources 用 `shouldDemoteOrphanRunning` → paused + 显式继续）。
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DOWNLOAD_JOBS_PATH } from '@/constants/paths'
import type { DownloadStatus, ServerDownloadJob, ServerDownloadKind } from '@/lib/downloads/types'

const MAX_FINISHED = 20
const FINISHED_TTL_MS = 60 * 60 * 1000
export const JOB_PUSH_THROTTLE_MS = 250
const INTERRUPTED = 'Interrupted by process restart'

export type JobEvent = { type: 'job'; job: ServerDownloadJob } | { type: 'removed'; id: string }

type Entry = {
  job: ServerDownloadJob
  abort: AbortController
  done: Promise<ServerDownloadJob>
  pushTimer?: ReturnType<typeof setTimeout>
}

type Board = { entries: Map<string, Entry>; listeners: Set<(e: JobEvent) => void>; hydrated: boolean }

const globalBoard = globalThis as typeof globalThis & { __chayaDownloadJobs?: Board }

function board(): Board {
  if (!globalBoard.__chayaDownloadJobs) {
    globalBoard.__chayaDownloadJobs = { entries: new Map(), listeners: new Set(), hydrated: false }
  }
  const b = globalBoard.__chayaDownloadJobs
  if (!b.hydrated) {
    b.hydrated = true
    hydrate(b)
  }
  return b
}

function emit(e: JobEvent): void {
  for (const listener of board().listeners) {
    try {
      listener(e)
    } catch {
      /* 单个订阅者出错不影响其它订阅者 */
    }
  }
}

function pushNow(entry: Entry): void {
  clearTimeout(entry.pushTimer)
  entry.pushTimer = undefined
  emit({ type: 'job', job: { ...entry.job } })
  persist()
}

function pushThrottled(entry: Entry): void {
  if (entry.pushTimer) return
  entry.pushTimer = setTimeout(() => {
    entry.pushTimer = undefined
    emit({ type: 'job', job: { ...entry.job } })
    persist()
  }, JOB_PUSH_THROTTLE_MS)
}

function removeEntry(id: string): void {
  const entry = board().entries.get(id)
  if (!entry) return
  clearTimeout(entry.pushTimer)
  board().entries.delete(id)
  emit({ type: 'removed', id })
  persist()
}

function prune(now = Date.now()): void {
  const finished = [...board().entries.values()].filter((e) => e.job.status !== 'running').sort((a, b) => (b.job.finishedAt ?? 0) - (a.job.finishedAt ?? 0))
  finished.forEach((e, i) => {
    if (i >= MAX_FINISHED || now - (e.job.finishedAt ?? now) > FINISHED_TTL_MS) removeEntry(e.job.id)
  })
}

function jobsFile(): string {
  return DOWNLOAD_JOBS_PATH
}

function persist(): void {
  try {
    const file = jobsFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const jobs = [...board().entries.values()].map((e) => e.job)
    const temp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temp, `${JSON.stringify({ version: 1, jobs }, null, 2)}\n`, 'utf8')
    fs.renameSync(temp, file)
  } catch {
    /* disk full / read-only — keep in-memory board */
  }
}

function hydrate(b: Board): void {
  try {
    const file = jobsFile()
    if (!fs.existsSync(file)) return
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { jobs?: ServerDownloadJob[] }
    if (!Array.isArray(raw.jobs)) return
    const now = Date.now()
    for (const job of raw.jobs) {
      if (!job || typeof job.id !== 'string' || typeof job.kind !== 'string') continue
      const restored: ServerDownloadJob = { ...job }
      // Restart orphan: downloads cannot resume mid-stream → terminal error (not paused).
      if (restored.status === 'running') {
        restored.status = 'error'
        restored.error = INTERRUPTED
        restored.finishedAt = restored.finishedAt ?? now
      }
      if (restored.finishedAt && now - restored.finishedAt > FINISHED_TTL_MS) continue
      if (b.entries.has(restored.id)) continue
      const abort = new AbortController()
      abort.abort()
      b.entries.set(restored.id, { job: restored, abort, done: Promise.resolve({ ...restored }) })
    }
    prune(now)
    persist()
  } catch {
    /* corrupt snapshot — start empty */
  }
}

export type DownloadJobPatch = Partial<Pick<ServerDownloadJob, 'phase' | 'version' | 'receivedBytes' | 'totalBytes' | 'resumedFrom'>>

export type DownloadJobControl = {
  signal: AbortSignal
  update: (patch: DownloadJobPatch) => void
}

/** 已有同种类任务在跑时直接返回它（不重复下载） */
export function startDownloadJob(
  kind: ServerDownloadKind,
  run: (ctl: DownloadJobControl) => Promise<Record<string, unknown> | void>
): { job: ServerDownloadJob; done: Promise<ServerDownloadJob>; reused: boolean } {
  prune()
  const running = findRunningEntry(kind)
  if (running) return { job: { ...running.job }, done: running.done, reused: true }

  const job: ServerDownloadJob = { id: randomUUID(), kind, status: 'running', phase: 'resolve', startedAt: Date.now() }
  const abort = new AbortController()
  const entry = { job, abort } as Entry
  const finish = (status: DownloadStatus, extra: Partial<ServerDownloadJob> = {}) => {
    Object.assign(job, extra, { status, finishedAt: Date.now() })
    pushNow(entry)
    setTimeout(prune, FINISHED_TTL_MS + 1000).unref?.()
    return { ...job }
  }
  board().entries.set(job.id, entry)
  pushNow(entry)
  entry.done = (async () => {
    try {
      const result = await run({
        signal: abort.signal,
        update: (patch) => {
          if (job.status !== 'running') return
          const phaseChanged = patch.phase != null && patch.phase !== job.phase
          Object.assign(job, patch)
          if (phaseChanged) pushNow(entry)
          else pushThrottled(entry)
        },
      })
      return finish('done', result ? { result } : {})
    } catch (err) {
      if (abort.signal.aborted) return finish('canceled')
      return finish('error', { error: err instanceof Error ? err.message : String(err) })
    }
  })()
  return { job: { ...job }, done: entry.done, reused: false }
}

function findRunningEntry(kind: ServerDownloadKind): Entry | undefined {
  for (const e of board().entries.values()) {
    if (e.job.kind === kind && e.job.status === 'running') return e
  }
  return undefined
}

export function findRunningJob(kind: ServerDownloadKind): ServerDownloadJob | undefined {
  const entry = findRunningEntry(kind)
  return entry ? { ...entry.job } : undefined
}

export function listDownloadJobs(): ServerDownloadJob[] {
  prune()
  return [...board().entries.values()].map((e) => ({ ...e.job })).sort((a, b) => b.startedAt - a.startedAt)
}

export function subscribeDownloadJobs(listener: (e: JobEvent) => void): () => void {
  board().listeners.add(listener)
  return () => {
    board().listeners.delete(listener)
  }
}

export function clearDownloadJobsForTest(): void {
  if (globalBoard.__chayaDownloadJobs) {
    for (const e of globalBoard.__chayaDownloadJobs.entries.values()) clearTimeout(e.pushTimer)
    globalBoard.__chayaDownloadJobs.entries.clear()
    globalBoard.__chayaDownloadJobs.listeners.clear()
  }
  try {
    fs.rmSync(jobsFile(), { force: true })
  } catch {
    /* */
  }
  globalBoard.__chayaDownloadJobs = undefined
}

/** Drop the in-memory board but keep the disk snapshot (simulates process restart). */
export function resetDownloadJobsBoardForTest(): void {
  if (globalBoard.__chayaDownloadJobs) {
    for (const e of globalBoard.__chayaDownloadJobs.entries.values()) clearTimeout(e.pushTimer)
  }
  globalBoard.__chayaDownloadJobs = undefined
}
