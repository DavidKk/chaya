import { existsSync, statSync } from 'node:fs'
import { Worker } from 'node:worker_threads'

import { CACHE_WORKER_PATH, ROOT_PATH } from '@/constants/paths'
import { runtimeEvent } from '@/services/log/operation'

import { defaultSharedDbPath } from '../shared-cache/db'
import type { CacheScanResult } from './cache-scan'

export type CacheScanBatch = { id: number; src: string }
export type CacheScanRequest = { batchId: number; leaseId: string; tasks: CacheScanBatch[] }

export type CacheLane = {
  close: () => Promise<void>
  wake: () => void
  setLease: (leaseId: string) => void
  stampAdvance: (leaseId: string, beforeStamp: string, afterStamp: string) => void
}

export type CacheLaneOptions = {
  contentRoot: string
  next: (leaseId: string) => CacheScanBatch[] | null
  onResult: (result: CacheScanResult, batchId: number, leaseId: string) => void
  onBatchDone: (batchId: number, leaseId: string, elapsedMs: number) => void
  onItemError: (id: number, src: string, error: string, batchId: number, leaseId: string) => void
  onStampAdvanced: (beforeStamp: string, afterStamp: string, applied: boolean) => void
  onError: (error: string) => void
}

/**
 * Long-lived shared-cache scan lane. The worker is owned per (contentRoot + database)
 * and reused across fill windows. A `ready` handshake with protocolVersion >= 1 only
 * signals initialization; batch completion arrives as a dedicated `done` message.
 */
export function startCacheLane(options: CacheLaneOptions): CacheLane {
  const entry = CACHE_WORKER_PATH
  const fileStamp = () => {
    try {
      const stat = statSync(entry, { throwIfNoEntry: false })
      return `${stat?.ino}:${stat?.size}:${stat?.mtimeMs}`
    } catch {
      return 'unavailable'
    }
  }
  let stamp = fileStamp()
  let closed = false
  let idle = false
  let stopping: Promise<void> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const retiring = new Set<Promise<number>>()
  let worker: Worker | undefined
  let ready = false
  let currentLease = ''
  let batchSeq = 0
  let inFlight: { batchId: number; leaseId: string } | undefined

  const arm = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      if (!closed) fail('Cache worker made no progress for 5000ms')
    }, 5000)
    watchdog.unref?.()
  }
  function disarm() {
    if (watchdog) clearTimeout(watchdog)
    watchdog = undefined
  }
  function fail(error: string) {
    try {
      options.onError(error)
    } finally {
      void close()
    }
  }
  function spawn() {
    if (!existsSync(entry)) {
      fail('CACHE_WORKER_MISSING')
      return
    }
    const own = new Worker(entry, {
      workerData: { contentRoot: options.contentRoot, file: defaultSharedDbPath() },
      env: { ...process.env, CHAYA_ROOT: ROOT_PATH },
    })
    worker = own
    idle = false
    ready = false
    inFlight = undefined
    arm()
    own.on('message', (message) => {
      if (closed || own !== worker) return
      if (message.type === 'translation-log') {
        const { level, source, message: text, meta, ts } = message.entry
        runtimeEvent(level, source, text, meta, false, ts)
        return
      }
      try {
        const lease = String(message.leaseId || '')
        const batchId = Number(message.batchId) || 0
        const ownsBatch = inFlight?.batchId === batchId && inFlight.leaseId === lease
        switch (message.type) {
          case 'ready': {
            const protocolVersion = Number(message.protocolVersion) || 0
            if (protocolVersion < 1) {
              fail(`Cache worker protocol unsupported: ${protocolVersion || 'missing'}`)
              return
            }
            ready = true
            idle = true
            disarm()
            void wake()
            return
          }
          case 'item':
            if (ownsBatch && lease === currentLease && message.result != null) {
              arm()
              options.onResult(message.result, batchId, lease)
            }
            return
          case 'itemError':
            if (ownsBatch && lease === currentLease) {
              arm()
              options.onItemError(Number(message.id) || 0, message.src || '', String(message.error || 'Cache scan failed'), batchId, lease)
            }
            return
          case 'done':
            // A previous lease may finish after pause/resume. Drop its business
            // result, but always release the lane and its watchdog.
            if (!ownsBatch) return
            inFlight = undefined
            idle = true
            disarm()
            if (lease === currentLease) options.onBatchDone(batchId, lease, Number(message.elapsedMs) || 0)
            void wake()
            return
          case 'stampAdvanced':
            if (lease === currentLease) {
              options.onStampAdvanced(String(message.beforeStamp || ''), String(message.afterStamp || ''), message.applied !== false)
            }
            return
          case 'failed':
            fail(String(message.error || 'Cache worker failed'))
            return
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      }
    })
    own.on('error', (error) => {
      if (!closed && own === worker) fail(error.message)
    })
    own.on('exit', (code) => {
      if (own !== worker) return
      disarm()
      if (!closed) fail(`Cache worker exited unexpectedly: code=${code}`)
    })
  }
  function wake() {
    if (closed || !worker || !idle || !ready) return
    try {
      const currentStamp = fileStamp()
      if (stamp !== currentStamp) {
        stamp = currentStamp
        const retired = worker.terminate()
        retiring.add(retired)
        void retired.then(
          () => retiring.delete(retired),
          () => retiring.delete(retired)
        )
        worker = undefined
        idle = false
        ready = false
        inFlight = undefined
        spawn()
        return
      }
      const tasks = options.next(currentLease)
      if (tasks == null || !tasks.length) return
      batchSeq += 1
      const batchId = batchSeq
      idle = false
      inFlight = { batchId, leaseId: currentLease }
      worker.postMessage({ batchId, leaseId: currentLease, tasks })
      arm()
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
  }
  function setLease(leaseId: string) {
    currentLease = leaseId
  }
  function stampAdvance(leaseId: string, beforeStamp: string, afterStamp: string) {
    if (closed || !worker) return
    worker.postMessage({ type: 'stampAdvance', leaseId, beforeStamp, afterStamp })
  }
  function close(): Promise<void> {
    if (stopping) return stopping
    closed = true
    disarm()
    stopping = Promise.allSettled([...retiring, worker?.terminate() ?? Promise.resolve(0)]).then(() => {})
    return stopping
  }
  spawn()
  return { close, wake, setLease, stampAdvance }
}
