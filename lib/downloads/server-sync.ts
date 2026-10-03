'use client'

/**
 * 服务端下载同步：EventSource 生命周期、快照合并、发起下载。
 * 只在可见标签页保持连接（HTTP/1.1 同主机 6 连接上限）；回到前台由快照补齐。
 */
import { readApiErrorMessage } from '@/lib/api-error'
import { type DownloadItem, expireDownload, getDownloads, removeDownload, requestDownloadCenterOpen, upsertDownload } from '@/lib/downloads/store'
import type { ServerDownloadJob } from '@/lib/downloads/types'
import { BUILD_TARGET } from '@/lib/service-mode/target'

const STREAM_URL = '/api/downloads/stream'

const itemId = (jobId: string) => `srv:${jobId}`

/** 本页合成的中断项（服务端已没有这个 ID） */
const synthetic = new Set<string>()
let firstSnapshotSeen = false
let refCount = 0
let source: EventSource | undefined
let teardown: (() => void) | undefined

function toItem(job: ServerDownloadJob): DownloadItem {
  return {
    id: itemId(job.id),
    channel: 'server',
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    version: job.version,
    receivedBytes: job.receivedBytes,
    totalBytes: job.totalBytes,
    resumedFrom: job.resumedFrom,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }
}

function applyJob(job: ServerDownloadJob): void {
  synthetic.delete(itemId(job.id))
  upsertDownload(toItem(job))
}

function applySnapshot(jobs: ServerDownloadJob[]): void {
  const baseline = !firstSnapshotSeen
  firstSnapshotSeen = true
  const live = new Set(jobs.map((j) => itemId(j.id)))
  for (const item of getDownloads()) {
    if (item.channel !== 'server' || live.has(item.id) || synthetic.has(item.id)) continue
    if (item.status === 'running') {
      synthetic.add(item.id)
      upsertDownload({ ...item, status: 'error', interrupted: true, error: undefined, rate: undefined, finishedAt: Date.now() })
      expireDownload(item.id)
    } else {
      removeDownload(item.id)
    }
  }
  for (const job of jobs) upsertDownload(toItem(job), undefined, { baseline })
}

function parse<T>(e: Event): T | undefined {
  try {
    return JSON.parse((e as MessageEvent<string>).data) as T
  } catch {
    return undefined
  }
}

function connect(): void {
  if (source) return
  const es = new EventSource(STREAM_URL)
  es.addEventListener('snapshot', (e) => {
    const data = parse<{ jobs: ServerDownloadJob[] }>(e)
    if (data) applySnapshot(data.jobs)
  })
  es.addEventListener('job', (e) => {
    const job = parse<ServerDownloadJob>(e)
    if (job) applyJob(job)
  })
  es.addEventListener('removed', (e) => {
    const data = parse<{ id: string }>(e)
    if (!data) return
    synthetic.delete(itemId(data.id))
    removeDownload(itemId(data.id))
  })
  source = es
}

function disconnect(): void {
  source?.close()
  source = undefined
}

/** `BUILD_TARGET !== 'edge'` 且 `/api/status` 报告 `canUseDisk` 才启用 */
export async function serverDownloadsEnabled(): Promise<boolean> {
  if (BUILD_TARGET === 'edge') return false
  try {
    const res = await fetch('/api/status', { cache: 'no-store' })
    const data = (await res.json()) as { canUseDisk?: boolean }
    return data.canUseDisk === true
  } catch {
    return false
  }
}

/** 引用计数；返回停止函数 */
export function startServerDownloadSync(): () => void {
  refCount += 1
  if (refCount === 1) {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') disconnect()
      else connect()
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (document.visibilityState !== 'hidden') connect()
    teardown = () => {
      document.removeEventListener('visibilitychange', onVisibility)
      disconnect()
    }
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    refCount -= 1
    if (refCount === 0) {
      teardown?.()
      teardown = undefined
    }
  }
}

/** `POST /api/shell { fetchLatest }`，写入存储并展开下载中心 */
export async function startServerShellDownload(): Promise<ServerDownloadJob> {
  const res = await fetch('/api/shell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fetchLatest: true }) })
  const data = (await res.json().catch(() => null)) as { job?: ServerDownloadJob } | null
  if (!res.ok || !data?.job) throw new Error(readApiErrorMessage(data, `HTTP ${res.status}`))
  applyJob(data.job)
  requestDownloadCenterOpen()
  return data.job
}

export function resetServerSyncForTest(): void {
  teardown?.()
  teardown = undefined
  refCount = 0
  synthetic.clear()
  firstSnapshotSeen = false
}
