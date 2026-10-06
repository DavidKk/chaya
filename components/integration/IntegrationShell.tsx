'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { LuFileCode2, LuGlobe, LuPlug } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { INTEGRATION_TABS, integrationTabFromPathname } from '@/components/integration/tabs'
import { legalBar, pageMainFlush, panelBody, panelShell } from '@/components/layoutClasses'
import { LegalNotice } from '@/components/legal/LegalNotice'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'
import type { MessageKey } from '@/lib/i18n'

const REGION_LABEL = {
  skills: 'integration.regionSkills',
  mcp: 'integration.regionMcp',
  webmcp: 'integration.regionWebMcp',
} as const satisfies Record<string, MessageKey>

const TAB_ICON = {
  skills: LuFileCode2,
  mcp: LuPlug,
  webmcp: LuGlobe,
} as const

/** layout 内持久壳：切子页时二级导航不重挂 */
export function IntegrationShell({ children }: { children: ReactNode }) {
  const t = useT()
  const tab = integrationTabFromPathname(usePathname() || '')

  return (
    <div className={pageMainFlush}>
      <div className={panelShell} role="region" aria-label={t(REGION_LABEL[tab])}>
        <div className={`${panelBody} min-h-0 flex-1 flex-col md:flex-row`}>
          <SectionSideNav label={t('integration.section')}>
            {INTEGRATION_TABS.map((item) => {
              const active = item.id === tab
              const Icon = TAB_ICON[item.id]
              const label = t(item.labelKey)
              return (
                <li key={item.id}>
                  <Tooltip content={label} placement="right">
                    <Link href={item.href} aria-label={label} aria-current={active ? 'page' : undefined} className={sectionSideNavItemClass(active)}>
                      <SectionSideNavItemContent active={active} icon={<Icon size={17} />} />
                    </Link>
                  </Tooltip>
                </li>
              )
            })}
          </SectionSideNav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            <LegalNotice kind="integration" className={legalBar} />
          </div>
        </div>
      </div>
    </div>
  )
}
