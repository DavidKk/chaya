/**
 * In-game side of the unified MCP gateway (Edge only): this game's plugin-MCP tools (`mcpToolsFor('plugin')`) on the shared 127.0.0.1 port.
 * Local-service games never bind (the server does) but still expose status and port management to the panel.
 */

import { MCP_PLUGIN_INSTRUCTIONS, mcpToolsFor } from '@/lib/integration/mcp-availability'
import { MCP_SERVER_NAME, mcpToolAnnotations } from '@/lib/integration/mcp-catalog'
import { createMcpGateway, type McpGateway, type McpGatewayControl } from '@/lib/integration/mcp-gateway'
import { MCP_DOCS_URL, processMcpPortEnv } from '@/lib/integration/mcp-port'
import { dispatchMcp, type McpServerConfig, type McpTool } from '@/lib/integration/mcp-protocol'
import { makeEditTools } from '@/lib/integration/tools/edit'
import { type AgentCaller, makeLiveTools, pluginToolRun } from '@/lib/integration/tools/live'
import type { ToolImpls } from '@/lib/integration/tools/types'
import type { AgentCommand } from '@/lib/runtime/agent-protocol'
import { pluginToolDescription, pluginToolName } from '@/lib/runtime/plugin-tools'

import { tryNodeRequire } from '../helpers/node/node-require'
import { listPluginToolMetas } from '../helpers/plugin-tools'
import { makeGameTools } from './game-tools'
import { runAgentCommand } from './handlers'

type Log = { info: (msg: string) => void; warn: (msg: string) => void }

type NwShell = { openExternal?: (url: string) => void; showItemInFolder?: (path: string) => void; openItem?: (path: string) => void }

const GAME_ID_PROPERTY = { type: 'string', description: 'Game id; optional, only this game is served' }

let commandSeq = 0

function nwShell(): NwShell | undefined {
  return (globalThis as { nw?: { Shell?: NwShell } }).nw?.Shell
}

export function gatewayEnabled(): boolean {
  return (window as Window & { CHAYA_MCP_GATEWAY?: unknown }).CHAYA_MCP_GATEWAY === true
}

function buildServer(gameId: () => string, gameInfo: () => Record<string, unknown>): McpServerConfig {
  const call: AgentCaller = async (target, method, params) => {
    if (target && target !== gameId()) throw new Error(`游戏不在线：${target}（此网关只服务 ${gameId()}）`)
    commandSeq += 1
    return runAgentCommand({ id: `gw-${commandSeq}`, method, params } as AgentCommand)
  }
  const impls: ToolImpls = { ...makeLiveTools({ games: () => [{ ...gameInfo(), gameId: gameId() }], call }), ...makeEditTools(call), ...makeGameTools() }
  const tools: McpTool[] = mcpToolsFor('plugin').map((meta) => ({
    name: meta.name,
    description: meta.description,
    inputSchema: meta.inputSchema,
    annotations: mcpToolAnnotations(meta),
    run: impls[meta.name],
  }))
  return {
    serverInfo: { name: MCP_SERVER_NAME, version: '0.3.0' },
    instructions: MCP_PLUGIN_INSTRUCTIONS,
    tools,
    dynamicTools: () =>
      listPluginToolMetas().map((meta) => ({
        name: pluginToolName(meta.plugin, meta.tool),
        description: pluginToolDescription(meta),
        inputSchema: { ...meta.inputSchema, properties: { ...meta.inputSchema.properties, gameId: GAME_ID_PROPERTY } },
        annotations: mcpToolAnnotations(meta),
        run: pluginToolRun(meta, call),
      })),
  }
}

/** Start the gateway when this game may bind; returns the panel control and a stop function. */
export function startGameGateway(opts: { gameId: () => string; gameInfo: () => Record<string, unknown>; log: Log }): { control: McpGatewayControl; stop: () => Promise<void> } {
  const req = tryNodeRequire()
  const enabled = gatewayEnabled()
  const server = buildServer(opts.gameId, opts.gameInfo)
  let gateway: McpGateway | null = null
  try {
    if (req) {
      const os = req('os') as typeof import('os')
      gateway = createMcpGateway({
        http: req('http') as typeof import('http'),
        fs: req('fs') as typeof import('fs'),
        env: processMcpPortEnv(os.homedir()),
        identity: { chaya: true, role: 'game', gameId: opts.gameId(), name: String(opts.gameInfo().name || '') || undefined },
        handle: (body) => dispatchMcp(server, body),
        listen: enabled,
        log: opts.log,
      })
    }
  } catch (err) {
    opts.log.warn(`MCP 网关不可用：${err instanceof Error ? err.message : String(err)}`)
    gateway = null
  }
  if (gateway && enabled) void gateway.start()

  const need = () => {
    if (!gateway) throw new Error('当前游戏没有 Node 环境，无法使用 MCP 网关')
    return gateway
  }
  const control: McpGatewayControl = {
    available: !!gateway,
    enabled,
    status: () => gateway?.status() ?? null,
    refresh: async () => (gateway ? gateway.refresh() : null),
    setPort: async (port) => need().setPort(port),
    resetPort: async () => need().resetPort(),
    rpc: (body) => dispatchMcp(server, body),
    openFolder: () => {
      const status = gateway?.status()
      const shell = nwShell()
      if (!status || !shell) return
      if (status.fileExists && shell.showItemInFolder) shell.showItemInFolder(status.file)
      else shell.openItem?.(status.dir)
    },
    openDocs: () => {
      const shell = nwShell()
      if (shell?.openExternal) shell.openExternal(MCP_DOCS_URL)
      else window.open(MCP_DOCS_URL, '_blank', 'noopener')
    },
  }
  return { control, stop: async () => gateway?.stop() }
}
