import { parentPort, workerData } from 'node:worker_threads'

import { advanceGameCacheStamp } from '../game-cache-context'
import { createCacheScanner } from './cache-scan'

const port = parentPort!
const scanner = createCacheScanner(workerData.contentRoot, workerData.file)
let leaseId = ''

port.on('message', (message: { type?: string; batchId?: number; leaseId?: string; tasks?: Array<{ id: number; src: string }>; beforeStamp?: string; afterStamp?: string }) => {
  if (message.type === 'stampAdvance') {
    const applied = advanceGameCacheStamp(workerData.contentRoot, String(message.beforeStamp || ''), String(message.afterStamp || ''))
    port.postMessage({
      type: 'stampAdvanced',
      leaseId: message.leaseId || '',
      beforeStamp: message.beforeStamp,
      afterStamp: message.afterStamp,
      applied,
      reason: applied ? undefined : 'current stamp does not match beforeStamp',
    })
    return
  }
  const tasks = message.tasks
  const batchId = Number(message.batchId) || 0
  leaseId = String(message.leaseId || '')
  if (!Array.isArray(tasks) || !tasks.length) return
  const started = performance.now()
  try {
    for (const task of tasks) {
      try {
        port.postMessage({ type: 'item', batchId, leaseId, result: scanner.scan(task.id, task.src) })
      } catch (error) {
        port.postMessage({ type: 'itemError', batchId, leaseId, id: task.id, src: task.src, error: error instanceof Error ? error.message : String(error) })
      }
    }
    port.postMessage({ type: 'done', batchId, leaseId, elapsedMs: performance.now() - started })
  } catch (error) {
    port.postMessage({ type: 'failed', error: error instanceof Error ? error.message : String(error) })
  }
})
port.postMessage({ type: 'ready', protocolVersion: 1 })
