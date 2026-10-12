import { type AgentAuthStatus, type AgentCliStatus, type AgentProviderAvailability, type CliAgentProvider, GAME_AGENT_PROVIDERS, isCliProvider } from '@/lib/game-agent/providers'

import { hasRemoteAuthAdapter } from './auth/adapters.server'
import { getCursorAuthStatus } from './auth/cursor-local.server'
import { type CredentialPaths, readCredentialMeta } from './credentials/store.server'
import { resolveCli } from './resolve-cli.server'

export type CliProfileStatus = { cli: AgentCliStatus; auth: AgentAuthStatus }

export function remoteAuthStatus(profileId: string, provider: CliAgentProvider, paths: CredentialPaths = {}): AgentAuthStatus {
  const meta = readCredentialMeta(profileId, paths)
  if (!meta || meta.provider !== provider) return { mode: 'remote', state: 'unauthorized' }
  return { mode: 'remote', state: meta.state === 'expired' ? 'expired' : 'authorized', account: meta.account, updatedAt: meta.updatedAt }
}

/** Which CLI types can be picked on this machine: Chaya supports their sign-in and the CLI is installed. */
export async function cliProviderAvailability(): Promise<Partial<Record<CliAgentProvider, AgentProviderAvailability>>> {
  const providers = GAME_AGENT_PROVIDERS.filter(isCliProvider)
  const entries = await Promise.all(
    providers.map(async (provider): Promise<[CliAgentProvider, AgentProviderAvailability]> => {
      if (provider !== 'cursor' && !hasRemoteAuthAdapter(provider)) return [provider, { available: false, reason: 'unsupported' }]
      const { found } = await resolveCli(provider)
      return [provider, found ? { available: true } : { available: false, reason: 'cli_missing' }]
    })
  )
  return Object.fromEntries(entries)
}

/** Why a CLI instance cannot take a turn right now; `null` when it can (an unknown Cursor state is tried and fails loudly). */
export function cliUnavailableReason(status: CliProfileStatus): string | null {
  if (!status.cli.found) return '本机未安装对应 CLI'
  if (status.auth.state === 'signed_out') return 'Cursor 未登录，请在设置中登录'
  if (status.auth.state === 'unauthorized') return '尚未授权，请在设置中授权'
  if (status.auth.state === 'expired') return '授权已失效，请在设置中重新授权'
  return null
}

/** Cheap enough for the 2-second status poll: CLI lookup and Cursor status are cached, remote state is metadata only. */
export async function cliProfileStatus(profile: { id: string; provider: CliAgentProvider; proxy?: string }): Promise<CliProfileStatus> {
  const resolved = await resolveCli(profile.provider)
  const cli: AgentCliStatus = {
    found: resolved.found,
    ...(resolved.version ? { version: resolved.version } : {}),
    ...(resolved.installHint ? { installHint: resolved.installHint } : {}),
  }
  if (profile.provider !== 'cursor') return { cli, auth: remoteAuthStatus(profile.id, profile.provider) }
  if (!resolved.found) return { cli, auth: { mode: 'local_login', state: 'unknown', reason: 'cli_missing' } }
  return { cli, auth: await getCursorAuthStatus({ proxy: profile.proxy }) }
}
