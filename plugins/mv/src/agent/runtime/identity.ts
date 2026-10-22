import type { AgentRuntimeIdentity } from '@/lib/game-agent/audit'

const PLUGIN_INSTANCE_KEY = 'chaya.agent.pluginInstanceId.v1'
const PRODUCER_EPOCH_KEY = 'chaya.agent.producerEpoch.v1'
let activeIdentity: AgentRuntimeIdentity | null = null

function randomId(prefix: string): string {
  const value = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${value}`
}

function storedPluginInstanceId(): string {
  try {
    const current = localStorage.getItem(PLUGIN_INSTANCE_KEY)?.trim()
    if (current) return current
    const created = randomId('plugin')
    localStorage.setItem(PLUGIN_INSTANCE_KEY, created)
    return created
  } catch {
    return randomId('plugin')
  }
}

function nextProducerEpoch(): number {
  try {
    const current = Number(localStorage.getItem(PRODUCER_EPOCH_KEY) || 0)
    const next = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1
    localStorage.setItem(PRODUCER_EPOCH_KEY, String(next))
    return next
  } catch {
    return Date.now()
  }
}

export function createAgentRuntimeIdentity(libraryGameId: string): { identity: AgentRuntimeIdentity; producerEpoch: number } {
  const value = {
    identity: {
      libraryGameId,
      runtimeInstanceId: randomId('runtime'),
      pluginInstanceId: storedPluginInstanceId(),
      connectionId: randomId('connection'),
    },
    producerEpoch: nextProducerEpoch(),
  }
  activeIdentity = value.identity
  return value
}

export function currentAgentRuntimeIdentity(): AgentRuntimeIdentity | null {
  return activeIdentity
}
