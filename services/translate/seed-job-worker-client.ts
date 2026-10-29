/** Main-process client for the isolated seed translation worker. */
import fs from 'node:fs'
import { Worker } from 'node:worker_threads'

import { ROOT_PATH, SEED_JOB_WORKER_PATH } from '@/constants/paths'

import type { SeedJobWorkerCommand, SeedJobWorkerMessage, SeedJobWorkerRequest } from './seed-job-protocol'
import type { SeedJobSnapshot } from './seed-job-state'

type Pending = {
  resolve: (snapshot: SeedJobSnapshot) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
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
    env: { ...process.env, CHAYA_ROOT: ROOT_PATH },
  })
  const client: Client = { worker, status: 'starting', ready, readyResolve, readyReject, pending: new Map(), nextId: 1, jobStarted: false }
  client.readyTimer = setTimeout(() => {
    stop(client, new Error(`Seed translation worker did not become ready in ${READY_TIMEOUT_MS}ms`))
    void worker.terminate()
  }, READY_TIMEOUT_MS)
  client.readyTimer.unref?.()
  worker.unref()
  worker.on('message', (message: SeedJobWorkerMessage) => {
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

function ensureClient(): Client {
  const existing = globalStore.__chayaSeedJobWorkerClient
  if (existing && existing.status !== 'stopped') return existing
  return spawn()
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

export async function commandSeedJobWorker(command: SeedJobWorkerCommand, contentRoot?: string): Promise<SeedJobSnapshot> {
  const client = ensureClient()
  await client.ready
  if (command === 'start') client.jobStarted = true
  if (command === 'drain') client.jobStarted = false
  if (command === 'pause') client.jobStarted = false
  return new Promise<SeedJobSnapshot>((resolve, reject) => {
    const id = client.nextId++
    const request: SeedJobWorkerRequest = { type: 'request', id, command, ...(contentRoot ? { contentRoot } : {}) }
    const timer = setTimeout(() => {
      client.pending.delete(id)
      reject(new Error(`Seed translation worker did not answer "${command}" in time`))
    }, COMMAND_TIMEOUT_MS)
    timer.unref?.()
    client.pending.set(id, { resolve, reject, timer })
    client.worker.postMessage(request)
  })
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
}
