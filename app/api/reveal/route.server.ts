import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { getResolvedFromConfig, openInFinder, requireDisk, revealInFinder } from '@/services/disk-ops'

export const runtime = 'nodejs'

export const POST = defineApiRoute('post:/api/reveal', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as {
    target?: 'project' | 'shell' | 'content'
    reveal?: boolean
  }
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) {
    return apiBadRequest(resolved.error)
  }

  const target = body.target === 'shell' ? resolved.shellApp : body.target === 'content' ? resolved.contentRoot : resolved.projectRoot

  try {
    if (body.reveal !== false && body.target === 'shell') {
      await revealInFinder(target)
    } else if (body.reveal) {
      await revealInFinder(target)
    } else {
      await openInFinder(target)
    }
    return apiOk({ path: target })
  } catch (err) {
    return apiError(500, 'REVEAL_FAILED', err instanceof Error ? err.message : String(err))
  }
})
