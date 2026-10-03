import type { McpServerConfig, McpTool, McpToolAnnotations } from '@/initializer/mcp'
import { MCP_INSTRUCTIONS, MCP_SERVER_NAME, MCP_TOOLS, mcpEvalEnabled, type McpToolMeta } from '@/lib/integration/mcp-catalog'
import type { ToolImpls } from '@/lib/integration/tools/args'
import { pluginToolRun } from '@/lib/integration/tools/live'
import { pluginToolDescription, type PluginToolMeta, pluginToolName } from '@/lib/runtime/plugin-tools'
import { listPluginTools } from '@/services/runtime/agent-bridge'

import { cacheTools } from './cache'
import { editTools } from './edit'
import { gameTools } from './game'
import { libraryTools } from './library'
import { callBridgeAgent, liveTools } from './live'
import { logsTools } from './logs'
import { translateTools } from './translate'

export const MCP_TOOL_IMPLS: ToolImpls = { ...libraryTools, ...gameTools, ...liveTools, ...editTools, ...translateTools, ...cacheTools, ...logsTools }

export function toolAnnotations(meta: Pick<McpToolMeta, 'title' | 'readOnly' | 'destructive'>): McpToolAnnotations {
  return { title: meta.title, ...(meta.readOnly ? { readOnlyHint: true } : {}), ...(meta.destructive ? { destructiveHint: true } : {}) }
}

function toMcpTool(name: string): McpTool {
  const meta = MCP_TOOLS.find((tool) => tool.name === name)
  const run = MCP_TOOL_IMPLS[name]
  if (!meta || !run) throw new Error(`MCP 工具未对齐：${name}`)
  return { name, description: meta.description, inputSchema: meta.inputSchema, annotations: toolAnnotations(meta), enabled: meta.evalOnly ? mcpEvalEnabled : undefined, run }
}

const GAME_ID_PROPERTY = { type: 'string', description: '目标游戏 id（chaya_live_games 返回）；只有一个游戏在线时可省略' }

/** Plugin tool → MCP tool; the input schema gains an optional `gameId` (defaults to the only game declaring it). */
export function pluginMcpTool(meta: PluginToolMeta & { gameIds?: string[] }): McpTool {
  const only = meta.gameIds?.length === 1 ? meta.gameIds[0] : undefined
  return {
    name: pluginToolName(meta.plugin, meta.tool),
    description: pluginToolDescription(meta),
    inputSchema: { ...meta.inputSchema, properties: { ...meta.inputSchema.properties, gameId: GAME_ID_PROPERTY } },
    annotations: toolAnnotations(meta),
    run: pluginToolRun(meta, (gameId, method, params) => callBridgeAgent(gameId ?? only, method, params)),
  }
}

export const CHAYA_MCP_SERVER: McpServerConfig = {
  serverInfo: { name: MCP_SERVER_NAME, version: '0.3.0' },
  instructions: MCP_INSTRUCTIONS,
  tools: MCP_TOOLS.map((tool) => toMcpTool(tool.name)),
  dynamicTools: () => listPluginTools().map(pluginMcpTool),
}
