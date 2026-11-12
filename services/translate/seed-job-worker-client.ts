/** Main-process client for the isolated seed translation worker. */
import fs from 'node:fs'
import { Worker } from 'node:worker_threads'

import { ROOT_PATH, SEED_JOB_WORKER_PATH } from '@/constants/paths'
import { appendLog } from '@/services/log'
import { startOperation } from '@/services/log/operation'

import type { SeedJobWorkerCommand, SeedJobWorkerMessage, SeedJobWorkerRequest } from './seed-job-protocol'
import type { SeedJobSnapshot } from './seed-job-state'

type Pending = {
  resolve: (snapshot: SeedJobSnapshot) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  onTiming: (timing: SeedJobWorkerMessage['timing']) => void
}

type Client = {
  worker: Worker
  status: 'starting' | 'ready' | 'stopped'
  ready: Promise<void>
  readyResolve: () => void
  readyReject: (error: Error) => void
  readyTimer?: ReturnType<typeof setTimeout>
  pending: Map<number, Pending>
  nextId: number
  /** Set only after the main process accepted a job command; survives polls while the loop runs. */
  jobStarted: boolean
}

const globalStore = globalThis as typeof globalThis & {
  __chayaSeedJobWorkerClient?: Client
  __chayaSeedWorkerBundleStamp?: string
}

function bundleStamp(): string | null {
  try {
    if (typeof fs.statSync !== 'function') return null
    const stat = fs.statSync(SEED_JOB_WORKER_PATH)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return null
  }
}

/** True when a live worker was loaded from an older bundle. A missing stamp counts as stale. */
export function seedWorkerBundleStale(): boolean {
  const stamp = bundleStamp()
  const existing = globalStore.__chayaSeedJobWorkerClient
  return !!stamp && !!existing && existing.status !== 'stopped' && globalStore.__chayaSeedWorkerBundleStamp !== stamp
}

const COMMAND_TIMEOUT_MS = 30_000
const READY_TIMEOUT_MS = 10_000

function stop(client: Client, error: Error) {
  if (client.status === 'stopped') return
  if (client.readyTimer) clearTimeout(client.readyTimer)
  client.readyTimer = undefined
  client.status = 'stopped'
  client.readyReject(error)
  for (const pending of client.pending.values()) {
    clearTimeout(pending.timer)
    pending.reject(error)
  }
  client.pending.clear()
  if (globalStore.__chayaSeedJobWorkerClient === client) globalStore.__chayaSeedJobWorkerClient = undefined
}

function spawn(): Client {
  if (!fs.existsSync(SEED_JOB_WORKER_PATH)) throw new Error('SEED_JOB_WORKER_MISSING: run pnpm build:translate')
  let readyResolve!: () => void
  let readyReject!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  // Avoid an unhandled rejection before the first command awaits it.
  void ready.catch(() => {})
  const worker = new Worker(SEED_JOB_WORKER_PATH, {
    env: { ...process.env, CHAYA_ROOT: ROOT_PATH, CHAYA_LOG_FORWARD_TO_PARENT: '1' },
  })
  const client: Client = { worker, status: 'starting', ready, readyResolve, readyReject, pending: new Map(), nextId: 1, jobStarted: false }
  client.readyTimer = setTimeout(() => {
    stop(client, new Error(`Seed translation worker did not become ready in ${READY_TIMEOUT_MS}ms`))
    void worker.terminate()
  }, READY_TIMEOUT_MS)
  client.readyTimer.unref?.()
  worker.unref()
  worker.on('message', (message: SeedJobWorkerMessage) => {
    if (message.type === 'translation-log') {
      appendLog(message.entry)
      return
    }
    if (message.type === 'ready') {
      if (client.status !== 'starting') return
      if (client.readyTimer) clearTimeout(client.readyTimer)
      client.readyTimer = undefined
      client.status = 'ready'
      client.readyResolve()
      return
    }
    if (message.type !== 'response') return
    const pending = client.pending.get(message.id)
    if (!pending) return
    client.pending.delete(message.id)
    clearTimeout(pending.timer)
    pending.onTiming(message.timing)
    if (message.ok) pending.resolve(message.snapshot)
    else pending.reject(new Error(message.error))
  })
  worker.on('error', (error) => stop(client, error))
  worker.on('exit', (code) => {
    if (client.status !== 'stopped') stop(client, new Error(`Seed translation worker exited: ${code}`))
  })
  globalStore.__chayaSeedJobWorkerClient = client
  return client
}

async function ensureClient(): Promise<Client> {
  const stamp = bundleStamp()
  const existing = globalStore.__chayaSeedJobWorkerClient
  if (existing && existing.status !== 'stopped') {
    if (!stamp || globalStore.__chayaSeedWorkerBundleStamp === stamp) return existing
    const worker = existing.worker
    stop(existing, new Error('Seed translation worker reloaded'))
    await worker.terminate().catch(() => undefined)
  }
  const client = spawn()
  if (stamp) globalStore.__chayaSeedWorkerBundleStamp = stamp
  return client
}

export function seedJobWorkerAlive(): boolean {
  const client = globalStore.__chayaSeedJobWorkerClient
  return !!client && client.status !== 'stopped'
}

/** True when this process owns a worker that was explicitly asked to run the seed loop. */
export function seedJobWorkerStarted(): boolean {
  const client = globalStore.__chayaSeedJobWorkerClient
  return !!client && client.status !== 'stopped' && client.jobStarted
}

export function seedJobWorkerReady(): boolean {
  return globalStore.__chayaSeedJobWorkerClient?.status === 'ready'
}

export async function commandSeedJobWorker(command: SeedJobWorkerCommand, contentRoot?: string, engines?: string[]): Promise<SeedJobSnapshot> {
  const timing = startOperation('translate', 'seed.worker.roundtrip', { command }, { start: command !== 'snapshot' })
  let readyMs = 0
  let sentAt = 0
  let remote: SeedJobWorkerMessage['timing']
  try {
    const client = await ensureClient()
    await client.ready
    readyMs = timing.elapsedMs()
    if (command === 'start') client.jobStarted = true
    if (command === 'drain') client.jobStarted = false
    if (command === 'pause') client.jobStarted = false
    const snapshot = await new Promise<SeedJobSnapshot>((resolve, reject) => {
      const id = client.nextId++
      sentAt = Date.now()
      const request: SeedJobWorkerRequest = {
        type: 'request',
        id,
        command,
        requestId: timing.id,
        sentAt,
        ...(contentRoot ? { contentRoot } : {}),
        ...(engines && engines.length > 0 ? { engines } : {}),
      }
      const timer = setTimeout(() => {
        client.pending.delete(id)
        reject(new Error(`Seed translation worker did not answer "${command}" in time`))
      }, COMMAND_TIMEOUT_MS)
      timer.unref?.()
      client.pending.set(id, {
        resolve,
        reject,
        timer,
        onTiming: (value) => {
          remote = value
        },
      })
      try {
        client.worker.postMessage(request)
      } catch (error) {
        client.pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
    timing.end('completed', {
      readyMs,
      ...remote,
      outboundMs: remote ? Math.max(0, remote.receivedAt - sentAt) : undefined,
      inboundMs: remote ? Math.max(0, Date.now() - remote.respondedAt) : undefined,
    })
    return snapshot
  } catch (error) {
    timing.fail(error, { readyMs, ...remote })
    throw error
  }
}

export function resetSeedJobWorkerClientForTests() {
  const client = globalStore.__chayaSeedJobWorkerClient
  if (client) {
    if (client.readyTimer) clearTimeout(client.readyTimer)
    client.status = 'stopped'
    for (const pending of client.pending.values()) clearTimeout(pending.timer)
    client.pending.clear()
  }
  globalStore.__chayaSeedJobWorkerClient = undefined
  globalStore.__chayaSeedWorkerBundleStamp = undefined
}
