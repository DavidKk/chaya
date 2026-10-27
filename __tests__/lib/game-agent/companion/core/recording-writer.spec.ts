import type { BattleRecordEvent } from '@/lib/game-agent/companion/core/recording-types'
import { CompanionRecordingWriter } from '@/lib/game-agent/companion/core/recording-writer'
import { emptyMemorySnapshot } from '@/lib/game-agent/companion/memory-durable'
import { MEMORY_PENDING_QUEUE_MAX } from '@/lib/game-agent/companion/memory-limits'
import type { MemoryStoreSnapshot, MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'

import { battleFrame, runningCoordinator } from './fixtures'

const event = (encounterId = 'enc-1'): BattleRecordEvent => ({
  kind: 'encounter_started',
  eventId: 'start',
  scope: battleFrame().stamp.scope,
  encounterId,
  at: 10,
  coverage: 'partial',
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('asynchronous recording writer', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('does not block ordinary actions while storage is unavailable or before its initial load', async () => {
    const backend = {
      loadSnapshot: jest.fn(async (): Promise<MemoryStoreSnapshot> => {
        throw new Error('offline')
      }),
      commitBatch: jest.fn(async (_batch: MemoryWriteBatch) => {}),
    }
    const writer = new CompanionRecordingWriter(backend)
    const dispatch = jest.fn()
    const { coordinator } = runningCoordinator({
      onRecord: (record) => {
        writer.enqueue(record)
      },
      onDispatchIntent: dispatch,
    })
    coordinator.onFrameUpdate(battleFrame())
    await writer.ready()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(writer.getStatus()).toMatchObject({ persistence: 'degraded', pending: 0 })
    expect(backend.commitBatch).not.toHaveBeenCalled()
    backend.loadSnapshot.mockResolvedValue(emptyMemorySnapshot())
    await writer.synchronize()
    expect(writer.enqueue(event('after-reconnect'))).toBe(true)
    await writer.close()
    expect(backend.commitBatch.mock.calls[0][0].battleRecording!.events).toHaveLength(1)
  })

  it('retries exactly the same batch identity and content after a lost response', async () => {
    const batches: MemoryWriteBatch[] = []
    const backend = {
      loadSnapshot: jest.fn(async () => emptyMemorySnapshot()),
      commitBatch: jest.fn(async (batch: MemoryWriteBatch) => {
        batches.push(structuredClone(batch))
        if (batches.length === 1) throw new Error('response lost')
      }),
    }
    const writer = new CompanionRecordingWriter(backend)
    await writer.ready()
    writer.enqueue(event())
    await expect(writer.flush()).rejects.toThrow('response lost')
    writer.enqueue(event('enc-2'))
    await writer.flush()
    expect(batches[1]).toEqual(batches[0])
    expect(batches[2].batchId).not.toBe(batches[0].batchId)
    expect(batches[2].battleRecording!.events.map((item) => item.encounterId)).toEqual(['enc-2'])
    expect(writer.getStatus()).toMatchObject({ persistence: 'ready', pending: 0 })
    await writer.close()
  })

  it('bounds the queue, drains in 128-event batches and reports evidence loss', async () => {
    const commitBatch = jest.fn(async (_batch: MemoryWriteBatch) => {})
    const writer = new CompanionRecordingWriter({ loadSnapshot: async () => emptyMemorySnapshot(), commitBatch })
    await writer.ready()
    for (let i = 0; i < MEMORY_PENDING_QUEUE_MAX; i++) expect(writer.enqueue(event(`enc-${i}`))).toBe(true)
    expect(writer.enqueue(event('overflow'))).toBe(false)
    expect(writer.getStatus()).toMatchObject({ pending: MEMORY_PENDING_QUEUE_MAX, dropped: 1 })
    await writer.close()
    expect(commitBatch.mock.calls.map(([batch]) => batch.battleRecording!.events.length)).toEqual([128, 128])
  })

  it('stops automatic retries after the retry budget despite continued observations', async () => {
    const commitBatch = jest.fn(async (_batch: MemoryWriteBatch): Promise<void> => {
      throw new Error('offline')
    })
    const writer = new CompanionRecordingWriter({ loadSnapshot: async () => emptyMemorySnapshot(), commitBatch })
    await writer.ready()
    writer.enqueue(event('first'))
    await jest.advanceTimersByTimeAsync(6200)
    expect(commitBatch).toHaveBeenCalledTimes(4)
    writer.enqueue(event('later'))
    await jest.advanceTimersByTimeAsync(10000)
    expect(commitBatch).toHaveBeenCalledTimes(4)
    expect(writer.getStatus()).toMatchObject({ persistence: 'degraded', pending: 2 })
    commitBatch.mockImplementation(async () => {})
    await writer.synchronize()
    await jest.advanceTimersByTimeAsync(200)
    expect(writer.getStatus()).toMatchObject({ persistence: 'ready', pending: 0 })
    await writer.close()
  })

  it('keeps events enqueued during a write and blocks new intake while closing', async () => {
    const gate = deferred()
    const batches: MemoryWriteBatch[] = []
    const writer = new CompanionRecordingWriter({
      loadSnapshot: async () => emptyMemorySnapshot(),
      commitBatch: async (batch) => {
        batches.push(batch)
        if (batches.length === 1) await gate.promise
      },
    })
    await writer.ready()
    writer.enqueue(event('first'))
    const flushing = writer.flush()
    writer.enqueue(event('second'))
    const closing = writer.close()
    expect(writer.enqueue(event('too-late'))).toBe(false)
    gate.resolve()
    await Promise.all([flushing, closing])
    expect(batches.flatMap((batch) => batch.battleRecording!.events.map((item) => item.encounterId))).toEqual(['first', 'second'])
    expect(writer.getStatus()).toMatchObject({ persistence: 'closed', pending: 0 })
  })

  it('discards stale queued data after a remote clear and never relabels it', async () => {
    let snapshot = emptyMemorySnapshot()
    const commitBatch = jest.fn(async (_batch: MemoryWriteBatch): Promise<void> => {
      throw new Error('stale')
    })
    const writer = new CompanionRecordingWriter({ loadSnapshot: async () => snapshot, commitBatch })
    await writer.ready()
    writer.enqueue(event('old'))
    snapshot = emptyMemorySnapshot({ memoryEpoch: 2 })
    await expect(writer.flush()).rejects.toThrow('stale')
    expect(writer.getStatus()).toMatchObject({ pending: 0, dropped: 1, versions: { memoryEpoch: 2 } })
    commitBatch.mockResolvedValue(undefined)
    writer.enqueue(event('new'))
    await writer.close()
    expect(commitBatch.mock.calls[0][0]).toMatchObject({ memoryEpoch: 1 })
    expect(commitBatch.mock.calls[1][0]).toMatchObject({ memoryEpoch: 2, battleRecording: { events: [event('new')] } })
  })

  it('synchronizes around an in-flight write and does not backfill disabled observations', async () => {
    let snapshot = emptyMemorySnapshot()
    const gate = deferred()
    const batches: MemoryWriteBatch[] = []
    const writer = new CompanionRecordingWriter({
      loadSnapshot: async () => snapshot,
      commitBatch: async (batch) => {
        batches.push(batch)
        await gate.promise
        if (batch.recordingRevision !== snapshot.recordingRevision) throw new Error('stale')
      },
    })
    await writer.ready()
    writer.enqueue(event('first'))
    const flushing = writer.flush()
    writer.enqueue(event('still-old'))
    snapshot = emptyMemorySnapshot({ recordingEnabled: false, recordingRevision: 2 })
    const syncing = writer.synchronize()
    expect(writer.enqueue(event('during-sync'))).toBe(false)
    gate.resolve()
    await expect(flushing).rejects.toThrow('stale')
    await syncing
    expect(writer.getStatus()).toMatchObject({ dropped: 2, pending: 0 })
    expect(writer.enqueue(event('disabled'))).toBe(false)
    snapshot = emptyMemorySnapshot({ recordingRevision: 3 })
    await writer.synchronize()
    writer.enqueue(event('reenabled'))
    await writer.close()
    expect(batches.at(-1)).toMatchObject({ recordingRevision: 3, battleRecording: { events: [event('reenabled')] } })
  })
})
