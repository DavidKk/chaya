import { cliHomeDir } from './cli-home.server'
import { AgentCliError } from './errors'
import { JsonRpcError, type JsonRpcProcess, startJsonRpcProcess } from './jsonrpc-stdio.server'
import { cliEnv } from './process.server'

export type CodexAppServer = Omit<JsonRpcProcess, 'notify' | 'closed'>

export { JsonRpcError as CodexRpcError }

const DECLINED_APPROVALS = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'])
const LEGACY_APPROVALS = new Set(['execCommandApproval', 'applyPatchApproval'])

/**
 * Client for `codex app-server`. `CODEX_HOME` always points at a Chaya-owned directory so the player's own
 * `~/.codex` login is never read or replaced; shell and file-change approvals are always declined.
 */
export async function startCodexAppServer(input: { file: string; codexHome: string; version?: string; env?: Record<string, string> }): Promise<CodexAppServer> {
  const home = cliHomeDir('codex')
  const server = startJsonRpcProcess({
    file: input.file,
    args: ['app-server'],
    // HOME too: Codex also reads `~/.agents` skills and plugins, which belong to the player's coding setup, not the game.
    env: cliEnv(input.file, { ...input.env, CODEX_HOME: input.codexHome, HOME: home, USERPROFILE: home, OPENAI_API_KEY: '', CODEX_API_KEY: '' }),
    label: 'Codex CLI',
    jsonrpc: false,
    onRequest(method) {
      if (DECLINED_APPROVALS.has(method)) return { decision: 'decline' }
      if (LEGACY_APPROVALS.has(method)) return { decision: 'abort' }
      throw new JsonRpcError('Method not supported by Chaya', -32601)
    },
  })
  try {
    await server.request('initialize', { clientInfo: { name: 'chaya', title: 'Chaya', version: input.version || '0.0.0' }, capabilities: null })
    server.notify('initialized')
  } catch (error) {
    server.close()
    if (error instanceof JsonRpcError) throw new AgentCliError('AGENT_CLI_VERSION_UNSUPPORTED', `Codex CLI 不支持 app-server 协议：${error.message}`)
    throw error
  }
  return server
}
