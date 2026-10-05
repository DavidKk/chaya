import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { requireDisk } from '@/services/disk-ops'
import { loadMapDetailData } from '@/services/game/game-edit-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineApiRoute('get:/api/game-edit/map', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const id = Number(new URL(request.url).searchParams.get('id'))
  const data = loadMapDetailData(id)
  if (!data.ok) return apiBadRequest(data.error)
  return apiOk(data)
})
