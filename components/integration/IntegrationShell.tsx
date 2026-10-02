'use client'

import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useMemo } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { INTEGRATION_TABS, integrationTabFromPathname } from '@/components/integration/tabs'
import { pageMainFlush, panelBody, panelHead, panelShell } from '@/components/layoutClasses'
import { SegmentedNav } from '@/components/sk'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const REGION_LABEL = {
  skills: 'integration.regionSkills',
  mcp: 'integration.regionMcp',
  webmcp: 'integration.regionWebMcp',
} as const satisfies Record<string, MessageKey>

/** layout 内持久壳：切子页时二级导航不重挂 */
export function IntegrationShell({ children }: { children: ReactNode }) {
  const t = useT()
  const router = useRouter()
  const tab = integrationTabFromPathname(usePathname() || '')
  const items = useMemo(() => INTEGRATION_TABS.map((item) => ({ id: item.id, label: t(item.labelKey) })), [t])

  return (
    <div className={pageMainFlush}>
      <div className={panelShell} role="region" aria-label={t(REGION_LABEL[tab])}>
        <div className={panelHead}>
          <SegmentedNav
            items={items}
            value={tab}
            onChange={(id) => router.push(INTEGRATION_TABS.find((item) => item.id === id)?.href ?? INTEGRATION_TABS[0].href)}
            aria-label={t('integration.section')}
          />
        </div>
        <div className={cn(panelBody, 'min-h-0 flex-1')}>{children}</div>
      </div>
    </div>
  )
}
