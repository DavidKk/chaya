import { PROVIDER_META, type RemoteAuthProvider } from '@/lib/game-agent/providers'

import { AgentCliError } from '../errors'
import { codexAuthAdapter } from './codex-device.server'
import { geminiAuthAdapter } from './gemini-antigravity.server'
import type { RemoteAuthAdapter } from './remote-adapter'

const ADAPTERS: Partial<Record<RemoteAuthProvider, RemoteAuthAdapter>> = { codex: codexAuthAdapter, gemini: geminiAuthAdapter }

export function hasRemoteAuthAdapter(provider: RemoteAuthProvider) {
  return Boolean(ADAPTERS[provider])
}

export function remoteAuthAdapter(provider: RemoteAuthProvider): RemoteAuthAdapter {
  const adapter = ADAPTERS[provider]
  if (!adapter) throw new AgentCliError('AGENT_AUTH_UNAVAILABLE', `${PROVIDER_META[provider].label} 的远程授权将在后续版本开放`)
  return adapter
}
