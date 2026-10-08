import type { WebMcpToolDefinition } from '@/initializer/webmcp/model-context'
import { MCP_TOOLS } from '@/lib/integration/mcp-catalog'
import { pluginToolRun } from '@/lib/integration/tools/live'
import type { ToolImpls } from '@/lib/integration/tools/types'
import { pluginToolDescription, type PluginToolMeta, pluginToolName, sanitizePluginTools } from '@/lib/runtime/plugin-tools'
import { functionToolDefinition } from '@/lib/webmcp/mcp-mirror'
import { REMOTE_UNAVAILABLE_TOOLS } from '@/lib/webmcp/mode-matrix'

import { makeRemoteGameTools, type RemoteGameDeps } from './game'
import { makeRemoteLibraryTools } from './library'
import { linkAgentCaller, makeRemoteLinkTools, type RemoteLinkDeps, remoteLogsTools } from './link'

export type RemoteToolDeps = RemoteLinkDeps & RemoteGameDeps

export function makeRemoteToolImpls(deps: RemoteToolDeps): ToolImpls {
  return { ...makeRemoteLinkTools(deps), ...makeRemoteLibraryTools(deps), ...makeRemoteGameTools(deps), ...remoteLogsTools }
}

/** Catalog tools available on Remote, with the same names / schemas as the local MCP. */
export function buildRemoteMcpTools(deps: RemoteToolDeps): WebMcpToolDefinition[] {
  const impls = makeRemoteToolImpls(deps)
  return MCP_TOOLS.filter((meta) => !REMOTE_UNAVAILABLE_TOOLS[meta.name] && impls[meta.name]).map((meta) => functionToolDefinition(meta, impls[meta.name]))
}

/** Plugin tools of the linked game (from `plugins.list`), as WebMCP tools. */
export async function loadRemotePluginTools(deps: RemoteLinkDeps): Promise<WebMcpToolDefinition[]> {
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
