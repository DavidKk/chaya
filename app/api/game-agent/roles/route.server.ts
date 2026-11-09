import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { requireDisk } from '@/lib/service-mode'
import { storageCall } from '@/services/storage/client'

export const runtime = 'nodejs'

export const GET = defineApiRoute('get:/api/game-agent/roles', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const url = new URL(request.url)
  const roleId = url.searchParams.get('id')
  const revision = url.searchParams.get('revision')

  if (roleId) {
    const revNum = revision ? parseInt(revision, 10) : undefined
    const result = storageCall('role.read', [roleId, revNum])
    return apiOk({ role: result })
  }

  const list = storageCall('role.list', [])
  return apiOk({ roles: list })
})

export const POST = defineApiRoute('post:/api/game-agent/roles', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const raw = await request.text()
  if (Buffer.byteLength(raw) > 5 * 1024 * 1024) return apiBadRequest('Role payload exceeds 5 MiB')

  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return apiBadRequest('Invalid JSON')
  }

  if (body.action === 'import') {
    if (!Array.isArray(body.roles)) return apiBadRequest('roles array is required')
    const result = storageCall<Record<string, unknown>>('role.import', [body.roles])
    return apiOk(result)
  }

  if (body.action === 'commit' || body.role) {
    const role = body.role
    if (!role || !role.id) return apiBadRequest('Valid role is required')
    const options = {
      expectedRevision: typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
      mutationId: typeof body.mutationId === 'string' ? body.mutationId : undefined,
      files: typeof body.files === 'object' && body.files ? body.files : role.workspaceFiles,
    }
    const result = storageCall<Record<string, unknown>>('role.commit', [role, options])
    return apiOk(result)
  }

  return apiBadRequest('Unsupported action')
})

export const DELETE = defineApiRoute('delete:/api/game-agent/roles', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const url = new URL(request.url)
  const roleId = url.searchParams.get('id')
  if (!roleId) return apiBadRequest('Role ID is required')

  const result = storageCall('role.remove', [roleId])
  return apiOk({ ok: true, removed: result })
})
