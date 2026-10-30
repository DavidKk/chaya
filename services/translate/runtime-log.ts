import type { LogLevel } from '@/lib/log'
import { runtimeEvent } from '@/services/log/operation'

export type TranslationRuntimeLog = {
  level: LogLevel
  source: string
  message: string
  meta?: Record<string, unknown>
  ts: number
}

export function logTranslationEvent(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  runtimeEvent(level, 'translate', message, meta, true)
}
