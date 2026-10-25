import { EventEmitter } from 'node:events'
import fs from 'node:fs'

import { startCacheLane } from '@/services/translate/scheduler/cache-lane'

let mockWorker: EventEmitter & { postMessage: jest.Mock; terminate: jest.Mock }
jest.mock('node:worker_threads', () => ({ Worker: jest.fn(() => mockWorker) }))
jest.mock('@/services/translate/shared-cache/db', () => ({ defaultSharedDbPath: () => '/tmp/cache.sqlite' }))

const laneOpts = (over: Partial<Parameters<typeof startCacheLane>[0]> = {}) => ({
  contentRoot: '/tmp/game',
  next: () => [],
  onResult: jest.fn(),
  onBatchDone: jest.fn(),
  onItemError: jest.fn(),
  onStampAdvanced: jest.fn(),
  onError: jest.fn(),
  ...over,
})

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
  const lane = startCacheLane(laneOpts({ onError }))
  expect(onError).toHaveBeenCalledWith('CACHE_WORKER_MISSING')
  await lane.close()
})

it('gives up a stalled cache lane without blocking translation dispatch', async () => {
  const onError = jest.fn()
  const lane = startCacheLane(laneOpts({ onError }))
  await jest.advanceTimersByTimeAsync(5000)
  expect(onError).toHaveBeenCalledWith('Cache worker made no progress for 5000ms')
  expect(mockWorker.terminate).toHaveBeenCalledTimes(1)
  await lane.close()
})

it.each(['item', 'done'])('soft-fails when the %s callback throws', async (type) => {
  const throws = () => {
    throw new Error('Cache callback failed')
  }
  const onError = jest.fn()
  const lane = startCacheLane(
    laneOpts({
      next: () => [{ id: 0, src: 'Hello' }],
      onResult: throws,
      onBatchDone: throws,
      onError,
    })
  )
  lane.setLease('lease-1')
  mockWorker.emit('message', { type: 'ready', protocolVersion: 1 })
  expect(() => mockWorker.emit('message', { type, batchId: 1, leaseId: 'lease-1', result: { id: 0 } })).not.toThrow()
  expect(onError).toHaveBeenCalledWith('Cache callback failed')
  expect(mockWorker.terminate).toHaveBeenCalledTimes(1)
  await lane.close()
})

it('does not dispatch until the new worker handshake arrives, then posts a batch', async () => {
  const next = jest.fn().mockReturnValue([{ id: 0, src: 'Hello' }])
  const onError = jest.fn()
  const lane = startCacheLane(laneOpts({ next, onError }))
  lane.setLease('lease-1')
  mockWorker.emit('message', { type: 'ready', protocolVersion: 1 })
  expect(mockWorker.postMessage).toHaveBeenCalledTimes(1)
  expect(mockWorker.postMessage.mock.calls[0][0]).toMatchObject({ batchId: 1, leaseId: 'lease-1', tasks: [{ id: 0, src: 'Hello' }] })
  await lane.close()
})

it('treats new-worker `ready` as init only; `done` releases the in-flight shard', async () => {
  const next = jest
    .fn()
    .mockReturnValueOnce([{ id: 0, src: 'Hello' }])
    .mockReturnValue([])
  const onBatchDone = jest.fn()
  const lane = startCacheLane(laneOpts({ next, onBatchDone }))
  lane.setLease('lease-1')
  mockWorker.emit('message', { type: 'ready', protocolVersion: 1 })
  expect(onBatchDone).not.toHaveBeenCalled()
  mockWorker.emit('message', { type: 'done', batchId: 1, leaseId: 'lease-1', elapsedMs: 1 })
  expect(onBatchDone).toHaveBeenCalledWith(1, 'lease-1', 1)
  await lane.close()
})

it('drops stale-lease results but accepts current-lease results', async () => {
  const next = jest
    .fn()
    .mockReturnValueOnce([{ id: 0, src: 'Hello' }])
    .mockReturnValue([])
  const onResult = jest.fn()
  const lane = startCacheLane(laneOpts({ next, onResult }))
  lane.setLease('new')
  mockWorker.emit('message', { type: 'ready', protocolVersion: 1 })
  mockWorker.emit('message', { type: 'item', batchId: 1, leaseId: 'old', result: { id: 0 } })
  expect(onResult).not.toHaveBeenCalled()
  mockWorker.emit('message', { type: 'item', batchId: 1, leaseId: 'new', result: { id: 1 } })
  expect(onResult).toHaveBeenCalledWith({ id: 1 }, 1, 'new')
  await lane.close()
})

it('releases a stale lease batch without delivering it or blocking the new lease', async () => {
  const next = jest
    .fn()
    .mockReturnValueOnce([{ id: 0, src: 'Old' }])
    .mockReturnValueOnce([{ id: 1, src: 'New' }])
  const onResult = jest.fn()
  const onBatchDone = jest.fn()
  const lane = startCacheLane(laneOpts({ next, onResult, onBatchDone }))
  lane.setLease('old')
  mockWorker.emit('message', { type: 'ready', protocolVersion: 1 })
  lane.setLease('new')
  mockWorker.emit('message', { type: 'done', batchId: 1, leaseId: 'old', elapsedMs: 1 })
  expect(onResult).not.toHaveBeenCalled()
  expect(onBatchDone).not.toHaveBeenCalled()
  expect(mockWorker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ leaseId: 'new', tasks: [{ id: 1, src: 'New' }] }))
  await lane.close()
})

it('rejects an unversioned worker instead of treating `ready` as batch completion', async () => {
  const onError = jest.fn()
  const lane = startCacheLane(laneOpts({ onError }))
  mockWorker.emit('message', { type: 'ready' })
  expect(onError).toHaveBeenCalledWith('Cache worker protocol unsupported: missing')
  await lane.close()
})

it('joins repeated close calls until the worker has actually terminated', async () => {
  let finish: (code: number) => void = () => {}
  mockWorker.terminate.mockImplementation(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve
      })
  )
  const lane = startCacheLane(laneOpts())
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
  const lane = startCacheLane(laneOpts({ next, onResult }))
  try {
    lane.setLease('lease-1')
    oldWorker.emit('message', { type: 'ready', protocolVersion: 1 })
    oldWorker.emit('message', { type: 'item', batchId: 1, leaseId: 'lease-1', result: { id: 0 } })
    stat.mockReturnValue({ ino: 1, size: 2, mtimeMs: 2 } as fs.Stats)
    mockWorker = Object.assign(new EventEmitter(), { postMessage: jest.fn(), terminate: jest.fn(async () => 0) })
    oldWorker.emit('message', { type: 'done', batchId: 1, leaseId: 'lease-1', elapsedMs: 1 })
    expect(oldWorker.terminate).toHaveBeenCalledTimes(1)
    mockWorker.emit('message', { type: 'ready', protocolVersion: 1 })
    expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ tasks: [{ id: 1, src: 'Welcome' }] }))
    oldWorker.emit('message', { type: 'item', batchId: 2, leaseId: 'lease-1', result: { id: 99 } })
    expect(onResult).toHaveBeenCalledTimes(1)
  } finally {
    await lane.close()
    stat.mockRestore()
  }
})
