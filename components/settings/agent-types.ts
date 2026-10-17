import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { type GameAgentProvider, isCliProvider, isOpenApiProvider, PROVIDER_META } from '@/lib/game-agent/providers'
import { type AgentProxyProtocols } from '@/lib/game-agent/proxy'
import type { AgentTimeoutSettings } from '@/lib/game-agent/timeouts'

export type AgentProfile = AgentTimeoutSettings & {
  id: string
  label: string
  provider: GameAgentProvider
  endpoint: string
  defaultModel: string
  temperature: number
  keepAlive: string
  proxy: string
  proxyProtocols: AgentProxyProtocols
  proxyHeaders: Record<string, string>
  hasToken?: boolean
}

export type AgentSettings = {
  version: 1
  defaultProfileId: string
  profiles: AgentProfile[]
}

export type AgentModel = { name: string; label?: string }

export type AgentSettingsRequest = GameAgentRequest

const OLLAMA_DEFAULTS = { endpoint: 'http://127.0.0.1:11434', temperature: 0.2, keepAlive: '10m' }

/** Switches the form's type; a label still equal to the old type's default follows the new type. */
export function withAgentProvider(profile: AgentProfile, provider: GameAgentProvider, previousLabel: string, nextLabel: string): AgentProfile {
  const label = !profile.label.trim() || profile.label === previousLabel ? nextLabel : profile.label
  const proxyProtocols = profile.proxyProtocols || {}
  const proxyHeaders = profile.proxyHeaders || {}
  if (provider === 'ollama') return { ...profile, ...OLLAMA_DEFAULTS, provider, label, defaultModel: '', proxyProtocols, proxyHeaders }
  if (isOpenApiProvider(provider)) {
    return {
      ...profile,
      provider,
      label,
      endpoint: PROVIDER_META[provider].defaultEndpoint || '',
      defaultModel: '',
      temperature: OLLAMA_DEFAULTS.temperature,
      keepAlive: OLLAMA_DEFAULTS.keepAlive,
      proxyProtocols,
      proxyHeaders,
    }
  }
  if (isCliProvider(provider)) {
    return {
      ...profile,
      provider,
      label,
      endpoint: '',
      defaultModel: '',
      temperature: OLLAMA_DEFAULTS.temperature,
      keepAlive: OLLAMA_DEFAULTS.keepAlive,
      proxyProtocols,
      proxyHeaders,
    }
  }
  return {
    ...profile,
    provider,
    label,
    endpoint: '',
    defaultModel: '',
    temperature: OLLAMA_DEFAULTS.temperature,
    keepAlive: OLLAMA_DEFAULTS.keepAlive,
    proxyProtocols,
    proxyHeaders,
  }
}

export function createAgentProfile(): AgentProfile {
  return {
    id: `ollama-${Date.now().toString(36)}`,
    label: 'Ollama',
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    defaultModel: '',
    temperature: 0.2,
    keepAlive: '10m',
    proxy: '',
    proxyProtocols: {},
    proxyHeaders: {},
    modelRequestTimeoutMs: 10_000,
    modelTimeoutMs: 120_000,
    gameCallTimeoutMs: 15_000,
  }
}

/** Edit form text for proxy headers (one `Name: value` per line). */
export function proxyHeadersText(headers: Record<string, string> | undefined): string {
  return Object.entries(headers || {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}
