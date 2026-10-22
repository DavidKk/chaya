import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { PackJob } from '@/lib/translate/bergamot'
import { listPackDownloadJobs, packDownloadJob } from '@/services/translate/bergamot/download-jobs'

let root: string
let previous: string | undefined
const fixture = (patch: Partial<PackJob> = {}): PackJob => ({
  id: 'abc-123',
  planId: 'plan',
  source: 'en',
  target: 'zh',
  packIds: ['pack'],
  state: 'running',
  phase: 'downloading',
  downloadedBytes: 42,
  totalDownloadBytes: 100,
  revision: 1,
  startedAt: Date.now() - 2000,
  updatedAt: Date.now(),
  ...patch,
})
beforeEach(() => {
  previous = process.env.CHAYA_BERGAMOT_PACKS_DIR
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-downloads-test-'))
  process.env.CHAYA_BERGAMOT_PACKS_DIR = root
  fs.mkdirSync(path.join(root, 'jobs'))
})
afterEach(() => {
  if (previous === undefined) delete process.env.CHAYA_BERGAMOT_PACKS_DIR
  else process.env.CHAYA_BERGAMOT_PACKS_DIR = previous
  fs.rmSync(root, { recursive: true, force: true })
})
it('keeps the durable identity, pair and progress without exposing native errors', () => {
  const job = fixture({ error: '/private/path https://download.invalid' })
  expect(packDownloadJob(job)).toMatchObject({
    id: job.id,
    kind: 'bergamot-pack',
    source: 'en',
    target: 'zh',
    receivedBytes: 42,
    totalBytes: 100,
    status: 'running',
    phase: 'download',
    startedAt: job.startedAt,
  })
  expect(packDownloadJob(job)).not.toHaveProperty('error')
  expect(packDownloadJob(fixture({ phase: 'validating' })).phase).toBe('install')
  expect(packDownloadJob(fixture({ state: 'cancelled' })).status).toBe('canceled')
})
it('reads snapshots owned by a different worker and recovers interrupted jobs after restart', () => {
  fs.writeFileSync(path.join(root, 'jobs/abc-123.json'), JSON.stringify(fixture()))
  fs.writeFileSync(path.join(root, 'installer.lock'), JSON.stringify({ pid: process.pid }))
  expect(listPackDownloadJobs()[0].status).toBe('running')
  fs.unlinkSync(path.join(root, 'installer.lock'))
  expect(listPackDownloadJobs()[0].status).toBe('error')
})
it('retains recent completion, omits expired history and tolerates corrupt files', () => {
  fs.writeFileSync(path.join(root, 'jobs/abc-123.json'), JSON.stringify(fixture({ state: 'completed' })))
  fs.writeFileSync(path.join(root, 'jobs/def-456.json'), JSON.stringify(fixture({ id: 'def-456', state: 'failed', updatedAt: Date.now() - 3600_001 })))
  fs.writeFileSync(path.join(root, 'jobs/bad.json'), 'not json')
  expect(listPackDownloadJobs()).toHaveLength(1)
  expect(listPackDownloadJobs()[0].status).toBe('done')
})
