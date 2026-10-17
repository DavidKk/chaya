import { readApiErrorMessage } from '@/lib/api-error'
import { browserAgentTraceArchive } from '@/lib/browser/agent-trace-store'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { sanitizeAgentActivity } from '@/lib/game-agent/activity'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import type { AgentTraceSummary } from '@/lib/game-agent/trace'
import { optNum, optStr } from '@/lib/integration/tools/args'
import { makeCacheTools } from '@/lib/integration/tools/cache'
import { makeCatalogTools } from '@/lib/integration/tools/catalog'
import { makeEditTools } from '@/lib/integration/tools/edit'
import { type AgentCaller, makeLiveTools } from '@/lib/integration/tools/live'
import { makeSaveTools } from '@/lib/integration/tools/saves'
import { makeSkillTools } from '@/lib/integration/tools/skills'
import { makeTranslateTools } from '@/lib/integration/tools/translate'
import { type ApiInvoke, pathWithQuery, redactSecrets, type ToolImpls } from '@/lib/integration/tools/types'
import { filterLogEntries, normalizeLogLevel } from '@/lib/log'
import { clearLinkLogs, readLinkLogs } from '@/lib/log/link-log-store'
import type { AgentMethod, AgentParams } from '@/lib/runtime/agent-protocol'
import type { TranslationRequestFn } from '@/lib/translate/runtime-api'
import { webMcpCodedError } from '@/lib/webmcp/mcp-mirror'

export type RemoteLinkDeps = {
  connected: () => boolean
  roomId: () => string | null
  callAgent: <M extends AgentMethod>(method: M, params: AgentParams<M>) => Promise<unknown>
  translationRequest: TranslationRequestFn
  requestCatalog: () => Promise<GameEditCatalog>
}

export function requireOnline(deps: Pick<RemoteLinkDeps, 'connected'>) {
  if (!deps.connected()) throw webMcpCodedError('game_offline', '游戏未连接：请先在游戏库选择游戏并打开（插件需已安装），连上后再试')
}

/** Agent caller over the DataChannel; there is exactly one linked game, so `gameId` must match it if given. */
export function linkAgentCaller(deps: RemoteLinkDeps): AgentCaller {
  return async (gameId, method, params) => {
    requireOnline(deps)
    const room = deps.roomId()
    if (gameId && room && gameId !== room) throw new Error(`游戏 ${gameId} 未连接；当前连接的是 ${room}`)
    return deps.callAgent(method, params)
  }
}

/** Translator-runtime invoke: same API paths, executed inside the game. */
export function linkInvoke(deps: RemoteLinkDeps): ApiInvoke {
  return async ({ method, path, query, body, signal }) => {
    requireOnline(deps)
    const res = await deps.translationRequest({ path: pathWithQuery(path, query), method, body: body as Record<string, unknown> | undefined }, signal)
    if (res.status >= 400 || res.data?.ok === false) throw new Error(readApiErrorMessage(res.data, `${method} ${path} 失败`))
    const { ok: _ok, ...rest } = res.data
    return redactSecrets(rest)
  }
}

/** Remote live / edit / translate / cache / catalog tools through the game DataChannel. */
export function makeRemoteLinkTools(deps: RemoteLinkDeps): ToolImpls {
  const call = linkAgentCaller(deps)
  const invoke = linkInvoke(deps)
  const { chaya_live_eval: _eval, ...live } = makeLiveTools({
    games: () => (deps.connected() && deps.roomId() ? [{ gameId: deps.roomId(), via: 'datachannel' }] : []),
    call,
  })
  const { chaya_translate_batch: _batch, ...translate } = makeTranslateTools(invoke)
  return {
    ...live,
    ...makeSaveTools(call),
    ...makeSkillTools(),
    ...makeEditTools(call),
    ...translate,
    ...makeCacheTools(invoke),
    ...makeCatalogTools(async () => {
      requireOnline(deps)
      return deps.requestCatalog()
    }),
  }
}

/** Remote logs: only what the linked game pushed over the DataChannel, kept in this page. */
export const remoteLogsTools: ToolImpls = {
  async chaya_logs_query(args) {
    if (optStr(args, 'view') === 'agent') {
      const limit = Math.min(1000, Math.max(1, optNum(args, 'limit') ?? 100))
      const query = optStr(args, 'q')?.toLocaleLowerCase()
      const taskId = optStr(args, 'taskId')
      const gameId = optStr(args, 'gameId')
      const runtimeInstanceId = optStr(args, 'runtimeInstanceId')
      const eventType = optStr(args, 'eventType')
      const matches = (value: unknown) => !query || JSON.stringify(value).toLocaleLowerCase().includes(query)
      if (taskId) {
        const task = (await browserAgentTraceArchive.read(taskId)) as AgentTask | null
        if (!task || (gameId && task.gameId !== gameId) || (runtimeInstanceId && task.runtimeInstanceId !== runtimeInstanceId))
          return { view: 'agent', count: 0, tasks: [], events: [] }
        const events = task.events.filter((event: AgentTaskEvent) => (!eventType || event.type === eventType) && matches(event)).slice(-limit)
        const { events: _events, messages: _messages, ...metadata } = task
        return { view: 'agent', count: events.length, task: sanitizeAgentActivity(metadata), events: events.map((event) => sanitizeAgentActivity(event)) }
      }
      const tasks = ((await browserAgentTraceArchive.list()) as AgentTraceSummary[])
        .filter((task) => (!gameId || task.gameId === gameId) && (!runtimeInstanceId || task.runtimeInstanceId === runtimeInstanceId) && matches(task))
        .slice(0, limit)
      return { view: 'agent', count: tasks.length, tasks: tasks.map((task) => sanitizeAgentActivity(task)) }
    }
    const level = optStr(args, 'level')
    const entries = filterLogEntries(readLinkLogs(), {
      q: optStr(args, 'q'),
      source: optStr(args, 'source'),
      level: level ? normalizeLogLevel(level) : undefined,
      since: optNum(args, 'since'),
      limit: Math.min(1000, Math.max(1, optNum(args, 'limit') ?? 100)),
    })
    return { count: entries.length, entries, note: '网页版日志来自当前连接的游戏，仅保存在本页' }
  },
  async chaya_logs_clear() {
    clearLinkLogs()
    return { cleared: true }
  },
}
