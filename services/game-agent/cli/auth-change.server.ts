export type AgentAuthChange = { profileId: string } | { provider: 'cursor' }

type Listener = (change: AgentAuthChange) => void | Promise<void>

const listeners = new Set<Listener>()

/** Session owners subscribe here so runs holding old credentials end before new ones are written. */
export function onAgentAuthChange(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function notifyAgentAuthChange(change: AgentAuthChange) {
  await Promise.allSettled([...listeners].map(async (listener) => listener(change)))
}
