import { NextResponse } from 'next/server'

import { API_NO_STORE_HEADERS } from '@/initializer/response'
import { dispatchMcp, type McpServerConfig } from '@/lib/integration/mcp-protocol'

export type { McpCallContext, McpServerConfig, McpTool, McpToolAnnotations } from '@/lib/integration/mcp-protocol'

/** POST body → JSON-RPC response (protocol in `lib/integration/mcp-protocol`). */
export async function handleMcpPost(config: McpServerConfig, request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const { status, body: result } = await dispatchMcp(config, body, { signal: request.signal })
  if (result === null) return new NextResponse(null, { status })
  return NextResponse.json(result, { status, headers: status === 200 ? API_NO_STORE_HEADERS : undefined })
}
