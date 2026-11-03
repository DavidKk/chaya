import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendLogToFile, flushLogFiles, resolvePluginLogDir } from '@/services/log/file-store'
import { clearSlowHttpRequests, listSlowHttpRequests, watchSlowHttpRequest } from '@/services/log/slow-http'

let dir: string
let previousLogDir: string | undefined
let warnings: jest.SpyInstance
beforeEach(() => {
  jest.useFakeTimers()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-slow-http-'))
  previousLogDir = process.env.CHAYA_LOG_DIR
  process.env.CHAYA_LOG_DIR = dir
  warnings = jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  flushLogFiles()
  jest.useRealTimers()
  if (previousLogDir === undefined) delete process.env.CHAYA_LOG_DIR
  else process.env.CHAYA_LOG_DIR = previousLogDir
  fs.rmSync(dir, { recursive: true, force: true })
})

const watch = (requestId = 'test-id', pathname = '/game') => {
  const started = performance.now()
  return watchSlowHttpRequest({ requestId, method: 'GET', path: pathname, startedAt: Date.now() }, () => performance.now() - started)
}

it('marks a pending request early and merges its eventual completion into one row', () => {
  const finish = watch()
  jest.advanceTimersByTime(1200)
  expect(listSlowHttpRequests()).toMatchObject({ matched: 1, running: 1, requests: [{ state: 'running', elapsedMs: 1200, requestId: 'test-id' }] })
  expect(warnings).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(1300)
  finish('completed', 200, 'response-finished')
  finish('completed', 200, 'response-finished')
  expect(listSlowHttpRequests()).toMatchObject({ journalEvents: 2, matched: 1, running: 0, requests: [{ state: 'completed', elapsedMs: 2500, status: 200 }] })
  jest.advanceTimersByTime(2000)
  expect(listSlowHttpRequests().requests[0]!.elapsedMs).toBe(2500)
})

it('ignores fast responses and catches event-loop stalls even if the threshold timer has not run', () => {
  const fast = watch('fast')
  jest.advanceTimersByTime(300)
  fast('completed', 200, 'response-finished')
  const blocked = watchSlowHttpRequest({ requestId: 'blocked', method: 'GET', path: '/api/test', startedAt: Date.now() }, () => 3000)
  blocked('failed', 500, 'response-finished')
  jest.advanceTimersByTime(2000)
  expect(warnings).not.toHaveBeenCalled()
  expect(listSlowHttpRequests()).toMatchObject({ matched: 1, requests: [{ requestId: 'blocked', state: 'failed', elapsedMs: 3000 }] })
})

it('persists cancelled requests separately from ordinary logs, with compact route totals and filters', () => {
  const finish = watch()
  const second = watch('other')
  jest.advanceTimersByTime(1500)
  finish('cancelled', 200, 'connection-closed')
  second('completed', 200, 'response-finished')
  appendLogToFile({ id: 'noise', ts: Date.now(), level: 'debug', source: 'plugin', message: 'noise' })
  expect(listSlowHttpRequests({ limit: 1 })).toMatchObject({ matched: 2, returned: 1, routes: [{ method: 'GET', path: '/game', count: 2, maxMs: 1500 }] })
  expect(listSlowHttpRequests({ requestId: 'test-id' }).requests).toEqual([expect.objectContaining({ state: 'cancelled' })])
  expect(listSlowHttpRequests({ minMs: 2000 }).matched).toBe(0)
  expect(listSlowHttpRequests({ since: Date.now() }).matched).toBe(0)
  expect(resolvePluginLogDir()).toBe(dir)
})

it('keeps reused request IDs separate and labels records with no completion after a restart', () => {
  const first = watch('same')
  jest.advanceTimersByTime(1000)
  first('completed', 200, 'response-finished')
  const second = watch('same')
  jest.advanceTimersByTime(1000)
  second('completed', 200, 'response-finished')
  appendLogToFile(
    {
      id: 'previous-process',
      ts: Date.now(),
      level: 'warn',
      source: 'http.slow',
      message: 'Slow HTTP request: running',
      meta: { id: 'previous-process', requestId: 'old', method: 'GET', path: '/game', startedAt: Date.now() - 2000, elapsedMs: 1000, state: 'running' },
    },
    path.join(dir, 'slow-http')
  )
  expect(listSlowHttpRequests()).toMatchObject({ matched: 3, unfinished: 1 })
  expect(listSlowHttpRequests({ requestId: 'old' }).requests[0]).toMatchObject({ state: 'unfinished', elapsedMs: 1000 })
})

it('clears history while retaining active requests', () => {
  const finish = watch()
  jest.advanceTimersByTime(1000)
  clearSlowHttpRequests()
  expect(listSlowHttpRequests()).toMatchObject({ matched: 1, running: 1 })
  finish('completed', 200, 'response-finished')
  clearSlowHttpRequests()
  expect(listSlowHttpRequests().matched).toBe(0)
})

it('preserves slow requests even when the ordinary disk log level excludes warnings', () => {
  const previous = process.env.CHAYA_LOG_LEVEL
  process.env.CHAYA_LOG_LEVEL = 'fail'
  try {
    const finish = watch()
    jest.advanceTimersByTime(1500)
    finish('completed', 200, 'response-finished')
    expect(listSlowHttpRequests()).toMatchObject({ matched: 1, journalEvents: 2, requests: [{ state: 'completed', elapsedMs: 1500 }] })
  } finally {
    if (previous === undefined) delete process.env.CHAYA_LOG_LEVEL
    else process.env.CHAYA_LOG_LEVEL = previous
  }
})

it('bounds the active index during a flood while still saving every completion', () => {
  const finishes = Array.from({ length: 300 }, (_, i) => watch(`flood-${i}`))
  jest.advanceTimersByTime(1200)
  expect(listSlowHttpRequests()).toMatchObject({ activeCapacity: 256, running: 256, matched: 300 })
  for (const finish of finishes) finish('completed', 200, 'response-finished')
  expect(listSlowHttpRequests()).toMatchObject({ running: 0, matched: 300, unfinished: 0 })
})

it('respects custom thresholdMs for long-polling requests', () => {
  const started = performance.now()
  const finish = watchSlowHttpRequest({ requestId: 'poll-id', method: 'POST', path: '/api/runtime/agent', startedAt: Date.now() }, () => performance.now() - started, 35000)
  jest.advanceTimersByTime(26000)
  expect(listSlowHttpRequests().requests).toHaveLength(0)
  expect(warnings).not.toHaveBeenCalled()
  finish('completed', 200, 'response-finished')
  expect(listSlowHttpRequests().matched).toBe(0)
})
