import { NextResponse } from 'next/server'

import { API_NO_STORE_HEADERS } from './response'

/**
 * Minimal MCP over Streamable HTTP (JSON responses only, no SSE stream), after the ticket service's
 * `initializer/mcp/creator.ts`: protocol only — tools and their execution are injected.
 */

export type McpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Hidden tools are neither listed nor callable */
  enabled?: () => boolean
  run: (args: Record<string, unknown>, ctx: McpCallContext) => Promise<unknown>
}

export type McpCallContext = { signal: AbortSignal }

export type McpServerConfig = {
  serverInfo: { name: string; version: string }
  instructions?: string
  tools: readonly McpTool[]
}

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const ok = (id: JsonRpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: JsonRpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

function visible(config: McpServerConfig) {
  return config.tools.filter((tool) => tool.enabled?.() ?? true)
}

async function handle(config: McpServerConfig, req: JsonRpcRequest, ctx: McpCallContext) {
  const { id, method, params = {} } = req
  switch (method) {
    case 'initialize': {
      const requested = String(params.protocolVersion || '')
      return ok(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: config.serverInfo,
        ...(config.instructions ? { instructions: config.instructions } : {}),
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: visible(config).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    case 'tools/call': {
      const name = String(params.name || '')
      const tool = visible(config).find((candidate) => candidate.name === name)
      if (!tool) return fail(id, -32602, `未知工具：${name}`)
      const args = params.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {}
      try {
        const result = await tool.run(args, ctx)
        return ok(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }], isError: false })
      } catch (error) {
        return ok(id, { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true })
      }
    }
    default:
      return fail(id, -32601, `不支持的方法：${method ?? '(empty)'}`)
  }
}

/** POST body → JSON-RPC response. Notifications (no `id`) get 202 with no body. */
export async function handleMcpPost(config: McpServerConfig, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as JsonRpcRequest | JsonRpcRequest[] | null
  if (!body || typeof body !== 'object') return NextResponse.json(fail(null, -32700, '无法解析 JSON'), { status: 400 })

  const batch = Array.isArray(body) ? body : [body]
  const responses = []
  for (const req of batch) {
    if (req.id === undefined || req.id === null) continue
    responses.push(await handle(config, req, { signal: request.signal }))
  }
  if (!responses.length) return new NextResponse(null, { status: 202 })
  return NextResponse.json(Array.isArray(body) ? responses : responses[0], { headers: API_NO_STORE_HEADERS })
}
