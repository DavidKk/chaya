import { parentPort, workerData } from 'node:worker_threads'

import { createCacheScanner } from './cache-scan'

const port = parentPort!
const scanner = createCacheScanner(workerData.contentRoot, workerData.file)
port.on('message', (tasks: Array<{ id: number; src: string }>) => {
  try {
    for (const task of tasks) port.postMessage({ type: 'item', result: scanner.scan(task.id, task.src) })
    port.postMessage({ type: 'ready' })
  } catch (error) {
    port.postMessage({ type: 'failed', error: error instanceof Error ? error.message : String(error) })
  }
})
port.postMessage({ type: 'ready' })
