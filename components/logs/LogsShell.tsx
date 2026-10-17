'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { pageMainFlush, panelBody, panelShell } from '@/components/layoutClasses'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'

import { LOGS_SECTIONS, logsSectionHref, parseLogsSection } from './sections'

export function LogsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || ''
  const t = useT()
  const active = parseLogsSection(pathname.split('/')[2])

  return (
    <div className={pageMainFlush}>
      <div className={`${panelShell} flex min-h-0 flex-1 flex-col`}>
        <div className={`${panelBody} min-h-0 flex-1 flex-col md:flex-row`}>
          <SectionSideNav label={t('nav.logs')}>
            {LOGS_SECTIONS.map(({ id, labelKey, icon: Icon }) => {
              const href = logsSectionHref(id)
              const selected = active === id
              const label = t(labelKey)
              return (
                <li key={id}>
                  <Tooltip content={label} placement="right">
                    <Link href={href} aria-label={label} aria-current={selected ? 'page' : undefined} className={sectionSideNavItemClass(selected)}>
                      <SectionSideNavItemContent active={selected} icon={<Icon size={17} />} />
                    </Link>
                  </Tooltip>
                </li>
              )
            })}
          </SectionSideNav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </div>
    </div>
  )
}
