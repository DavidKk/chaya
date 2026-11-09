import type { MessageKey } from '@/lib/i18n'

export const INTEGRATION_TABS = [
  { id: 'mcp', labelKey: 'integration.tabMcp', href: '/integration/mcp' },
  { id: 'webmcp', labelKey: 'integration.tabWebMcp', href: '/integration/webmcp' },
  { id: 'openapi', labelKey: 'integration.tabOpenApi', href: '/integration/openapi' },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; href: string }>

export type IntegrationTabId = (typeof INTEGRATION_TABS)[number]['id']

export function integrationTabFromPathname(pathname: string): IntegrationTabId {
  if (pathname.startsWith('/integration/webmcp')) return 'webmcp'
  if (pathname.startsWith('/integration/openapi')) return 'openapi'
  return 'mcp'
}
