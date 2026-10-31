/** @jest-environment jsdom */
import { battleFrame } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import type { MemoryManagementState } from '@/lib/game-agent/companion/core/recording-types'
import { CompanionRecordingWriter } from '@/lib/game-agent/companion/core/recording-writer'
import { emptyMemorySnapshot } from '@/lib/game-agent/companion/memory-durable'
import type { MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import { createMemorySynchronization } from '@/plugins/mv/src/agent/runtime/memory-sync'

const initial = (): MemoryManagementState => ({ memoryEpoch: 1, recordingRevision: 1, recordingEnabled: true })
function setup() {
  let remote = initial()
  let local = initial()
  let writer: MemoryManagementState | null = initial()
  const deps = {
    ready: async () => {},
    state: jest.fn(async () => ({ ...remote })),
    storeState: () => local,
    recordingState: () => writer,
    recordingNeedsRecovery: jest.fn(() => false),
    synchronizeStore: jest.fn(async () => {
      local = { ...remote }
    }),
    synchronizeRecording: jest.fn(async () => {
      writer = { ...remote }
    }),
  }
  return {
    deps,
    sync: createMemorySynchronization(deps),
    change: (state: Partial<MemoryManagementState>) => {
      remote = { ...remote, ...state }
    },
    local: () => local,
  }
}
beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('ordinary changes probe versions without reloading or dropping local overlays', async () => {
  const s = setup()
  await s.sync.synchronize()
  await jest.advanceTimersByTimeAsync(2000)
  expect(s.deps.state).toHaveBeenCalledTimes(2)
  expect(s.deps.synchronizeStore).not.toHaveBeenCalled()
  expect(s.deps.synchronizeRecording).not.toHaveBeenCalled()
  await s.sync.close()
  await jest.advanceTimersByTimeAsync(4000)
  expect(s.deps.state).toHaveBeenCalledTimes(2)
})

test('remote clear and recording changes refresh both clients; failed sync retries next poll', async () => {
  const s = setup()
  s.change({ memoryEpoch: 2, recordingRevision: 3, recordingEnabled: false })
  s.deps.synchronizeStore.mockRejectedValueOnce(new Error('offline'))
  await expect(s.sync.synchronize()).rejects.toThrow('offline')
  expect(s.deps.synchronizeRecording).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(2000)
  expect(s.local()).toEqual({ memoryEpoch: 2, recordingRevision: 3, recordingEnabled: false })
  expect(s.deps.synchronizeRecording).toHaveBeenCalledTimes(1)
  await s.sync.close()
})

test('concurrent synchronization coalesces and close prevents a late reload', async () => {
  const s = setup()
  let finish!: (value: MemoryManagementState) => void
  s.deps.state.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const first = s.sync.synchronize()
  expect(s.sync.synchronize()).toBe(first)
  await Promise.resolve()
  const closing = s.sync.close()
  finish({ ...initial(), memoryEpoch: 2 })
  await Promise.all([first, closing])
  expect(s.deps.synchronizeStore).not.toHaveBeenCalled()
})

test('an online event joining an active poll retains its recovery request', async () => {
  const s = setup()
  s.deps.recordingNeedsRecovery.mockReturnValue(true)
  let finish!: (value: MemoryManagementState) => void
  s.deps.state.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await jest.advanceTimersByTimeAsync(2000)
  window.dispatchEvent(new Event('online'))
  finish(initial())
  await jest.advanceTimersByTimeAsync(0)
  expect(s.deps.state).toHaveBeenCalledTimes(1)
  expect(s.deps.synchronizeRecording).toHaveBeenCalledTimes(1)
  expect(s.deps.synchronizeStore).not.toHaveBeenCalled()
  await s.sync.close()
})

test.each(['explicit', 'online', 'state recovery'] as const)('%s reconnect resumes exhausted recording without changing versions or batch identity', async (reconnect) => {
  const s = setup()
  const commitBatch = jest.fn(async (_batch: MemoryWriteBatch): Promise<void> => {
    throw new Error('offline')
  })
  const writer = new CompanionRecordingWriter({ loadSnapshot: async () => emptyMemorySnapshot(), commitBatch })
  await writer.ready()
  await s.sync.close()
  const sync = createMemorySynchronization({
    ...s.deps,
    recordingState: () => writer.getStatus().versions,
    recordingNeedsRecovery: () => writer.getStatus().persistence === 'degraded',
    synchronizeRecording: () => writer.synchronize(),
  })
  writer.enqueue({
    kind: 'encounter_started',
    eventId: 'start',
    encounterId: 'enc-1',
    scope: battleFrame().stamp.scope,
    at: 10,
    coverage: 'partial',
  })
  await jest.advanceTimersByTimeAsync(6200)
  expect(commitBatch).toHaveBeenCalledTimes(4)
  await jest.advanceTimersByTimeAsync(10000)
  expect(commitBatch).toHaveBeenCalledTimes(4)
  expect(writer.getStatus()).toMatchObject({ persistence: 'degraded', pending: 1 })
  if (reconnect === 'state recovery') {
    s.deps.state.mockRejectedValueOnce(new Error('service offline'))
    await jest.advanceTimersByTimeAsync(2000)
  }
  commitBatch.mockResolvedValue(undefined)
  if (reconnect === 'explicit') await sync.synchronize()
  else if (reconnect === 'online') window.dispatchEvent(new Event('online'))
  await jest.advanceTimersByTimeAsync(2200)
  expect(writer.getStatus()).toMatchObject({ persistence: 'ready', pending: 0 })
  expect(commitBatch).toHaveBeenCalledTimes(5)
  expect(commitBatch.mock.calls[4][0]).toEqual(commitBatch.mock.calls[0][0])
  expect(s.deps.synchronizeStore).not.toHaveBeenCalled()
  await sync.close()
  await writer.close()
})
