import * as LogsRoute from '@/app/api/logs/route'
import { sanitizeAgentActivity } from '@/lib/game-agent/activity'
import { LOG_LEVEL_VALUES } from '@/lib/integration/mcp-catalog'
import { optNum, optStr, type ToolImpls } from '@/lib/integration/tools/args'
import type { LogLevel } from '@/lib/log/types'
import { listAgentActivityTasks, readAgentActivityTask } from '@/services/game-agent/activity.server'
import { listLogs } from '@/services/log'

import { invokeRoute } from './route-invoke'

const DEFAULT_LIMIT = 100

function textMatches(value: unknown, query?: string) {
  return !query || JSON.stringify(value).toLocaleLowerCase().includes(query.toLocaleLowerCase())
}

async function queryAgentActivity(args: Record<string, unknown>) {
  const limit = Math.min(1000, Math.max(1, optNum(args, 'limit') ?? DEFAULT_LIMIT))
  const query = optStr(args, 'q')
  const taskId = optStr(args, 'taskId')
  const gameId = optStr(args, 'gameId')
  const runtimeInstanceId = optStr(args, 'runtimeInstanceId')
  const eventType = optStr(args, 'eventType')
  if (taskId) {
    const task = await readAgentActivityTask(gameId, taskId, runtimeInstanceId)
    if (!task) return { view: 'agent', count: 0, tasks: [], events: [] }
    const events = task.events.filter((event) => (!eventType || event.type === eventType) && textMatches(event, query)).slice(-limit)
    const { events: _events, messages: _messages, ...metadata } = task
    return { view: 'agent', count: events.length, task: sanitizeAgentActivity(metadata), events: events.map((event) => sanitizeAgentActivity(event)) }
  }
  const tasks = (await listAgentActivityTasks(gameId, runtimeInstanceId)).filter((task) => textMatches(task, query)).slice(0, limit)
  return { view: 'agent', count: tasks.length, tasks: tasks.map((task) => sanitizeAgentActivity(task)) }
}

export const logsTools: ToolImpls = {
  async chaya_logs_query(args) {
    if (optStr(args, 'view') === 'agent') return queryAgentActivity(args)
    const level = optStr(args, 'level') as LogLevel | undefined
    if (level && !LOG_LEVEL_VALUES.includes(level)) throw new Error(`level must be one of: ${LOG_LEVEL_VALUES.join(', ')}`)
    const entries = listLogs({ q: optStr(args, 'q'), source: optStr(args, 'source'), level, since: optNum(args, 'since'), limit: optNum(args, 'limit') ?? DEFAULT_LIMIT })
    return { count: entries.length, entries }
  },

  async chaya_logs_clear(_args, { signal }) {
    await invokeRoute(LogsRoute.DELETE, { method: 'DELETE', path: '/api/logs', signal })
    return { cleared: true }
  },
}
