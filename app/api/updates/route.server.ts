import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { requireDisk } from '@/services/disk-ops'
import { startUpdateInstall, updateCoordinator } from '@/services/updates/coordinator'

export const runtime = 'nodejs'

/** Local management API. GET is offline; only explicit check/install consult GitHub. */
export const GET = defineApiRoute('get:/api/updates', async () => {
  const denied = requireDisk()
  if (denied) return denied
  return apiOk({ packages: await updateCoordinator.list() })
})

export const POST = defineApiRoute('post:/api/updates', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const body = (await request.json().catch(() => null)) as { action?: string; packageId?: string; version?: string } | null
  if (!body) return apiBadRequest('Expected update request')
  try {
    if (body.action === 'check') return apiOk({ packages: await updateCoordinator.check() })
    if (typeof body.packageId !== 'string' || typeof body.version !== 'string') return apiBadRequest('Expected packageId and version')
    if (body.action === 'install') {
      const { job, reused } = startUpdateInstall(body.packageId, body.version)
      return apiOk({ job, reused }, { status: 202 })
    }
    if (body.action === 'activate' || body.action === 'rollback') {
      return apiOk(await updateCoordinator.activate(body.packageId, body.version, body.action === 'rollback'))
    }
    return apiBadRequest('Unknown update action')
  } catch (error) {
    return apiBadRequest(error instanceof Error ? error.message : String(error), 'UPDATE_REJECTED')
  }
})
