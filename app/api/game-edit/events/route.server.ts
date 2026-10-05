import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { requireDisk } from '@/services/disk-ops'
import { loadCommonEventsData } from '@/services/game/game-edit-events'

export const runtime = 'nodejs'

export const GET = defineApiRoute('get:/api/game-edit/events', async () => {
  const denied = requireDisk()
  if (denied) return denied

  const data = loadCommonEventsData()
  if (!data.ok) return apiBadRequest(data.error)
  return apiOk(data)
})
