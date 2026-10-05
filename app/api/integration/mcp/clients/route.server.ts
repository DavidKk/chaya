import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { requireDisk } from '@/services/disk-ops'
import { getMcpClientsStatus, installMcpClient, localMcpEndpoint, MCP_CLI_CLIENTS, uninstallMcpClient } from '@/services/integration/mcp-clients'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Whether Claude Code / Codex have this server's MCP and whether their CLI is available */
export const GET = defineApiRoute('get:/api/integration/mcp/clients', async () => {
  const denied = requireDisk()
  if (denied) return denied
  return apiOk({ clients: getMcpClientsStatus() })
})

/** `{ client: 'claude' | 'codex', action: 'install' | 'uninstall' }`: run the CLI's own `mcp add` / `mcp remove` */
export const POST = defineApiRoute('post:/api/integration/mcp/clients', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as { client?: unknown; action?: unknown }
  const client = MCP_CLI_CLIENTS.find((id) => id === body.client)
  if (!client) return apiBadRequest('client must be claude or codex')
  if (body.action !== 'install' && body.action !== 'uninstall') return apiBadRequest('action must be install or uninstall')
  try {
    if (body.action === 'install') await installMcpClient(client, localMcpEndpoint())
    else await uninstallMcpClient(client)
  } catch (error) {
    return apiError(500, 'MCP_CLIENT_ACTION_FAILED', error instanceof Error ? error.message : String(error))
  }
  return apiOk({ clients: getMcpClientsStatus() })
})
