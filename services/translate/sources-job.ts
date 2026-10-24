/** Async source-string import jobs: register all keys immediately, translate in the background, search / export later. */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { TRANSLATE_JOBS_DIR } from '@/constants/paths'

import { importSharedTranslateCache } from './cache-api'
import { exportSourcesPayload, normalizeSourcesInput, type SourcesEntry, type SourcesEntryState, type SourcesInputFormat } from './import-sources'
import { liveTranslateTexts } from './live-translate'
import { openSharedCache } from './shared-cache'

export type SourcesJobStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

export type SourcesJobSnapshot = {
  jobId: string
  status: SourcesJobStatus
  format: SourcesInputFormat
  total: number
  done: number
  missing: number
  failed: number
  cached: number
  pending: number
  force: boolean
  liveStatus: string
  error: string | null
  startedAt: number | null
  updatedAt: number
  sessionTranslated: number
}

type JobDisk = {
  jobId: string
  status: SourcesJobStatus
  format: SourcesInputFormat
  force: boolean
  entries: SourcesEntry[]
  liveStatus: string
  error: string | null
  startedAt: number | null
  updatedAt: number
  sessionTranslated: number
  failedSrcs: string[]
}

type Runtime = {
  disk: JobDisk
  running: boolean
}

const BATCH = 40
const globalStore = globalThis as typeof globalThis & { __chayaSourcesJobs?: Map<string, Runtime> }
const runtimes = (globalStore.__chayaSourcesJobs ??= new Map<string, Runtime>())

function jobFile(jobId: string) {
  return path.join(TRANSLATE_JOBS_DIR, `sources-${jobId}.json`)
}

function newJobId(): string {
  return randomBytes(8).toString('hex')
}

function countStates(entries: SourcesEntry[]) {
  let done = 0
  let missing = 0
  let failed = 0
  let cached = 0
  let pending = 0
  for (const e of entries) {
    if (e.state === 'done') done += 1
    else if (e.state === 'cached') {
      cached += 1
      done += 1
    } else if (e.state === 'failed') failed += 1
    else {
      pending += 1
      missing += 1
    }
  }
  return { done, missing, failed, cached, pending, total: entries.length }
}

function toSnapshot(disk: JobDisk): SourcesJobSnapshot {
  const c = countStates(disk.entries)
  return {
    jobId: disk.jobId,
    status: disk.status,
    format: disk.format,
    total: c.total,
    done: c.done,
    missing: c.missing,
    failed: c.failed,
    cached: c.cached,
    pending: c.pending,
    force: disk.force,
    liveStatus: disk.liveStatus,
    error: disk.error,
    startedAt: disk.startedAt,
    updatedAt: disk.updatedAt,
    sessionTranslated: disk.sessionTranslated,
  }
}

function writeDisk(disk: JobDisk) {
  fs.mkdirSync(TRANSLATE_JOBS_DIR, { recursive: true })
  disk.updatedAt = Date.now()
  const file = jobFile(disk.jobId)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(disk, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

function readDisk(jobId: string): JobDisk | null {
  const file = jobFile(jobId)
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as JobDisk
    if (!raw?.jobId || !Array.isArray(raw.entries)) return null
    return raw
  } catch {
    return null
  }
}

function getRuntime(jobId: string): Runtime | null {
  let rt = runtimes.get(jobId)
  if (rt) return rt
  const disk = readDisk(jobId)
  if (!disk) return null
  rt = { disk, running: false }
  runtimes.set(jobId, rt)
  return rt
}

function applyCacheHits(entries: SourcesEntry[], force: boolean): { cached: number; prefilled: number } {
  let cached = 0
  let prefilled = 0
  const prefillMap: Record<string, string> = Object.create(null)
  for (const e of entries) {
    if (e.zh.trim()) {
      prefillMap[e.src] = e.zh
      e.state = 'done'
      prefilled += 1
    }
  }
  if (Object.keys(prefillMap).length) {
    importSharedTranslateCache(prefillMap, { overwrite: false, engine: 'import-sources' })
  }

  if (force) return { cached, prefilled }

  const cache = openSharedCache()
  try {
    for (const e of entries) {
      if (e.state !== 'pending') continue
      const hit = cache.get(e.src)
      if (typeof hit === 'string' && hit.trim()) {
        e.zh = hit
        e.state = 'cached'
        cached += 1
      }
    }
  } finally {
    cache.close()
  }
  return { cached, prefilled }
}

async function runLoop(jobId: string) {
  const rt = getRuntime(jobId)
  if (!rt || rt.running) return
  rt.running = true
  try {
    while (true) {
      const pending = rt.disk.entries.filter((e) => e.state === 'pending' && !rt.disk.failedSrcs.includes(e.src))
      if (!pending.length) {
        const left = rt.disk.entries.filter((e) => e.state === 'pending')
        if (left.length) {
          for (const e of left) e.state = 'failed'
          rt.disk.status = 'done'
          rt.disk.liveStatus = `已结束 · 失败 ${left.length} 条`
          rt.disk.error = null
        } else {
          rt.disk.status = 'done'
          rt.disk.liveStatus = `已完成 · 本会话新译 ${rt.disk.sessionTranslated} 条`
          rt.disk.error = null
        }
        writeDisk(rt.disk)
        return
      }

      const batch = pending.slice(0, BATCH)
      rt.disk.liveStatus = `正在翻译 ${batch.length} 条…`
      writeDisk(rt.disk)

      let items
      try {
        const result = await liveTranslateTexts(
          batch.map((e) => e.src),
          { force: rt.disk.force, persist: true }
        )
        items = result.items
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        rt.disk.status = 'error'
        rt.disk.error = msg
        rt.disk.liveStatus = ''
        writeDisk(rt.disk)
        return
      }

      const bySrc = new Map(items.map((it) => [it.src, it]))
      let translated = 0
      for (const e of batch) {
        const it = bySrc.get(e.src)
        if (it?.zh?.trim()) {
          e.zh = it.zh
          e.state = 'done'
          translated += 1
        } else {
          rt.disk.failedSrcs = [...new Set([...rt.disk.failedSrcs, e.src])]
          e.state = 'failed'
        }
      }
      rt.disk.sessionTranslated += translated
      writeDisk(rt.disk)

      if (!translated && batch.length) {
        // No progress this round — mark remaining failed and finish to avoid tight loop.
        for (const e of rt.disk.entries) {
          if (e.state === 'pending') e.state = 'failed'
        }
        rt.disk.status = 'done'
        rt.disk.liveStatus = `已结束 · 本轮无进展`
        writeDisk(rt.disk)
        return
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 25)
        timer.unref?.()
      })
    }
  } catch (err) {
    rt.disk.status = 'error'
    rt.disk.error = err instanceof Error ? err.message : String(err)
    rt.disk.liveStatus = ''
    writeDisk(rt.disk)
  } finally {
    rt.running = false
  }
}

function ensureLoop(jobId: string) {
  const rt = getRuntime(jobId)
  if (!rt || rt.running || rt.disk.status !== 'running') return
  void runLoop(jobId)
}

/** Explicit resume after orphan pause (status poll never auto-starts). */
export function resumeSourcesJob(jobId: string): SourcesJobSnapshot {
  const id = String(jobId ?? '').trim()
  if (!id) throw new Error('Missing jobId')
  const rt = getRuntime(id)
  if (!rt) throw new Error(`Unknown sources job: ${id}`)
  const counts = countStates(rt.disk.entries)
  if (!counts.pending) {
    rt.disk.status = 'done'
    rt.disk.liveStatus = '已全部就绪'
    rt.disk.updatedAt = Date.now()
    writeDisk(rt.disk)
    return toSnapshot(rt.disk)
  }
  rt.disk.status = 'running'
  rt.disk.liveStatus = '继续后台翻译…'
  rt.disk.updatedAt = Date.now()
  writeDisk(rt.disk)
  ensureLoop(id)
  return toSnapshot(rt.disk)
}

/** Import sources JSON: register all keys and start background translation. Returns immediately. */
export function importSourcesJob(text: string, opts?: { force?: boolean }): SourcesJobSnapshot & { jobId: string } {
  const { format, entries } = normalizeSourcesInput(text)
  const force = Boolean(opts?.force)
  const { cached, prefilled } = applyCacheHits(entries, force)
  const counts = countStates(entries)
  const jobId = newJobId()
  const disk: JobDisk = {
    jobId,
    status: counts.pending ? 'running' : 'done',
    format,
    force,
    entries,
    liveStatus: counts.pending ? `已导入 ${counts.total} 条，后台翻译中…` : `已全部就绪（缓存 ${cached} · 预填 ${prefilled}）`,
    error: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    sessionTranslated: 0,
    failedSrcs: [],
  }
  writeDisk(disk)
  runtimes.set(jobId, { disk, running: false })
  if (disk.status === 'running') ensureLoop(jobId)
  return { ...toSnapshot(disk), jobId }
}

export function getSourcesJobStatus(jobId: string): SourcesJobSnapshot {
  const id = String(jobId ?? '').trim()
  if (!id) throw new Error('Missing jobId')
  const rt = getRuntime(id)
  if (!rt) throw new Error(`Unknown sources job: ${id}`)
  // Poll must never ensureLoop — same freeze class as seed progress (docs/translation-mainthread-offload.md H1).
  if (rt.disk.status === 'running' && !rt.running) {
    rt.disk.status = 'paused'
    rt.disk.liveStatus = rt.disk.liveStatus || '已暂停（服务重启）；继续导入以恢复'
    rt.disk.updatedAt = Date.now()
    writeDisk(rt.disk)
  }
  return toSnapshot(rt.disk)
}

export type SourcesSearchResult = {
  jobId: string
  total: number
  page: number
  pageSize: number
  items: Array<{ key: string; src: string; zh: string; state: SourcesEntryState; line?: number; field?: string }>
}

export function searchSourcesJob(jobId: string, opts?: { key?: string; q?: string; page?: number; pageSize?: number }): SourcesSearchResult {
  const rt = getRuntime(String(jobId ?? '').trim())
  if (!rt) throw new Error(`Unknown sources job: ${jobId}`)
  const key = typeof opts?.key === 'string' ? opts.key.trim() : ''
  const q = typeof opts?.q === 'string' ? opts.q.trim() : ''
  let items = rt.disk.entries
  if (key) {
    items = items.filter((e) => e.key === key || e.src === key)
  } else if (q) {
    const needle = q.toLowerCase()
    items = items.filter((e) => e.key.toLowerCase().includes(needle) || e.src.toLowerCase().includes(needle) || e.zh.toLowerCase().includes(needle))
  }
  const pageSize = Math.min(Math.max(opts?.pageSize ?? 50, 1), 500)
  const page = Math.max(opts?.page ?? 1, 1)
  const start = (page - 1) * pageSize
  const slice = items.slice(start, start + pageSize).map((e) => ({
    key: e.key,
    src: e.src,
    zh: e.zh,
    state: e.state,
    ...(e.line != null ? { line: e.line } : {}),
    ...(e.field ? { field: e.field } : {}),
  }))
  return { jobId: rt.disk.jobId, total: items.length, page, pageSize, items: slice }
}

export type SourcesExportResult = {
  jobId: string
  status: SourcesJobStatus
  format: SourcesInputFormat
  total: number
  done: number
  missing: number
  failed: number
  payload: unknown
}

export function exportSourcesJob(jobId: string, opts?: { onlyDone?: boolean }): SourcesExportResult {
  const rt = getRuntime(String(jobId ?? '').trim())
  if (!rt) throw new Error(`Unknown sources job: ${jobId}`)
  // Snapshot only — do not resume the translate loop from export.
  if (rt.disk.status === 'running' && !rt.running) {
    rt.disk.status = 'paused'
    rt.disk.updatedAt = Date.now()
    writeDisk(rt.disk)
  }
  const c = countStates(rt.disk.entries)
  return {
    jobId: rt.disk.jobId,
    status: rt.disk.status,
    format: rt.disk.format,
    total: c.total,
    done: c.done,
    missing: c.missing,
    failed: c.failed,
    payload: exportSourcesPayload(rt.disk.format, rt.disk.entries, { onlyDone: Boolean(opts?.onlyDone) }),
  }
}

/** Test helper: clear in-memory runtimes (does not delete disk files). */
export function resetSourcesJobsForTests() {
  runtimes.clear()
}
