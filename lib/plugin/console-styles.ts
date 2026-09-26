/**
 * DevTools `%c` 样式 — 改编自 MagickMonkey `shared/vws-console-log-styles.ts`
 * 徽章见 `@/constants/brand` CONSOLE_BADGE
 */

import { CONSOLE_BADGE } from '@/constants/brand'

export type ChayaConsoleLogLevel = 'ok' | 'info' | 'warn' | 'fail'

const LEVEL_LABEL: Record<ChayaConsoleLogLevel, string> = {
  ok: 'OK',
  info: 'INFO',
  warn: 'WARN',
  fail: 'FAIL',
}

const BADGE_STYLE = 'background:#0f766e;color:#fff;padding:1px 6px;border-radius:3px;font-weight:700;font-size:10px;'

const LEVEL_STYLE: Record<ChayaConsoleLogLevel, string> = {
  ok: 'color:#16a34a;font-weight:600;',
  info: 'color:#0891b2;font-weight:600;',
  warn: 'color:#ca8a04;font-weight:600;',
  fail: 'color:#dc2626;font-weight:600;',
}

const SCOPE_STYLE = 'color:#0d9488;font-weight:600;'
const MESSAGE_RESET = 'color:inherit;font-weight:normal;'

export type ChayaConsolePrefix = {
  format: string
  styles: string[]
}

export function buildChayaConsolePrefix(scope: string, level: ChayaConsoleLogLevel): ChayaConsolePrefix {
  return {
    format: `%c${CONSOLE_BADGE}%c %c${LEVEL_LABEL[level]}%c %c${scope.trim()}%c`,
    styles: [BADGE_STYLE, MESSAGE_RESET, LEVEL_STYLE[level], MESSAGE_RESET, SCOPE_STYLE, MESSAGE_RESET],
  }
}

export function buildChayaConsoleLogArgs(scope: string, level: ChayaConsoleLogLevel, ...messageParts: unknown[]): unknown[] {
  const { format, styles } = buildChayaConsolePrefix(scope, level)
  return [format, ...styles, ...messageParts]
}
