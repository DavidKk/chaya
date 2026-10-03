import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { getDevTarget, isDevTarget, setDevTarget } from '@/lib/service-mode/target'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 仅 `pnpm dev` 收录（`*.dev.ts`）：edge / server 热切换，整个 dev 进程生效 */
export const GET = defineApiRoute('get:/api/dev/target', async () => apiOk({ target: getDevTarget() }))

export const PUT = defineApiRoute('put:/api/dev/target', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { target?: unknown } | null
  if (!isDevTarget(body?.target)) return apiBadRequest('target 需为 edge 或 server')
  setDevTarget(body.target)
  return apiOk({ target: body.target })
})
