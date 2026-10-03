import { type LogEntry, type LogLevel, normalizeLogLevel } from './types'

export type LogQuery = { limit?: number; source?: string; level?: LogLevel; since?: number; q?: string }

/** 服务端缓冲与页面（游戏连接）日志共用的筛选口径 */
export function filterLogEntries(rows: readonly LogEntry[], opts?: LogQuery): LogEntry[] {
  const limit = Math.min(1000, Math.max(1, opts?.limit ?? 200))
  let out = rows as LogEntry[]
  if (opts?.source) {
    const s = opts.source.toLowerCase()
    out = out.filter((e) => e.source.toLowerCase() === s)
  }
  if (opts?.level) {
    const lv = normalizeLogLevel(opts.level)
    out = out.filter((e) => e.level === lv)
  }
  if (opts?.since) out = out.filter((e) => e.ts >= opts.since!)
  const q = opts?.q?.trim().toLowerCase()
  if (q) out = out.filter((e) => e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q))
  return out.slice(-limit)
}
