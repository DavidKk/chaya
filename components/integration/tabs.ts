import type { MessageKey } from '@/lib/i18n'

export const INTEGRATION_TABS = [
  { id: 'skills', labelKey: 'integration.tabSkills', href: '/integration/skills' },
  { id: 'mcp', labelKey: 'integration.tabMcp', href: '/integration/mcp' },
  { id: 'webmcp', labelKey: 'integration.tabWebMcp', href: '/integration/webmcp' },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; href: string }>

export type IntegrationTabId = (typeof INTEGRATION_TABS)[number]['id']

export function integrationTabFromPathname(pathname: string): IntegrationTabId {
  if (pathname.startsWith('/integration/webmcp')) return 'webmcp'
  return pathname.startsWith('/integration/mcp') ? 'mcp' : 'skills'
}
