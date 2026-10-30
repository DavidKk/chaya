/**
 * One-shot worker_threads helper for file-IPC jobs.
 * Worker posts `{ ok: true, path }` or `{ ok: false, error }`, then is terminated.
 * Callers own reading/unlinking `path`. Never blocks with Atomics.wait.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { measureOperation, runtimeEvent } from '@/services/log/operation'
import type { TranslationRuntimeLog } from '@/services/translate/runtime-log'

export type WorkerOnceOk = { ok: true; path: string }
export type WorkerOnceFail = { ok: false; error?: string }
export type WorkerOnceMessage = WorkerOnceOk | WorkerOnceFail

export type RunWorkerOnceOptions = {
  entry: string
  workerData?: unknown
  env?: NodeJS.ProcessEnv
  /** Thrown when the bundled entry is missing (e.g. need `pnpm build:translate`). */
  missingError?: string
}

export function runWorkerOnce(options: RunWorkerOnceOptions): Promise<{ path: string }> {
  const { entry, workerData, env, missingError } = options
  return measureOperation(
    'jobs',
    'worker.run',
    { worker: path.basename(entry) },
    () =>
      new Promise<{ path: string }>((resolve, reject) => {
        if (!fs.existsSync(entry)) {
          reject(new Error(missingError || `WORKER_MISSING:${entry}`))
          return
        }
        let settled = false
        const worker = new Worker(entry, { workerData, env: { ...process.env, ...env, CHAYA_LOG_FORWARD_TO_PARENT: '1' } })
        const finish = (fn: () => void) => {
          if (settled) return
          settled = true
          void worker.terminate()
          fn()
        }
        worker.on('message', (message: WorkerOnceMessage | { type: 'translation-log'; entry: TranslationRuntimeLog }) => {
          if (message && typeof message === 'object' && 'type' in message && message.type === 'translation-log') {
            const { level, source, message: text, meta, ts } = message.entry
            runtimeEvent(level, source, text, meta as Record<string, unknown> | undefined, false, ts)
            return
          }
          finish(() => {
            if (message && 'ok' in message && message.ok === true && typeof message.path === 'string' && message.path) {
              resolve({ path: message.path })
              return
            }
            const err = message && 'ok' in message && message.ok === false ? message.error : undefined
            reject(new Error(err || 'Worker failed'))
          })
        })
        worker.once('error', (error) => finish(() => reject(error)))
        worker.once('exit', (code) => {
          if (!settled && code !== 0) finish(() => reject(new Error(`Worker exited: ${code}`)))
        })
      })
  )
}
