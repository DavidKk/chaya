import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { parseRemotePlayHostSettings } from '@/lib/runtime/remote-play-settings'
import { requireDisk } from '@/lib/service-mode'
import { readRemotePlayHostSettings, updateRemotePlayHostSettings } from '@/services/runtime/remote-play-settings.server'

export const runtime = 'nodejs'

export const GET = defineApiRoute('get:/api/remote/settings', async () => {
  const denied = requireDisk()
  if (denied) return denied
  return apiOk({ settings: readRemotePlayHostSettings() })
})

export const PUT = defineApiRoute('put:/api/remote/settings', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const raw = await request.json().catch(() => null)
  try {
    parseRemotePlayHostSettings(raw?.settings)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid ')) return apiBadRequest(error.message, 'INVALID_SETTINGS')
    throw error
  }
  return apiOk({ settings: updateRemotePlayHostSettings(raw.settings) })
})
