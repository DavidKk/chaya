import { onAgentAuthChange } from './auth-change.server'

export type WarmHandle<T> = { value: T; alive: () => boolean; dispose: () => void | Promise<void> }

type Target = { key: string; profileId: string; provider: string }
type Entry = WarmHandle<unknown> & Target & { epoch: string; timer?: ReturnType<typeof setTimeout> }

/** Idle CLI processes die after this long; a busy companion keeps reusing one. */
export const WARM_IDLE_MS = 5 * 60_000

const idle = new Map<string, Entry>()
const epochs = new Map<string, number>()

/** Bumped on every auth change so a process that was busy at the time is not parked with old credentials. */
function epochOf(target: { profileId: string; provider: string }) {
  return `${epochs.get(`profile:${target.profileId}`) || 0}:${epochs.get(`provider:${target.provider}`) || 0}`
}

function dispose(entry: Entry) {
  clearTimeout(entry.timer)
  if (idle.get(entry.key) === entry) idle.delete(entry.key)
  void Promise.resolve()
    .then(() => entry.dispose())
    .catch(() => undefined)
}

function park(entry: Entry) {
  if (!entry.alive() || idle.has(entry.key) || entry.epoch !== epochOf(entry)) return dispose(entry)
  entry.timer = setTimeout(() => dispose(entry), WARM_IDLE_MS)
  entry.timer.unref?.()
  idle.set(entry.key, entry)
}

/**
 * Runs `run` on a warm CLI process for this instance, starting one when none is idle. At most one idle process per
 * key; concurrent callers get their own and the extra is closed afterwards. A failed round never returns its process.
 */
export async function withWarmCli<T, R>(target: Target, create: () => Promise<WarmHandle<T>>, run: (value: T) => Promise<R>): Promise<R> {
  let entry = idle.get(target.key)
  if (entry) {
    idle.delete(target.key)
    clearTimeout(entry.timer)
    if (!entry.alive()) {
      dispose(entry)
      entry = undefined
    }
  }
  if (!entry) {
    const epoch = epochOf(target)
    entry = { ...(await create()), ...target, epoch }
  }
  try {
    const result = await run(entry.value as T)
    park(entry)
    return result
  } catch (error) {
    dispose(entry)
    throw error
  }
}

export function disposeWarmCli(match: (entry: { profileId: string; provider: string }) => boolean = () => true) {
  for (const entry of [...idle.values()]) if (match(entry)) dispose(entry)
}

onAgentAuthChange((change) => {
  const key = 'profileId' in change ? `profile:${change.profileId}` : `provider:${change.provider}`
  epochs.set(key, (epochs.get(key) || 0) + 1)
  disposeWarmCli((entry) => ('profileId' in change ? entry.profileId === change.profileId : entry.provider === change.provider))
})
