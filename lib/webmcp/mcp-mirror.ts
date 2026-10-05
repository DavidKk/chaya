/**
 * MCP ⇄ WebMCP mapping: `tools/list` entries become page tools, `tools/call` results become WebMCP envelopes.
 */

import type { WebMcpToolAnnotations, WebMcpToolDefinition } from '@/initializer/webmcp/model-context'
import { webMcpError, webMcpOk } from '@/initializer/webmcp/result'

export type McpListedTool = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean }
}

export type McpCallResult = { content?: Array<{ type?: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean }

export const MIRROR_MAX_CHARS = 100_000

/** Every MCP-backed result carries game / log text; anything not read-only needs the user's consent. */
export function webMcpAnnotations(readOnly: boolean | undefined): WebMcpToolAnnotations {
  return readOnly ? { readOnlyHint: true, untrustedContentHint: true } : { consequentialHint: true, untrustedContentHint: true }
}

export function parseMcpCallResult(result: McpCallResult | null | undefined) {
  const text = (result?.content ?? [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
  if (result?.isError) return webMcpError('mcp_error', text || 'Tool failed')
  const image = result?.content?.find((part) => part?.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string')
  if (image) return webMcpOk({ result: { ...parseMeta(text), mcpImage: { mimeType: image.mimeType, data: image.data } } })
  if (text.length > MIRROR_MAX_CHARS) return webMcpOk({ text: text.slice(0, MIRROR_MAX_CHARS), truncated: true })
  try {
    return webMcpOk({ result: JSON.parse(text) as unknown })
  } catch {
    return webMcpOk({ text })
  }
}

function parseMeta(text: string): Record<string, unknown> {
  try {
    const meta = JSON.parse(text) as unknown
    return meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function mirrorToolDefinition(tool: McpListedTool, call: (name: string, args: Record<string, unknown>) => Promise<unknown>): WebMcpToolDefinition {
  return {
    name: tool.name,
    description: tool.description || tool.name,
    inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
    annotations: webMcpAnnotations(tool.annotations?.readOnlyHint),
    execute: (input) => call(tool.name, input),
  }
}

/** Wrap a plain tool function (Edge, edit tools): value → `{ ok, result }`, thrown error → `tool_error`. */
export function functionToolDefinition(
  meta: { name: string; description: string; inputSchema: Record<string, unknown>; readOnly?: boolean },
  run: (args: Record<string, unknown>, ctx: { signal: AbortSignal }) => Promise<unknown>
): WebMcpToolDefinition {
  return {
    name: meta.name,
    description: meta.description,
    inputSchema: meta.inputSchema,
    annotations: webMcpAnnotations(meta.readOnly),
    execute: async (input) => {
      try {
        const result = await run(input ?? {}, { signal: new AbortController().signal })
        return webMcpOk({ result: result ?? null })
      } catch (error) {
        const known = error as { webMcpCode?: string }
        return webMcpError(known.webMcpCode || 'tool_error', error instanceof Error ? error.message : String(error))
      }
    },
  }
}

/** Error with a machine-readable WebMCP code (e.g. `permission_required`, `game_offline`). */
export function webMcpCodedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { webMcpCode: code })
}
