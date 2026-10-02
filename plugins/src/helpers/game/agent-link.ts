/**
 * DataChannel → ChayaAgent: requests on the translation RPC with path `/agent` run agent commands.
 * The channel's signaling is unauthenticated on Edge, so only `AGENT_LINK_METHODS` pass (never eval).
 */

import { AGENT_LINK_METHODS, type AgentCommand } from '@/lib/runtime/agent-protocol'
import type { TranslationResponse } from '@/lib/translate/runtime-api'

type LinkAgent = { run?: (cmd: AgentCommand) => Promise<unknown> }

const fail = (status: number, message: string): TranslationResponse => ({ status, data: { ok: false, error: { message } } })

export async function runLinkAgentRequest(body: Record<string, unknown> | undefined, agent: LinkAgent | undefined): Promise<TranslationResponse> {
  const method = body?.method
  if (typeof method !== 'string' || !(AGENT_LINK_METHODS as readonly string[]).includes(method)) {
    return fail(403, `游戏连接不允许执行 ${String(method)}`)
  }
  if (typeof agent?.run !== 'function') return fail(400, 'ChayaAgent 插件未加载，请更新插件后重新打开游戏')
  const params = body?.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {}
  try {
    const result = await agent.run({ id: 'link', method, params } as AgentCommand)
    return { status: 200, data: { ok: true, result: result ?? null } }
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : String(error))
  }
}
