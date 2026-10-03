import { CHAYA_MCP_SERVER } from '@/app/api/mcp/_tools'
import { defineApiRoute } from '@/initializer/controller'
import { handleMcpPost } from '@/initializer/mcp'
import { apiError } from '@/initializer/response'
import { canUseDisk } from '@/lib/service-mode/mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Local MCP endpoint, no authorization needed; the fixed-port gateway forwards here too. */
export const POST = defineApiRoute('post:/api/mcp', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'LOCAL_ONLY', 'MCP 仅本机模式可用')
  return handleMcpPost(CHAYA_MCP_SERVER, request)
})

/** No server-initiated SSE stream. */
export const GET = defineApiRoute('get:/api/mcp', async () => apiError(405, 'METHOD_NOT_ALLOWED', '请使用 POST'))
