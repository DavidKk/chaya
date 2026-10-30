import fs from 'node:fs'
import path from 'node:path'

import type { ServerDownloadJob } from '@/lib/downloads/types'
import { isActivePackJob, type PackJob, packJobError } from '@/lib/translate/bergamot'

import { installedPack, packsRoot } from './store'

/** Project durable installer snapshots without exposing paths, URLs or native errors. */
export function packDownloadJob(job: PackJob): ServerDownloadJob {
  const active = isActivePackJob(job)
  return {
    id: job.id,
    kind: 'bergamot-pack',
    source: job.source,
    target: job.target,
    status: active ? 'running' : job.state === 'completed' ? 'done' : job.state === 'cancelled' ? 'canceled' : 'error',
    phase: job.state === 'queued' ? 'resolve' : job.phase === 'downloading' ? 'download' : 'install',
    receivedBytes: job.downloadedBytes,
    totalBytes: job.totalDownloadBytes,
    ...(packJobError(job) ? { error: packJobError(job) } : {}),
    startedAt: job.startedAt ?? job.updatedAt,
    finishedAt: active ? undefined : job.updatedAt,
  }
}

export function listPackDownloadJobs(): ServerDownloadJob[] {
  const root = packsRoot()
  const directory = path.join(root, 'jobs')
  let names: string[]
  try {
    names = fs.readdirSync(directory)
  } catch {
    return []
  }
  let alive = false
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(root, 'installer.lock'), 'utf8')) as { pid: number }
    if (Number.isInteger(owner.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0)
        alive = true
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'
      }
    }
  } catch {
    /* No owner remains. */
  }
  const jobs: ServerDownloadJob[] = []
  for (const name of names) {
    if (!/^[a-f0-9-]+\.json$/.test(name)) continue
    try {
      const job = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as PackJob
      if (typeof job.id !== 'string' || typeof job.source !== 'string' || typeof job.target !== 'string' || !Number.isFinite(job.updatedAt)) continue
      if (isActivePackJob(job) && !alive) job.state = installedPack(job.source, job.target) ? 'completed' : 'interrupted'
      if (!isActivePackJob(job) && Date.now() - job.updatedAt > 3600_000) continue
      jobs.push(packDownloadJob(job))
    } catch {
      /* Ignore partial or invalid snapshots. */
    }
  }
  return jobs.sort((a, b) => b.startedAt - a.startedAt).slice(0, 20)
}
