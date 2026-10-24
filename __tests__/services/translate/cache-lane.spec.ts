import { EventEmitter } from 'node:events'
import fs from 'node:fs'

import { startCacheLane } from '@/services/translate/scheduler/cache-lane'

let mockWorker: EventEmitter & { postMessage: jest.Mock; terminate: jest.Mock }
jest.mock('node:worker_threads', () => ({ Worker: jest.fn(() => mockWorker) }))
jest.mock('@/services/translate/shared-cache/db', () => ({ defaultSharedDbPath: () => '/tmp/cache.sqlite' }))

beforeEach(() => {
  jest.useFakeTimers()
  mockWorker = Object.assign(new EventEmitter(), { postMessage: jest.fn(), terminate: jest.fn(async () => 0) })
  jest.spyOn(fs, 'existsSync').mockReturnValue(true)
})
afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

it('soft-fails when the built cache worker is missing so engines can continue', async () => {
  jest.spyOn(fs, 'existsSync').mockReturnValue(false)
  const onError = jest.fn()
  const lane = startCacheLane({ contentRoot: '/tmp/game', next: () => [{ id: 0, src: 'Hi' }], onResult: jest.fn(), onError })
  expect(onError).toHaveBeenCalledWith('CACHE_WORKER_MISSING')
  await lane.close()
})

it('gives up a stalled cache lane without blocking translation dispatch', async () => {
  const onError = jest.fn()
  const lane = startCacheLane({ contentRoot: '/tmp/game', next: () => [], onResult: jest.fn(), onError })
  await jest.advanceTimersByTimeAsync(5000)
  expect(onError).toHaveBeenCalledWith('Cache worker made no progress for 5000ms')
  expect(mockWorker.terminate).toHaveBeenCalledTimes(1)
  await lane.close()
})

it('pauses IPC when the result buffer is full and resumes without an idle timeout', async () => {
  const next = jest
    .fn()
    .mockReturnValueOnce(null)
    .mockReturnValueOnce([{ id: 0, src: 'Hello' }])
    .mockReturnValue([])
  const onError = jest.fn()
  const lane = startCacheLane({ contentRoot: '/tmp/game', next, onResult: jest.fn(), onError })
  mockWorker.emit('message', { type: 'ready' })
  await jest.advanceTimersByTimeAsync(10000)
  expect(onError).not.toHaveBeenCalled()
  expect(mockWorker.postMessage).not.toHaveBeenCalled()
  lane.wake()
  expect(mockWorker.postMessage).toHaveBeenCalledWith([{ id: 0, src: 'Hello' }])
  mockWorker.emit('message', { type: 'ready' })
  await lane.close()
  expect(mockWorker.terminate).toHaveBeenCalledTimes(1)
})

it('joins repeated close calls until the worker has actually terminated', async () => {
  let finish: (code: number) => void = () => {}
  mockWorker.terminate.mockImplementation(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve
      })
  )
  const lane = startCacheLane({ contentRoot: '/tmp/game', next: () => [], onResult: jest.fn(), onError: jest.fn() })
  const first = lane.close()
  const second = lane.close()
  expect(second).toBe(first)
  finish(0)
  await second
})

it('reloads an updated worker only after its current chunk is drained', async () => {
  const stat = jest.spyOn(fs, 'statSync').mockReturnValue({ ino: 1, size: 1, mtimeMs: 1 } as fs.Stats)
  const oldWorker = mockWorker
  const onResult = jest.fn()
  const next = jest
    .fn()
    .mockReturnValueOnce([{ id: 0, src: 'Hello' }])
    .mockReturnValueOnce([{ id: 1, src: 'Welcome' }])
  const lane = startCacheLane({ contentRoot: '/tmp/game', next, onResult, onError: jest.fn() })
  try {
    oldWorker.emit('message', { type: 'ready' })
    oldWorker.emit('message', { type: 'item', result: { id: 0 } })
    stat.mockReturnValue({ ino: 1, size: 2, mtimeMs: 2 } as fs.Stats)
    mockWorker = Object.assign(new EventEmitter(), { postMessage: jest.fn(), terminate: jest.fn(async () => 0) })
    oldWorker.emit('message', { type: 'ready' })
    expect(oldWorker.terminate).toHaveBeenCalledTimes(1)
    mockWorker.emit('message', { type: 'ready' })
    expect(mockWorker.postMessage).toHaveBeenCalledWith([{ id: 1, src: 'Welcome' }])
    oldWorker.emit('message', { type: 'item', result: { id: 99 } })
    expect(onResult).toHaveBeenCalledTimes(1)
  } finally {
    await lane.close()
    stat.mockRestore()
  }
})
