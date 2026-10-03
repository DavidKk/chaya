import { defineApiRoute } from '@/initializer/controller'
import { apiCancelled, apiError, apiOk } from '@/initializer/response'
import { type PickKind, pickPath, requireDisk } from '@/services/disk-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = defineApiRoute('post:/api/pick', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as {
    kind?: PickKind
    prompt?: string
  }
  const kind: PickKind = body.kind === 'app' ? 'app' : body.kind === 'game' ? 'game' : 'folder'
  const result = await pickPath(kind, body.prompt)

  if (result.ok) {
    return apiOk({ path: result.path })
  }
  if ('cancelled' in result && result.cancelled) {
    return apiCancelled()
  }
  return apiError(500, 'PICK_FAILED', 'error' in result ? result.error : '选择失败')
})
