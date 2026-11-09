'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { legalBar, pageMainFlush, panelBody, panelShell } from '@/components/layoutClasses'
import { LegalNotice } from '@/components/legal/LegalNotice'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'
import { useSafeSearchParams } from '@/components/translate/safe-navigation'

import { AI_SECTIONS } from './ai-sections'

const sections = AI_SECTIONS.map((section) => ({ ...section, path: `/ai/${section.id}` }))

export function AiShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSafeSearchParams()
  const urlGameId = searchParams?.get('game') || ''
  const t = useT()

  return (
    <div className={pageMainFlush}>
      <div className={panelShell} role="region" aria-label={t('nav.ai')}>
        <div className={`${panelBody} min-h-0 flex-1 flex-col md:flex-row`}>
          <SectionSideNav label={t('nav.ai')}>
            {sections.map(({ path, labelKey, icon: Icon }) => {
              const active = pathname === path || pathname.startsWith(`${path}/`)
              const label = t(labelKey)
              return (
                <li key={path}>
                  <Tooltip content={label} placement="right">
                    <Link
                      href={urlGameId ? `${path}?game=${encodeURIComponent(urlGameId)}` : path}
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
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            <LegalNotice kind="agent" className={legalBar} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default AiShell
