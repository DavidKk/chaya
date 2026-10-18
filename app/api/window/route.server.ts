import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiNotFound, apiOk } from '@/initializer/response'
import { getResolvedFromConfig, type NwWindowConfig, pathEquals, readNwPackage, requireDisk, writeNwWindow } from '@/services/disk-ops'

export const runtime = 'nodejs'

export const GET = defineApiRoute('get:/api/window', async () => {
  const denied = requireDisk()
  if (denied) return denied

  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error)
  }
  if (resolved.remote) {
    return apiBadRequest('Remote game cannot read local window configuration', 'REMOTE_READ_ONLY')
  }
  const pkg = readNwPackage(resolved.contentRoot)
  if (!pkg) {
    return apiNotFound(`Missing package.json in content root: ${resolved.contentRoot}`)
  }
  return apiOk({ package: pkg })
})

export const PUT = defineApiRoute('put:/api/window', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error)
  }
  if (resolved.remote) {
    return apiBadRequest('Remote game cannot modify local window configuration', 'REMOTE_READ_ONLY')
  }

  const body = (await request.json().catch(() => ({}))) as {
    window?: Partial<NwWindowConfig>
    gameRoot?: string
  }
  if (body.gameRoot && !pathEquals(body.gameRoot, resolved.selected)) {
    return apiError(409, 'GAME_CHANGED', 'Selected game has changed, please save again')
  }
  if (!body.window || typeof body.window !== 'object') {
    return apiBadRequest('Missing window object')
  }

  try {
    const pkg = writeNwWindow(resolved.contentRoot, body.window)
    return apiOk({ package: pkg })
  } catch (err) {
    return apiError(500, 'WINDOW_WRITE_FAILED', err instanceof Error ? err.message : String(err))
  }
})
