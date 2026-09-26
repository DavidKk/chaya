import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { loadGameEditCatalog, requireDisk } from '@/services/disk-ops'

export const runtime = 'nodejs'

export const GET = defineApiRoute('get:/api/game-edit/catalog', async () => {
  const denied = requireDisk()
  if (denied) return denied

  const catalog = loadGameEditCatalog()
  if (!catalog.ok) {
    return apiBadRequest(catalog.error)
  }
  return apiOk(catalog)
})
