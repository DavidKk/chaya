import type { McpServerConfig, McpTool } from '@/initializer/mcp'
import { MCP_INSTRUCTIONS, MCP_SERVER_NAME, MCP_TOOLS } from '@/lib/integration/mcp-catalog'

import type { ToolImpls } from './args'
import { cacheTools } from './cache'
import { editTools } from './edit'
import { gameTools } from './game'
import { libraryTools } from './library'
import { liveTools } from './live'
import { logsTools } from './logs'
import { translateTools } from './translate'

export const MCP_TOOL_IMPLS: ToolImpls = { ...libraryTools, ...gameTools, ...liveTools, ...editTools, ...translateTools, ...cacheTools, ...logsTools }

export const mcpEvalEnabled = () => process.env.CHAYA_MCP_EVAL === '1'

function toMcpTool(name: string): McpTool {
  const meta = MCP_TOOLS.find((tool) => tool.name === name)
  const run = MCP_TOOL_IMPLS[name]
  if (!meta || !run) throw new Error(`MCP 工具未对齐：${name}`)
  return { name, description: meta.description, inputSchema: meta.inputSchema, enabled: meta.evalOnly ? mcpEvalEnabled : undefined, run }
}

export const CHAYA_MCP_SERVER: McpServerConfig = {
  serverInfo: { name: MCP_SERVER_NAME, version: '0.2.0' },
  instructions: MCP_INSTRUCTIONS,
  tools: MCP_TOOLS.map((tool) => toMcpTool(tool.name)),
}
