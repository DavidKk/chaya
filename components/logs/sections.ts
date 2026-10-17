import { LuBot, LuScrollText, LuTerminal } from 'react-icons/lu'

import type { MessageKey } from '@/lib/i18n'

/** Web `/logs/*` 与局内浮层「日志」共用的二级分区 */
export const LOGS_SECTIONS = [
  { id: 'runtime', labelKey: 'logs.runtime', icon: LuScrollText },
  { id: 'agent', labelKey: 'logs.agentActivity', icon: LuBot },
  { id: 'cli', labelKey: 'logs.cliProcesses', icon: LuTerminal },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; icon: typeof LuBot }>

export type LogsSection = (typeof LOGS_SECTIONS)[number]['id']

export const DEFAULT_LOGS_SECTION: LogsSection = 'runtime'

export function isLogsSection(value: unknown): value is LogsSection {
  return LOGS_SECTIONS.some((section) => section.id === value)
}

export function parseLogsSection(raw: string | undefined | null): LogsSection {
  return isLogsSection(raw) ? raw : DEFAULT_LOGS_SECTION
}

export function logsSectionHref(section: LogsSection = DEFAULT_LOGS_SECTION): string {
  return `/logs/${section}`
}
