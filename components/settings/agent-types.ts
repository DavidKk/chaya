import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'

export type AgentProfile = {
  id: string
  label: string
  provider: 'ollama'
  endpoint: string
  defaultModel: string
  temperature: number
  keepAlive: string
}

export type AgentSettings = {
  version: 1
  defaultProfileId: string
  profiles: AgentProfile[]
}

export type AgentModel = { name: string }

export type AgentSettingsRequest = GameAgentRequest

export function createAgentProfile(): AgentProfile {
  return {
    id: `ollama-${Date.now().toString(36)}`,
    label: 'Ollama',
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    defaultModel: '',
    temperature: 0.2,
    keepAlive: '10m',
  }
}
