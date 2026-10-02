import { readApiErrorMessage } from '@/lib/api-error'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { optNum, optStr } from '@/lib/integration/tools/args'
import { makeCacheTools } from '@/lib/integration/tools/cache'
import { makeCatalogTools } from '@/lib/integration/tools/catalog'
import { type AgentCaller, makeLiveTools } from '@/lib/integration/tools/live'
import { makeTranslateTools } from '@/lib/integration/tools/translate'
import { type ApiInvoke, pathWithQuery, redactSecrets, type ToolImpls } from '@/lib/integration/tools/types'
import type { AgentMethod, AgentParams } from '@/lib/runtime/agent-protocol'
import type { TranslationRequestFn } from '@/lib/translate/runtime-api'
import { webMcpCodedError } from '@/lib/webmcp/mcp-mirror'

export type EdgeLinkDeps = {
  connected: () => boolean
  roomId: () => string | null
  callAgent: <M extends AgentMethod>(method: M, params: AgentParams<M>) => Promise<unknown>
  translationRequest: TranslationRequestFn
  requestCatalog: () => Promise<GameEditCatalog>
}

export function requireOnline(deps: Pick<EdgeLinkDeps, 'connected'>) {
  if (!deps.connected()) throw webMcpCodedError('game_offline', '游戏未连接：请先在游戏库选择游戏并打开（插件需已安装），连上后再试')
}

/** Agent caller over the DataChannel; there is exactly one linked game, so `gameId` must match it if given. */
export function linkAgentCaller(deps: EdgeLinkDeps): AgentCaller {
  return async (gameId, method, params) => {
    requireOnline(deps)
    const room = deps.roomId()
    if (gameId && room && gameId !== room) throw new Error(`游戏 ${gameId} 未连接；当前连接的是 ${room}`)
    return deps.callAgent(method, params)
  }
}

/** Translator-runtime invoke: same API paths, executed inside the game. */
export function linkInvoke(deps: EdgeLinkDeps): ApiInvoke {
  return async ({ method, path, query, body, signal }) => {
    requireOnline(deps)
    const res = await deps.translationRequest({ path: pathWithQuery(path, query), method, body: body as Record<string, unknown> | undefined }, signal)
    if (res.status >= 400 || res.data?.ok === false) throw new Error(readApiErrorMessage(res.data, `${method} ${path} 失败`))
    const { ok: _ok, ...rest } = res.data
    return redactSecrets(rest)
  }
}

/** Edge live / translate / cache / catalog tools through the game DataChannel. */
export function makeEdgeLinkTools(deps: EdgeLinkDeps): ToolImpls {
  const call = linkAgentCaller(deps)
  const invoke = linkInvoke(deps)
  const { chaya_live_eval: _eval, ...live } = makeLiveTools({
    games: () => (deps.connected() && deps.roomId() ? [{ gameId: deps.roomId(), via: 'datachannel' }] : []),
    call,
  })
  const { chaya_translate_batch: _batch, ...translate } = makeTranslateTools(invoke)
  return {
    ...live,
    ...translate,
    ...makeCacheTools(invoke),
    ...makeCatalogTools(async () => {
      requireOnline(deps)
      return deps.requestCatalog()
    }),
  }
}

/** Edge `chaya_logs_query`: the deployment's in-memory buffer, shared with other visitors. */
export const edgeLogsTools: ToolImpls = {
  async chaya_logs_query(args, { signal }) {
    const params = new URLSearchParams()
    for (const key of ['q', 'source', 'level'] as const) {
      const v = optStr(args, key)
      if (v) params.set(key, v)
    }
    const since = optNum(args, 'since')
    if (since !== undefined) params.set('since', String(since))
    params.set('limit', String(Math.min(1000, Math.max(1, optNum(args, 'limit') ?? 100))))
    const res = await fetch(`/api/logs?${params}`, { signal, cache: 'no-store' })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; entries?: unknown[] } | null
    if (!res.ok || !data?.ok) throw new Error(readApiErrorMessage(data, `读取日志失败（HTTP ${res.status}）`))
    const entries = data.entries ?? []
    return { count: entries.length, entries, note: '网页版日志与其他访问者共用' }
  },
}
