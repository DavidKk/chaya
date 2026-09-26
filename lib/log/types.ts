export type LogLevel = 'ok' | 'warn' | 'fail' | 'info' | 'debug'

export type LogEntry = {
  id: string
  ts: number
  level: LogLevel
  /** 来源：ChayaEdit / ChayaTrans / ChayaBoost / translate / chaya … */
  source: string
  message: string
  meta?: unknown
}

export const LOG_LEVELS: readonly LogLevel[] = ['ok', 'warn', 'fail', 'info', 'debug'] as const

const LEVEL_SET = new Set<string>(LOG_LEVELS)

/** 兼容旧别名：error→fail，success→ok，trace/log→debug */
export function normalizeLogLevel(raw?: string): LogLevel {
  const v = String(raw || 'info').toLowerCase()
  if (v === 'error' || v === 'fatal') return 'fail'
  if (v === 'success' || v === 'done') return 'ok'
  if (v === 'trace' || v === 'log') return 'debug'
  if (LEVEL_SET.has(v)) return v as LogLevel
  return 'info'
}
