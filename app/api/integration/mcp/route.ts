import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { MCP_ENDPOINT_PATH, mcpEvalEnabled } from '@/lib/integration/mcp-catalog'
import type { McpGatewayStatus } from '@/lib/integration/mcp-gateway'
import { canUseDisk, getServiceMode } from '@/lib/service-mode/mode'
import { toolkitListenPort } from '@/services/runtime/presence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function gateway() {
  const { localMcpGateway } = await import('@/services/integration/mcp-gateway')
  return localMcpGateway()
}

function gatewayFields({ state, port, url, file, dir, fileExists, holder }: McpGatewayStatus) {
  return { gateway: { state, port, url, file, dir, fileExists, holderRole: holder?.role } }
}

/** Integration page: unified gateway + compat `/api/mcp` (local only). Edge renders static docs. */
export const GET = defineApiRoute('get:/api/integration/mcp', async () => {
  const serviceMode = getServiceMode()
  if (!canUseDisk(serviceMode)) return apiOk({ available: false, serviceMode })
  const status = await (await gateway()).refresh()
  return apiOk({ available: true, serviceMode, endpoint: `http://127.0.0.1:${toolkitListenPort()}${MCP_ENDPOINT_PATH}`, evalEnabled: mcpEvalEnabled(), ...gatewayFields(status) })
})

/** Change the shared gateway port (written to the per-user `mcp.json`). */
export const PUT = defineApiRoute('put:/api/integration/mcp', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'LOCAL_ONLY', '仅本机模式可用')
  const body = (await request.json().catch(() => null)) as { port?: unknown } | null
  try {
    return apiOk(gatewayFields(await (await gateway()).setPort(Number(body?.port))))
  } catch (err) {
    return apiBadRequest(err instanceof Error ? err.message : String(err))
  }
})

/** Delete `mcp.json` (and its folder when empty): back to the default port. */
export const DELETE = defineApiRoute('delete:/api/integration/mcp', async () => {
  if (!canUseDisk()) return apiError(404, 'LOCAL_ONLY', '仅本机模式可用')
  return apiOk(gatewayFields(await (await gateway()).resetPort()))
})

/** Reveal `mcp.json` (or its folder) in the system file manager. */
export const POST = defineApiRoute('post:/api/integration/mcp', async () => {
  if (!canUseDisk()) return apiError(404, 'LOCAL_ONLY', '仅本机模式可用')
  const status = (await gateway()).status()
  if (!status.fileExists) return apiBadRequest('端口配置文件不存在（使用默认端口）')
  const { revealInFinder } = await import('@/services/game/finder')
  try {
    await revealInFinder(status.file)
    return apiOk({ path: status.file })
  } catch (err) {
    return apiError(500, 'REVEAL_FAILED', err instanceof Error ? err.message : String(err))
  }
})
