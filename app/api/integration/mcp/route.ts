import { defineApiRoute } from '@/initializer/controller'
import { apiOk } from '@/initializer/response'
import { MCP_ENDPOINT_PATH } from '@/lib/integration/mcp-catalog'
import { canUseDisk, getServiceMode } from '@/lib/service-mode/mode'
import { toolkitListenPort } from '@/services/runtime'

import { mcpEvalEnabled } from '../../mcp/_tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Integration page: MCP endpoint + management token. Edge allows every API, so gate on disk mode explicitly. */
export const GET = defineApiRoute('get:/api/integration/mcp', async () => {
  const serviceMode = getServiceMode()
  if (!canUseDisk(serviceMode)) return apiOk({ available: false, serviceMode })
  const endpoint = `http://127.0.0.1:${toolkitListenPort()}${MCP_ENDPOINT_PATH}`
  return apiOk({ available: true, serviceMode, endpoint, token: process.env.CHAYA_AUTH_TOKEN || null, evalEnabled: mcpEvalEnabled() })
})
