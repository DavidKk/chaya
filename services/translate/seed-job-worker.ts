/** Isolated seed translation worker: all translation, SQLite and game-file writes stay off Next.js. */
import { parentPort } from 'node:worker_threads'

import { SEED_JOB_WORKER_VERSION, type SeedJobWorkerMessage, type SeedJobWorkerRequest } from './seed-job-protocol'
import { getSeedJobSnapshot, pauseSeedJob, refreshSeedJobProgress, startSeedJob } from './seed-job-runtime'

const port = parentPort
if (!port) throw new Error('seed-job-worker: missing parent port')

const post = (message: SeedJobWorkerMessage) => port.postMessage(message)

port.on('message', (request: SeedJobWorkerRequest) => {
  if (!request || request.type !== 'request') return
  try {
    const opts = request.contentRoot ? { contentRoot: request.contentRoot } : undefined
    const snapshot =
      request.command === 'refresh'
        ? refreshSeedJobProgress(opts)
        : request.command === 'start'
          ? startSeedJob(opts)
          : request.command === 'pause'
            ? pauseSeedJob(opts)
            : getSeedJobSnapshot(opts)
    post({ type: 'response', id: request.id, ok: true, snapshot })
  } catch (error) {
    post({ type: 'response', id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})

post({ type: 'ready', version: SEED_JOB_WORKER_VERSION })
