import { CHAYA_MCP_SERVER } from '@/app/api/mcp/_tools'
import { MCP_TOOLS } from '@/lib/integration/mcp-catalog'
import { type AgentCaller, pluginToolRun } from '@/lib/integration/tools/live'
import type { ToolRun } from '@/lib/integration/tools/types'
import { pluginToolDescription, pluginToolName } from '@/lib/runtime/plugin-tools'
import { callAgentGame, listPluginTools } from '@/services/runtime/agent-bridge'

import type { OllamaTool } from './types'

const RESULT_LIMIT = 16_000
const EXCLUDED_TOOLS = new Set(['chaya_live_screenshot', 'chaya_live_quit', 'chaya_live_eval', 'chaya_edit_action'])

type AgentTool = {
  definition: OllamaTool
  readOnly: boolean
  run: ToolRun
}

export type GameAgentToolResult = { ok: boolean; content: string }

function clipResult(value: unknown): string {
  const text = JSON.stringify(value)
  return text.length <= RESULT_LIMIT ? text : `${text.slice(0, RESULT_LIMIT)}...`
}

function hasGameId(schema: Record<string, unknown>): boolean {
  const properties = schema.properties
  return !!properties && typeof properties === 'object' && 'gameId' in properties
}

function definition(name: string, description: string, parameters: Record<string, unknown>): OllamaTool {
  return { type: 'function', function: { name, description, parameters } }
}

export function createGameAgentTools(gameId?: string): AgentTool[] {
  const serverTools = new Map(CHAYA_MCP_SERVER.tools.map((tool) => [tool.name, tool]))
  const staticTools = MCP_TOOLS.filter((meta) => !meta.destructive && !meta.evalOnly && !EXCLUDED_TOOLS.has(meta.name) && serverTools.has(meta.name)).map((meta): AgentTool => ({
    definition: definition(meta.name, meta.description, meta.inputSchema),
    readOnly: meta.readOnly === true,
    run: serverTools.get(meta.name)!.run,
  }))
  if (!gameId) return staticTools
  const call: AgentCaller = (_requestedGameId, method, params) => callAgentGame(gameId, method, params)
  const dynamicTools = listPluginTools()
    .filter((meta) => meta.gameIds.includes(gameId) && !meta.destructive)
    .map((meta): AgentTool => {
      const inputSchema = {
        ...meta.inputSchema,
        properties: { ...meta.inputSchema.properties, gameId: { type: 'string', description: 'Bound game id; normally omit it' } },
      }
      return {
        definition: definition(pluginToolName(meta.plugin, meta.tool), pluginToolDescription(meta), inputSchema),
        readOnly: meta.readOnly === true,
        run: pluginToolRun(meta, call),
      }
    })
  return [...staticTools, ...dynamicTools]
}

async function verificationFor(toolName: string, gameId: string, _signal: AbortSignal): Promise<unknown> {
  if (toolName === 'chaya_live_play') return undefined
  if (toolName.startsWith('chaya_edit_') || toolName.startsWith('chaya_plugin_boost_')) return callAgentGame(gameId, 'edit.state', {})
  return callAgentGame(gameId, 'game.state', {})
}

export async function executeGameAgentTool(
  tools: AgentTool[],
  name: string,
  args: Record<string, unknown>,
  gameId: string | undefined,
  signal: AbortSignal
): Promise<GameAgentToolResult> {
  const tool = tools.find((candidate) => candidate.definition.function.name === name)
  if (!tool) return { ok: false, content: clipResult({ ok: false, error: `Tool is not available in this turn: ${name}` }) }
  const boundArgs = gameId && hasGameId(tool.definition.function.parameters) ? { ...args, gameId } : args
  let result: unknown
  try {
    result = await tool.run(boundArgs, { signal })
  } catch (error) {
    return { ok: false, content: clipResult({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  if (tool.readOnly || !gameId) return { ok: true, content: clipResult({ ok: true, result }) }
  try {
    const verification = await verificationFor(name, gameId, signal)
    return { ok: true, content: clipResult({ ok: true, result, ...(verification === undefined ? {} : { verification }) }) }
  } catch (error) {
    return { ok: true, content: clipResult({ ok: true, result, verificationError: error instanceof Error ? error.message : String(error) }) }
  }
}
