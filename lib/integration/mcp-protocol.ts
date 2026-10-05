/**
 * Minimal MCP over Streamable HTTP (JSON responses only, no SSE stream), after the ticket service's
 * `initializer/mcp/creator.ts`: protocol only — tools and their execution are injected.
 * Framework-free so the Next route and the in-game gateway (ChayaAgent) share it.
 */

import { isMcpImageResult } from '@/lib/integration/tools/types'

export type McpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: McpToolAnnotations
  /** Hidden tools are neither listed nor callable */
  enabled?: () => boolean
  run: (args: Record<string, unknown>, ctx: McpCallContext) => Promise<unknown>
}

export type McpCallContext = { signal: AbortSignal }

/** MCP standard tool annotations (hints only) */
export type McpToolAnnotations = { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean }

export type McpServerConfig = {
  serverInfo: { name: string; version: string }
  instructions?: string
  tools: readonly McpTool[]
  /** Tools that come and go at runtime (e.g. plugin tools of online games); static names win on clash */
  dynamicTools?: () => readonly McpTool[]
}

/** HTTP status + JSON body (`null` = no body, e.g. 202 for notifications) */
export type McpHttpResult = { status: number; body: unknown }

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const ok = (id: JsonRpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: JsonRpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

function visible(config: McpServerConfig) {
  const tools = config.tools.filter((tool) => tool.enabled?.() ?? true)
  const names = new Set(tools.map((tool) => tool.name))
  for (const tool of config.dynamicTools?.() ?? []) {
    if (names.has(tool.name) || !(tool.enabled?.() ?? true)) continue
    names.add(tool.name)
    tools.push(tool)
  }
  return tools
}

async function handle(config: McpServerConfig, req: JsonRpcRequest, ctx: McpCallContext) {
  const { id, method } = req
  const params = req.params && typeof req.params === 'object' && !Array.isArray(req.params) ? req.params : {}
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
      return ok(id, {
        tools: visible(config).map(({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          ...(annotations ? { annotations } : {}),
        })),
      })
    case 'tools/call': {
      const name = String(params.name || '')
      const tool = visible(config).find((candidate) => candidate.name === name)
      if (!tool) return fail(id, -32602, `未知工具：${name}`)
      const args = params.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {}
      try {
        const result = await tool.run(args, ctx)
        if (isMcpImageResult(result)) {
          const { mcpImage, ...meta } = result
          return ok(id, {
            content: [
              { type: 'image', data: mcpImage.data, mimeType: mcpImage.mimeType },
              { type: 'text', text: JSON.stringify(meta, null, 2) },
            ],
            isError: false,
          })
        }
        return ok(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }], isError: false })
      } catch (error) {
        return ok(id, { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true })
      }
    }
    default:
      return fail(id, -32601, `不支持的方法：${method ?? '(empty)'}`)
  }
}

/** Parsed POST body → JSON-RPC result. Notifications (no `id`) only → 202 with no body. */
export async function dispatchMcp(config: McpServerConfig, body: unknown, ctx: McpCallContext = { signal: new AbortController().signal }): Promise<McpHttpResult> {
  if (!body || typeof body !== 'object') return { status: 400, body: fail(null, -32700, '无法解析 JSON') }
  const batch = (Array.isArray(body) ? body : [body]) as JsonRpcRequest[]
  if (!batch.length) return { status: 400, body: fail(null, -32600, '空的批量请求') }
  const responses = []
  for (const req of batch) {
    if (!req || typeof req !== 'object' || typeof req.method !== 'string') {
      responses.push(fail(req && typeof req === 'object' && 'id' in req ? (req.id ?? null) : null, -32600, '无效的 JSON-RPC 请求'))
      continue
    }
    if (req.id === undefined || req.id === null) continue
    responses.push(await handle(config, req, ctx))
  }
  if (!responses.length) return { status: 202, body: null }
  return { status: 200, body: Array.isArray(body) ? responses : responses[0] }
}
