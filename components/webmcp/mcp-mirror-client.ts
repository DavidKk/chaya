import type { WebMcpToolDefinition } from '@/initializer/webmcp/model-context'
import { webMcpError } from '@/initializer/webmcp/result'
import { MCP_ENDPOINT_PATH } from '@/lib/integration/mcp-catalog'
import { type McpCallResult, type McpListedTool, mirrorToolDefinition, parseMcpCallResult } from '@/lib/webmcp/mcp-mirror'

class McpHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

let rpcId = 0

/** JSON-RPC over the page's management cookie — same auth as a direct MCP client, no token in the page. */
async function mcpRpc<T>(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(MCP_ENDPOINT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  })
  if (!res.ok) throw new McpHttpError(res.status, res.status === 401 ? '未授权：请先用授权链接登录本机 Chaya' : `MCP 请求失败（HTTP ${res.status}）`)
  const data = (await res.json()) as { result?: T; error?: { message?: string } }
  if (data.error) throw new Error(data.error.message || 'MCP 请求失败')
  return data.result as T
}

export async function fetchMirrorTools(signal?: AbortSignal): Promise<McpListedTool[]> {
  const result = await mcpRpc<{ tools?: McpListedTool[] }>('tools/list', {}, signal)
  return Array.isArray(result?.tools) ? result.tools : []
}

async function callMirrorTool(name: string, args: Record<string, unknown>) {
  try {
    return parseMcpCallResult(await mcpRpc<McpCallResult>('tools/call', { name, arguments: args }))
  } catch (error) {
    if (error instanceof McpHttpError && error.status === 401) return webMcpError('unauthorized', error.message)
    return webMcpError('mcp_unreachable', error instanceof Error ? error.message : String(error))
  }
}

export function buildMirrorTools(tools: McpListedTool[]): WebMcpToolDefinition[] {
  return tools.filter((tool) => typeof tool?.name === 'string' && tool.name).map((tool) => mirrorToolDefinition(tool, callMirrorTool))
}
