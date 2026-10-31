import type { MemoryManagementState } from '@/lib/game-agent/companion/core/recording-types'

const same = (a: MemoryManagementState | null, b: MemoryManagementState) =>
  a?.memoryEpoch === b.memoryEpoch && a.recordingRevision === b.recordingRevision && a.recordingEnabled === b.recordingEnabled

/** Poll only management versions; ordinary writes must not erase another host's local overlays. */
export function createMemorySynchronization(deps: {
  ready: () => Promise<void>
  state: () => Promise<MemoryManagementState>
  storeState: () => MemoryManagementState
  recordingState: () => MemoryManagementState | null
  recordingNeedsRecovery: () => boolean
  synchronizeStore: () => Promise<void>
  synchronizeRecording: () => Promise<void>
}) {
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let active: Promise<void> | undefined
  let recoveryRequested = false
  let stateUnavailable = false
  const synchronize = (recover = false): Promise<void> => {
    if (closed) return Promise.resolve()
    recoveryRequested ||= recover
    if (active) return active
    const work = async () => {
      await deps.ready()
      if (closed) return
      let state: MemoryManagementState
      try {
        state = await deps.state()
      } catch (error) {
        stateUnavailable = true
        throw error
      }
      if (closed) return
      if (!same(deps.storeState(), state)) await deps.synchronizeStore()
      if (closed) return
      // Reconnects may recover an exhausted writer even without a management version change.
      // Ordinary successful probes must leave its bounded retry policy intact.
      if (!same(deps.recordingState(), state) || ((recoveryRequested || stateUnavailable) && deps.recordingNeedsRecovery())) await deps.synchronizeRecording()
      recoveryRequested = false
      stateUnavailable = false
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
    void synchronize(true).catch(() => undefined)
  }
  if (typeof window !== 'undefined') window.addEventListener('online', reconnect)
  poll()
  return {
    synchronize: () => synchronize(true),
    async close() {
      closed = true
      if (timer) clearTimeout(timer)
      if (typeof window !== 'undefined') window.removeEventListener('online', reconnect)
      await active?.catch(() => undefined)
    },
  }
}
