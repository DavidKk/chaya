import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { DATA_DIR, ROOT_PATH } from '@/constants/paths'
import { mcpPortConfigDir, processMcpPortEnv } from '@/lib/integration/mcp-port'
import { startOperation } from '@/services/log/operation'

import { readStorageDaemonMeta } from './daemon-lock'

function resolveNativeBin(name: string): string {
  const root = typeof ROOT_PATH === 'string' && ROOT_PATH ? ROOT_PATH : process.cwd()
  const direct = path.join(root, 'native/bin', name)
  if (fs.existsSync(direct)) return direct
  const cwdCandidate = path.join(process.cwd(), 'native/bin', name)
  if (fs.existsSync(cwdCandidate)) return cwdCandidate
  return direct
}

function resolveDataDir(): string {
  return typeof DATA_DIR === 'string' && DATA_DIR ? DATA_DIR : path.join(process.cwd(), 'data')
}

let worker: Worker | undefined
let responseBuffer: SharedArrayBuffer | undefined
const pause = new Int32Array(new SharedArrayBuffer(4))
let locatorPublished = false
function publishLocator() {
  if (locatorPublished) return
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) return
  const dir = mcpPortConfigDir(processMcpPortEnv(os.homedir()))
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, 'storage-runtime.json')
  const tmp = `${file}.${process.pid}.tmp`
  const entry = resolveNativeBin('chaya-storage-daemon.mjs')
  const dataDir = resolveDataDir()
  const rootDir = typeof ROOT_PATH === 'string' && ROOT_PATH ? ROOT_PATH : process.cwd()
  fs.writeFileSync(tmp, JSON.stringify({ dataDir, entry, executable: process.execPath, root: rootDir }), {
    mode: 0o600,
  })
  fs.renameSync(tmp, file)
  locatorPublished = true
}

/** The daemon is a detached Node process so closing an App window cannot discard game writes. */
export function ensureStorageDaemon() {
  publishLocator()
  const dataDir = resolveDataDir()
  let meta = readStorageDaemonMeta(dataDir)
  if (meta?.port) return meta
  const entry = resolveNativeBin('chaya-storage-daemon.mjs')
  if (!fs.existsSync(entry)) throw new Error('Storage runtime is missing; run pnpm build:translate')
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      CHAYA_ROOT: typeof ROOT_PATH === 'string' && ROOT_PATH && fs.existsSync(path.join(ROOT_PATH, 'native/bin')) ? ROOT_PATH : process.cwd(),
      CHAYA_DATA_DIR: typeof DATA_DIR === 'string' && DATA_DIR ? DATA_DIR : path.join(process.cwd(), 'data'),
    },
  })
  let spawnError: Error | undefined
  child.once('error', (error) => {
    spawnError = error
  })
  child.unref()
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    meta = readStorageDaemonMeta(dataDir)
    if (meta?.port) return meta
    if (spawnError) throw spawnError
    Atomics.wait(pause, 0, 0, 25)
  }
  throw new Error('Storage daemon did not become ready')
}

/** Compatibility bridge for existing synchronous extraction/cache callers; network work runs off-thread. */
export function storageCall<T = unknown>(method: string, args: unknown[] = []): T {
  const timing = startOperation('storage', 'storage.roundtrip', { method }, { start: false })
  let readyMs = 0
  let waitMs = 0
  let decodeMs = 0
  let waiting = 0
  let remote: Record<string, number> | undefined
  try {
    const meta = ensureStorageDaemon()
    if (!worker) {
      const entry = resolveNativeBin('chaya-storage-client.mjs')
      // This is a separately built native entry; Next must not turn it into a bundled worker loader.
      worker = Reflect.construct(Worker, [entry]) as Worker
      worker.on('error', () => {
        worker = undefined
      })
      worker.unref()
    }
    const shared = (responseBuffer ??= new SharedArrayBuffer(16 * 1024 * 1024))
    const signal = new Int32Array(shared, 0, 2)
    Atomics.store(signal, 0, 0)
    Atomics.store(signal, 1, 0)
    readyMs = timing.elapsedMs()
    waiting = performance.now()
    worker.postMessage({ port: meta.port, token: meta.authToken, body: { method, args, requestId: timing.id, sentAt: Date.now() }, shared })
    if (Atomics.wait(signal, 0, 0, 125000) === 'timed-out') {
      // A late worker response must never overwrite the next request's buffer.
      responseBuffer = undefined
      throw new Error('Storage request timed out; retry with the same mutation key')
    }
    waitMs = Math.round((performance.now() - waiting) * 10) / 10
    const decoding = performance.now()
    const result = JSON.parse(Buffer.from(shared, 8, Atomics.load(signal, 1)).toString('utf8')) as { value?: T; error?: string; timing?: Record<string, number> }
    remote = result.timing
    decodeMs = Math.round((performance.now() - decoding) * 10) / 10
    if (result.error) throw new Error(result.error)
    const value = result.value as T & { storageMap?: [string, string][] }
    const restored = value?.storageMap ? (new Map(value.storageMap) as T) : value
    decodeMs = Math.round((performance.now() - decoding) * 10) / 10
    timing.end('completed', { readyMs, waitMs, decodeMs, responseBytes: Atomics.load(signal, 1), ...result.timing })
    return restored
  } catch (error) {
    if (waiting && !waitMs) waitMs = Math.round((performance.now() - waiting) * 10) / 10
    timing.fail(error, { readyMs, waitMs, decodeMs, ...remote })
    throw error
  }
}
