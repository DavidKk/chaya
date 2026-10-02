import * as LogsRoute from '@/app/api/logs/route'
import { LOG_LEVEL_VALUES } from '@/lib/integration/mcp-catalog'
import { optNum, optStr, type ToolImpls } from '@/lib/integration/tools/args'
import type { LogLevel } from '@/lib/log/types'
import { listLogs } from '@/services/log'

import { invokeRoute } from './route-invoke'

const DEFAULT_LIMIT = 100

export const logsTools: ToolImpls = {
  async chaya_logs_query(args) {
    const level = optStr(args, 'level') as LogLevel | undefined
    if (level && !LOG_LEVEL_VALUES.includes(level)) throw new Error(`level 只能是：${LOG_LEVEL_VALUES.join(', ')}`)
    const entries = listLogs({ q: optStr(args, 'q'), source: optStr(args, 'source'), level, since: optNum(args, 'since'), limit: optNum(args, 'limit') ?? DEFAULT_LIMIT })
    return { count: entries.length, entries }
  },

  async chaya_logs_clear(_args, { signal }) {
    await invokeRoute(LogsRoute.DELETE, { method: 'DELETE', path: '/api/logs', signal })
    return { cleared: true }
  },
}
