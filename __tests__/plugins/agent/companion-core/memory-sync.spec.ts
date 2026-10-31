import type { MemoryManagementState } from '@/lib/game-agent/companion/core/recording-types'
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
