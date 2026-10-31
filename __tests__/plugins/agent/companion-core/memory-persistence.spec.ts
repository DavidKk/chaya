import type { BattleRecordEvent } from '@/lib/game-agent/companion/core/recording-types'
import { emptyMemorySnapshot } from '@/lib/game-agent/companion/memory-durable'
import type { MemoryStoreSnapshot, MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import { createCompanionMemoryRuntime } from '@/plugins/mv/src/agent/runtime/memory-persistence'
import { pluginStorageCall } from '@/plugins/mv/src/helpers/storage/client'

jest.mock('@/plugins/mv/src/helpers/game/game-identity', () => ({ detectGameIdentity: () => ({ contentRoot: '/tmp/test-recording' }) }))
jest.mock('@/plugins/mv/src/helpers/storage/client', () => ({ pluginStorageCall: jest.fn() }))
jest.mock('@/plugins/mv/src/helpers/storage/pending', () => ({ flushPendingStorage: jest.fn(), queueStorageMutation: jest.fn() }))

const scope = { libraryGameId: 'g1', dataRevision: '1', playthroughId: 'p1', runtimeInstanceId: 'i1', segmentId: 's1' }
const finish: BattleRecordEvent = { scope, encounterId: 'e1', at: 10, kind: 'encounter_finished', eventId: 'f1', outcome: 'win', turns: 1 }

test('plugin runtime projects only durable acknowledgements and recovers failed batches on retry', async () => {
  let snapshot: MemoryStoreSnapshot = emptyMemorySnapshot()
  let acknowledge!: () => void
  let fail = false
  const call = pluginStorageCall as jest.Mock
  call.mockImplementation(async (method: string, args: unknown[]) => {
    if (method === 'companion.load') return structuredClone(snapshot)
    if (method === 'companion.state') return snapshot
    if (method !== 'companion.commit') throw new Error(method)
    const batch = args[1] as MemoryWriteBatch
    await new Promise<void>((resolve) => {
      acknowledge = resolve
    })
    if (fail) throw new Error('storage offline')
    snapshot = {
      ...snapshot,
      battleRecording: { schemaVersion: 1, projectionVersion: 1, coverage: 'observed_only', statistics: [], detailsTrimmed: false, recentEvents: batch.battleRecording!.events },
    }
  })
  const runtime = createCompanionMemoryRuntime('g1', 'i1', false)
  await runtime.ready()
  try {
    expect(runtime.recording.enqueue(finish)).toBe(true)
    const first = runtime.recording.flush()
    expect(runtime.store.getEpisodeRecords()).toEqual([])
    acknowledge()
    await first
    expect(runtime.store.getEpisodeRecords()).toEqual([expect.objectContaining({ outcome: 'win', persistence: 'committed' })])
    expect(runtime.recording.enqueue({ ...finish, encounterId: 'e2', eventId: 'f2' })).toBe(true)
    fail = true
    const failed = runtime.recording.flush()
    acknowledge()
    await expect(failed).rejects.toThrow('storage offline')
    expect(runtime.store.getEpisodeRecords()).toHaveLength(1)
    fail = false
    const retry = runtime.recording.flush()
    acknowledge()
    await retry
    expect(runtime.store.getEpisodeRecords()).toHaveLength(2)
    expect(call.mock.calls.filter(([method]) => method === 'companion.commit')).toHaveLength(3)
  } finally {
    await runtime.close()
  }
})

test('runtime synchronization recovers an exhausted writer at the same management versions', async () => {
  jest.useFakeTimers()
  const snapshot = emptyMemorySnapshot()
  let offline = true
  const batches: MemoryWriteBatch[] = []
  const call = pluginStorageCall as jest.Mock
  call.mockImplementation(async (method: string, args: unknown[]) => {
    if (method === 'companion.load' || method === 'companion.state') return structuredClone(snapshot)
    if (method !== 'companion.commit') throw new Error(method)
    batches.push(args[1] as MemoryWriteBatch)
    if (offline) throw new Error('storage offline')
  })
  const runtime = createCompanionMemoryRuntime('g1', 'i1', false)
  try {
    await runtime.ready()
    runtime.recording.enqueue(finish)
    await jest.advanceTimersByTimeAsync(16200)
    expect(batches).toHaveLength(4)
    expect(runtime.store.getEpisodeRecords()).toEqual([])
    offline = false
    await runtime.synchronize()
    await jest.advanceTimersByTimeAsync(200)
    expect(batches).toHaveLength(5)
    expect(batches[4]).toEqual(batches[0])
    expect(runtime.recording.getStatus()).toMatchObject({ persistence: 'ready', pending: 0 })
    expect(runtime.store.getEpisodeRecords()).toEqual([expect.objectContaining({ outcome: 'win', persistence: 'committed' })])
  } finally {
    offline = false
    await runtime.close()
    jest.useRealTimers()
  }
})
