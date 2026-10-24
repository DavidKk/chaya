import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runWorkerOnce, shouldDemoteOrphanRunning, singleFlight, yieldEventLoop } from '@/services/jobs'

describe('services/jobs', () => {
  it('singleFlight shares one in-flight promise per key', async () => {
    const flights = new Map<string, Promise<number>>()
    let runs = 0
    const run = () =>
      singleFlight(flights, 'k', async () => {
        runs++
        await yieldEventLoop()
        return 7
      })
    const [a, b] = await Promise.all([run(), run()])
    expect(a).toBe(7)
    expect(b).toBe(7)
    expect(runs).toBe(1)
  })

  it('shouldDemoteOrphanRunning only when status=running and loop is dead', () => {
    expect(shouldDemoteOrphanRunning('running', { running: false })).toBe(true)
    expect(shouldDemoteOrphanRunning('running', { running: false, preparing: true })).toBe(false)
    expect(shouldDemoteOrphanRunning('running', { running: true })).toBe(false)
    expect(shouldDemoteOrphanRunning('paused', { running: false })).toBe(false)
  })

  it('runWorkerOnce returns file path from a one-shot worker', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-jobs-'))
    const entry = path.join(dir, 'once.mjs')
    const out = path.join(dir, 'out.json')
    fs.writeFileSync(
      entry,
      `
import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
fs.writeFileSync(workerData.out, JSON.stringify({ ok: true }))
parentPort.postMessage({ ok: true, path: workerData.out })
`
    )
    try {
      const { path: resultPath } = await runWorkerOnce({
        entry,
        workerData: { out },
        missingError: 'TEST_WORKER_MISSING',
      })
      expect(resultPath).toBe(out)
      expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual({ ok: true })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runWorkerOnce rejects when entry is missing', async () => {
    await expect(runWorkerOnce({ entry: path.join(os.tmpdir(), `missing-${Date.now()}.mjs`), missingError: 'GONE' })).rejects.toThrow('GONE')
  })
})
