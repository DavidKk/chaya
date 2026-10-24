/**
 * Poll-safe orphan rule for persisted jobs:
 * disk/memory says `running` but the in-process loop is not alive → treat as paused.
 * Never auto-resume from status polls (Start/Continue must be explicit).
 */
export type JobLifecycleStatus = 'idle' | 'preparing' | 'running' | 'paused' | 'done' | 'error'

export function shouldDemoteOrphanRunning(status: string, opts: { running: boolean; preparing?: boolean }): boolean {
  return status === 'running' && !opts.running && !opts.preparing
}
