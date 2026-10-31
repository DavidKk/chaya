import { emptyMemorySnapshot } from '@/lib/game-agent/companion/memory-durable'
import { MemoryStaleError } from '@/lib/game-agent/companion/memory-errors'
import { createGameplayMemoryStoreWithPersistence } from '@/lib/game-agent/companion/memory-persistence'
import { createGameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { MemoryBackend, MemoryStoreSnapshot } from '@/lib/game-agent/companion/memory-types'
import type { RuntimeScope } from '@/lib/game-agent/companion/types'

const scope: RuntimeScope = { libraryGameId: 'g1', dataRevision: '1', playthroughId: 'p1', segmentId: 's1', runtimeInstanceId: 'inst-1' }
function setup() {
  let snapshot = emptyMemorySnapshot()
  const backend: MemoryBackend = {
    ready: async () => {},
    flush: async () => {},
    loadSnapshot: jest.fn(async () => structuredClone(snapshot)),
    commitBatch: jest.fn(async () => {}),
    clearQueueBarrier: jest.fn(async () => {}),
    manage: jest.fn(async (request) => {
      snapshot = {
        ...snapshot,
        memoryEpoch: snapshot.memoryEpoch + (request.action === 'clear' ? 1 : 0),
        recordingRevision: snapshot.recordingRevision + (request.action === 'set_recording' ? 1 : 0),
        recordingEnabled: request.action === 'set_recording' ? request.enabled : snapshot.recordingEnabled,
      }
      return { memoryEpoch: snapshot.memoryEpoch, recordingRevision: snapshot.recordingRevision, recordingEnabled: snapshot.recordingEnabled }
    }),
  }
  const store = createGameplayMemoryStore({ backend })
  return {
    store,
    backend,
    setSnapshot: (next: MemoryStoreSnapshot) => {
      snapshot = next
    },
  }
}

describe('service-authoritative memory management client', () => {
  it('recovers an HTTP conflict using its transported error code and sends a fresh version on retry', async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true })
    try {
      let snapshot = emptyMemorySnapshot()
      const requests: number[] = []
      const fetchImpl = jest.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method !== 'POST') return new Response(JSON.stringify({ snapshot }))
        const body = JSON.parse(String(init.body))
        const request = body.management
        requests.push(request.expectedMemoryEpoch)
        if (request.expectedMemoryEpoch !== snapshot.memoryEpoch) {
          return new Response(JSON.stringify({ error: { code: 'MEMORY_EPOCH_CHANGED', message: 'Memory management version changed' } }), { status: 409 })
        }
        snapshot = { ...snapshot, recordingEnabled: request.enabled, recordingRevision: snapshot.recordingRevision + 1 }
        return new Response(JSON.stringify({ state: snapshot }))
      }) as unknown as typeof fetch
      const store = createGameplayMemoryStoreWithPersistence('g1', 'r1', { fetchImpl })
      await store.ready()
      snapshot = emptyMemorySnapshot({ memoryEpoch: 2 })
      await expect(store.setRecording(false)).rejects.toMatchObject({ code: 'MEMORY_EPOCH_CHANGED' })
      expect(store.getStatus()).toMatchObject({ memoryEpoch: 2, persistence: 'ready' })
      await store.setRecording(false)
      expect(requests).toEqual([1, 2])
      expect(store.getStatus()).toMatchObject({ recordingEnabled: false, persistence: 'ready' })
      await store.close()
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  })

  it('recovers a definitive remote version conflict without replaying the stale request', async () => {
    const { store, backend, setSnapshot } = setup()
    await store.ready()
    setSnapshot(emptyMemorySnapshot({ memoryEpoch: 4, recordingRevision: 5 }))
    ;(backend.manage as jest.Mock).mockRejectedValueOnce(new MemoryStaleError())
    await expect(store.setRecording(false)).rejects.toThrow('stale memory epoch')
    expect(store.getStatus()).toMatchObject({ memoryEpoch: 4, recordingRevision: 5, persistence: 'ready' })
    await store.setRecording(false)
    expect(backend.manage).toHaveBeenLastCalledWith(expect.objectContaining({ expectedMemoryEpoch: 4, expectedRecordingRevision: 5 }))
    expect(store.getStatus()).toMatchObject({ recordingEnabled: false, recordingRevision: 6 })
    await store.clearMemory()
    expect(store.getStatus()).toMatchObject({ memoryEpoch: 5, persistence: 'ready' })
  })

  it('retries synchronization before management if recovery of a definitive conflict was unavailable', async () => {
    const { store, backend, setSnapshot } = setup()
    await store.ready()
    setSnapshot(emptyMemorySnapshot({ memoryEpoch: 2, recordingRevision: 3 }))
    ;(backend.manage as jest.Mock).mockRejectedValueOnce(new MemoryStaleError())
    ;(backend.loadSnapshot as jest.Mock).mockRejectedValueOnce(new Error('offline'))
    await expect(store.clearMemory()).rejects.toThrow('stale memory epoch')
    expect(await store.applyPreference('user_default', { key: 'verbosity', value: 'quiet', revision: 1, updatedAt: 1 })).toMatchObject({ applied: false })
    await store.setRecording(false)
    expect(backend.manage).toHaveBeenLastCalledWith(expect.objectContaining({ expectedMemoryEpoch: 2, expectedRecordingRevision: 3 }))
  })

  it('uses the supplied clear request identity and reloads authoritative versions', async () => {
    const { store, backend } = setup()
    await store.ready()
    await expect(store.clear(scope, 'user-clear')).resolves.toEqual({ newMemoryEpoch: 2 })
    expect(backend.manage).toHaveBeenCalledWith({ requestId: 'user-clear', action: 'clear', preferences: false, expectedMemoryEpoch: 1, expectedRecordingRevision: 1 })
    expect(backend.clearQueueBarrier).not.toHaveBeenCalled()
  })

  it('blocks local writes after a failed management call and retries the exact original request', async () => {
    const { store, backend } = setup()
    await store.ready()
    const manage = backend.manage as jest.Mock
    manage.mockRejectedValueOnce(new Error('response lost'))
    await expect(store.setRecording(scope, false, 'turn-off')).rejects.toThrow('response lost')
    expect(store.getStatus()).toMatchObject({ persistence: 'degraded', recordingEnabled: false })
    expect(await store.applyPreference('user_default', { key: 'verbosity', value: 'quiet', revision: 1, updatedAt: 1 })).toMatchObject({ applied: false })
    await expect(store.clear(scope, 'different-operation')).rejects.toThrow('synchronize')
    await store.setRecording(scope, false, 'turn-off')
    expect(manage.mock.calls[1][0]).toEqual(manage.mock.calls[0][0])
    expect(store.getStatus()).toMatchObject({ persistence: 'ready', recordingRevision: 2 })
  })

  it('offers explicit synchronization after a stale management request', async () => {
    const { store, backend, setSnapshot } = setup()
    await store.ready()
    ;(backend.manage as jest.Mock).mockRejectedValueOnce(new Error('version changed'))
    await expect(store.clear(scope, 'stale')).rejects.toThrow()
    setSnapshot(emptyMemorySnapshot({ memoryEpoch: 4, recordingRevision: 5 }))
    await store.synchronize()
    expect(store.getStatus()).toMatchObject({ persistence: 'ready', memoryEpoch: 4, recordingRevision: 5, recordingEnabled: true, pendingCount: 0 })
    await store.clear(scope, 'fresh')
    expect(backend.manage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'fresh', expectedMemoryEpoch: 4, expectedRecordingRevision: 5 }))
  })

  it('rejects concurrent management and waits for an in-flight write before the barrier', async () => {
    const { store, backend } = setup()
    await store.ready()
    let done!: () => void
    const gate = new Promise<void>((resolve) => {
      done = resolve
    })
    ;(backend.commitBatch as jest.Mock).mockImplementationOnce(() => gate)
    await store.applyPreference('user_default', { key: 'verbosity', value: 'quiet', revision: 1, updatedAt: 1 })
    // Let the scheduled flush enter its transport.
    await Promise.resolve()
    const clearing = store.clear(scope, 'first-clear')
    await Promise.resolve()
    await expect(store.clear(scope, 'second-clear')).rejects.toThrow('in progress')
    expect(backend.manage).not.toHaveBeenCalled()
    done()
    await clearing
    expect(store.getStatus()).toMatchObject({ persistence: 'ready', pendingCount: 0, memoryEpoch: 2 })
  })

  it('resynchronizes after remote fences without promoting pending data into the new version', async () => {
    const { store, backend, setSnapshot } = setup()
    await store.ready()
    ;(backend.commitBatch as jest.Mock).mockImplementation(async () => {
      setSnapshot(emptyMemorySnapshot({ memoryEpoch: 2, recordingRevision: 3 }))
      throw new Error('stale')
    })
    await store.applyPreference('user_default', { key: 'verbosity', value: 'quiet', revision: 1, updatedAt: 1 })
    await store.flush()
    expect(store.getStatus()).toMatchObject({ memoryEpoch: 2, recordingRevision: 3, pendingCount: 0 })
    expect(store.getPreference('verbosity')).toBeUndefined()
    expect(backend.commitBatch).toHaveBeenCalledTimes(1)
  })
})
