import type { WebMcpToolDefinition } from '@/initializer/webmcp/model-context'
import { MCP_TOOLS } from '@/lib/integration/mcp-catalog'
import { pluginToolRun } from '@/lib/integration/tools/live'
import type { ToolImpls } from '@/lib/integration/tools/types'
import { pluginToolDescription, type PluginToolMeta, pluginToolName, sanitizePluginTools } from '@/lib/runtime/plugin-tools'
import { functionToolDefinition } from '@/lib/webmcp/mcp-mirror'
import { EDGE_UNAVAILABLE_TOOLS } from '@/lib/webmcp/mode-matrix'

import { type EdgeGameDeps, makeEdgeGameTools } from './game'
import { edgeLibraryTools } from './library'
import { type EdgeLinkDeps, edgeLogsTools, linkAgentCaller, makeEdgeLinkTools } from './link'

export type EdgeToolDeps = EdgeLinkDeps & EdgeGameDeps

export function makeEdgeToolImpls(deps: EdgeToolDeps): ToolImpls {
  return { ...edgeLibraryTools, ...makeEdgeGameTools(deps), ...makeEdgeLinkTools(deps), ...edgeLogsTools }
}

/** Catalog tools available on Edge, with the same names / schemas as the local MCP. */
export function buildEdgeMcpTools(deps: EdgeToolDeps): WebMcpToolDefinition[] {
  const impls = makeEdgeToolImpls(deps)
  return MCP_TOOLS.filter((meta) => !EDGE_UNAVAILABLE_TOOLS[meta.name] && impls[meta.name]).map((meta) => functionToolDefinition(meta, impls[meta.name]))
}

/** Plugin tools of the linked game (from `plugins.list`), as WebMCP tools. */
export async function loadEdgePluginTools(deps: EdgeLinkDeps): Promise<WebMcpToolDefinition[]> {
  const call = linkAgentCaller(deps)
  const plugins = (await call(undefined, 'plugins.list', {})) as Array<{ name?: string; tools?: unknown[] }> | null
  const raw: unknown[] = []
  for (const plugin of Array.isArray(plugins) ? plugins : []) {
    for (const tool of Array.isArray(plugin.tools) ? plugin.tools : []) raw.push({ ...(tool as object), plugin: plugin.name })
  }
  return sanitizePluginTools(raw).map((meta: PluginToolMeta) =>
    functionToolDefinition(
      { name: pluginToolName(meta.plugin, meta.tool), description: pluginToolDescription(meta), inputSchema: meta.inputSchema, readOnly: meta.readOnly },
      pluginToolRun(meta, call)
    )
  )
}
