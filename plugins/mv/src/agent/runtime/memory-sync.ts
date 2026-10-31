import type { MemoryManagementState } from '@/lib/game-agent/companion/core/recording-types'

const same = (a: MemoryManagementState | null, b: MemoryManagementState) =>
  a?.memoryEpoch === b.memoryEpoch && a.recordingRevision === b.recordingRevision && a.recordingEnabled === b.recordingEnabled

/** Poll only management versions; ordinary writes must not erase another host's local overlays. */
export function createMemorySynchronization(deps: {
  ready: () => Promise<void>
  state: () => Promise<MemoryManagementState>
  storeState: () => MemoryManagementState
  recordingState: () => MemoryManagementState | null
  synchronizeStore: () => Promise<void>
  synchronizeRecording: () => Promise<void>
}) {
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let active: Promise<void> | undefined
  const synchronize = (): Promise<void> => {
    if (closed) return Promise.resolve()
    if (active) return active
    const work = async () => {
      await deps.ready()
      if (closed) return
      const state = await deps.state()
      if (closed) return
      if (!same(deps.storeState(), state)) await deps.synchronizeStore()
      if (closed) return
      if (!same(deps.recordingState(), state)) await deps.synchronizeRecording()
    }
    active = work().finally(() => {
      active = undefined
    })
    return active
  }
  const poll = () => {
    if (closed) return
    timer = setTimeout(() => {
      timer = undefined
      void synchronize()
        .catch(() => undefined)
        .finally(poll)
    }, 2_000)
  }
  const reconnect = () => {
    void synchronize().catch(() => undefined)
  }
  if (typeof window !== 'undefined') window.addEventListener('online', reconnect)
  poll()
  return {
    synchronize,
    async close() {
      closed = true
      if (timer) clearTimeout(timer)
      if (typeof window !== 'undefined') window.removeEventListener('online', reconnect)
      await active?.catch(() => undefined)
    },
  }
}
