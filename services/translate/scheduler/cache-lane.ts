import { statSync } from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { ROOT_PATH } from '@/constants/paths'

import { defaultSharedDbPath } from '../shared-cache/db'
import type { CacheScanResult } from './cache-scan'

export type CacheLane = { close: () => Promise<void>; wake: () => void }

/** Bounded IPC, independent full-job scanning, and worker upgrades at a drained chunk boundary. */
export function startCacheLane(options: {
  contentRoot: string
  next: () => Array<{ id: number; src: string }> | null
  onResult: (result: CacheScanResult) => void
  onError: (error: string) => void
}): CacheLane {
  const entry = path.join(ROOT_PATH, 'native/bin/chaya-cache-worker.mjs')
  const fileStamp = () => {
    try {
      const stat = statSync(entry, { throwIfNoEntry: false })
      return `${stat?.ino}:${stat?.size}:${stat?.mtimeMs}`
    } catch {
      return 'unavailable'
    }
  }
  let stamp = fileStamp()
  let closed = false,
    idle = false
  let stopping: Promise<void> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const retiring = new Set<Promise<number>>()
  let worker: Worker
  const arm = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      if (!closed) fail('Cache worker made no progress for 5000ms')
    }, 5000)
    watchdog.unref?.()
  }
  function fail(error: string) {
    options.onError(error)
    void close()
  }
  function spawn() {
    const own = new Worker(entry, { workerData: { contentRoot: options.contentRoot, file: defaultSharedDbPath() }, env: { ...process.env, CHAYA_ROOT: ROOT_PATH } })
    worker = own
    idle = false
    arm()
    own.on('message', (message: { type: string; result?: CacheScanResult; error?: string }) => {
      if (closed || own !== worker) return
      if (message.type === 'item' && message.result) {
        arm()
        try {
          options.onResult(message.result)
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error))
        }
      }
      if (message.type === 'failed') fail(message.error || 'Cache worker failed')
      if (message.type === 'ready') {
        if (watchdog) clearTimeout(watchdog)
        idle = true
        wake()
      }
    })
    own.on('error', (error) => {
      if (!closed && own === worker) fail(error.message)
    })
    own.on('exit', (code) => {
      if (own !== worker) return
      if (watchdog) clearTimeout(watchdog)
      if (!closed) fail(`Cache worker exited unexpectedly: code=${code}`)
    })
  }
  function wake() {
    if (!idle || closed) return
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
        spawn()
        return
      }
      const tasks = options.next()
      if (tasks == null) return
      if (!tasks.length) {
        void close()
        return
      }
      idle = false
      arm()
      worker.postMessage(tasks)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
  }
  function close(): Promise<void> {
    if (stopping) return stopping
    closed = true
    if (watchdog) clearTimeout(watchdog)
    stopping = Promise.allSettled([...retiring, worker.terminate()]).then(() => {})
    return stopping
  }
  spawn()
  return { close, wake }
}
