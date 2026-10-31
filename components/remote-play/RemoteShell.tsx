'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { pageMainFlush, panelBody, panelShell } from '@/components/layoutClasses'
import { REMOTE_TABS, remoteTabFromPathname } from '@/components/remote-play/remote-tabs'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'

export function RemoteShell({ children }: { children: ReactNode }) {
  const t = useT()
  const pathname = usePathname() || ''
  const activeTab = remoteTabFromPathname(pathname)

  return (
    <div className={pageMainFlush}>
      <div className={`${panelShell} flex min-h-0 flex-1 flex-col`}>
        <div className={`${panelBody} min-h-0 flex-1 flex-col md:flex-row`}>
          <SectionSideNav label={t('nav.remotePlay')}>
            {REMOTE_TABS.map((item) => {
              const active = item.id === activeTab
              const Icon = item.icon
              const label = t(item.labelKey)
              return (
                <li key={item.id}>
                  <Tooltip content={label} placement="right">
                    <Link
                      href={item.href}
                      aria-label={label}
                      aria-current={active ? 'page' : undefined}
                      className={sectionSideNavItemClass(active)}
                    >
                      <SectionSideNavItemContent active={active} icon={<Icon size={17} />} />
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
