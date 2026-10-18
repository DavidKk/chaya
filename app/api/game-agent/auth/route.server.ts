import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { isCliProvider } from '@/lib/game-agent/providers'
import { agentSettingsFromSyncDocument } from '@/lib/game-agent/settings-sync'
import { canUseDisk } from '@/lib/service-mode/mode'
import { logoutCursorLogin, logoutProfile, startAuthAttempt } from '@/services/game-agent/cli/auth/attempts.server'
import { toAgentCliError } from '@/services/game-agent/cli/errors'
import { cliProfileStatus, cliProviderAvailability } from '@/services/game-agent/cli/status.server'
import { loadGameAgentSyncDocument } from '@/services/game-agent/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOCAL_ONLY = () => apiError(404, 'LOCAL_ONLY', 'Agent authorization is only available in Chaya App or local service')

function fail(error: unknown) {
  const normalized = toAgentCliError(error)
  return apiError(normalized.status, normalized.code, normalized.message)
}

function profiles() {
  return agentSettingsFromSyncDocument(loadGameAgentSyncDocument()).profiles
}

/** CLI availability and authorization summary for every CLI profile (settings page). */
export const GET = defineApiRoute('get:/api/game-agent/auth', async ({ request }) => {
  if (!canUseDisk()) return LOCAL_ONLY()
  const only = new URL(request.url).searchParams.get('profileId')
  const targets = profiles().flatMap(({ id, provider, proxy }) => (isCliProvider(provider) && (!only || id === only) ? [{ id, provider, proxy }] : []))
  const [entries, providers] = await Promise.all([Promise.all(targets.map(async (profile) => [profile.id, await cliProfileStatus(profile)] as const)), cliProviderAvailability()])
  return apiOk({ profiles: Object.fromEntries(entries), providers })
})

export const POST = defineApiRoute('post:/api/game-agent/auth', async ({ request }) => {
  if (!canUseDisk()) return LOCAL_ONLY()
  const body = (await request.json().catch(() => null)) as { profileId?: unknown } | null
  if (typeof body?.profileId !== 'string' || !body.profileId) return apiError(400, 'INVALID_AGENT_AUTH', 'Missing profileId')
  try {
    return apiOk(await startAuthAttempt(body.profileId))
  } catch (error) {
    return fail(error)
  }
})

/** Remote types delete the profile's own authorization; Cursor signs out the machine login shared by all Cursor profiles. */
export const DELETE = defineApiRoute('delete:/api/game-agent/auth', async ({ request }) => {
  if (!canUseDisk()) return LOCAL_ONLY()
  const profileId = new URL(request.url).searchParams.get('profileId') || ''
  if (!profileId) return apiError(400, 'INVALID_AGENT_AUTH', 'Missing profileId')
  const profile = profiles().find((item) => item.id === profileId)
  if (profile && !isCliProvider(profile.provider)) return apiError(400, 'AGENT_AUTH_UNAVAILABLE', 'Ollama instances do not require authorization')
  try {
    if (profile?.provider === 'cursor') await logoutCursorLogin(profile.proxy)
    else await logoutProfile(profileId)
    return apiOk({ profileId })
  } catch (error) {
    return fail(error)
  }
})
