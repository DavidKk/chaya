import { defineApiRoute } from '@/initializer/controller'
import { apiOk } from '@/initializer/response'
import { MCP_ENDPOINT_PATH, mcpEvalEnabled } from '@/lib/integration/mcp-catalog'
import { canUseDisk, getServiceMode } from '@/lib/service-mode/mode'
import { toolkitListenPort } from '@/services/runtime/presence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Integration page: this local server's own `/api/mcp` (local only). Edge renders static gateway docs. */
export const GET = defineApiRoute('get:/api/integration/mcp', async () => {
  const serviceMode = getServiceMode()
  if (!canUseDisk(serviceMode)) return apiOk({ available: false, serviceMode })
  return apiOk({ available: true, serviceMode, endpoint: `http://127.0.0.1:${toolkitListenPort()}${MCP_ENDPOINT_PATH}`, evalEnabled: mcpEvalEnabled() })
})
