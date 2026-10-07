'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { LuBot, LuGamepad2, LuKeyboard, LuMap, LuMessageCircle } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { legalBar, pageMainFlush, panelBody, panelShell } from '@/components/layoutClasses'
import { LegalNotice } from '@/components/legal/LegalNotice'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'
import type { MessageKey } from '@/lib/i18n'

const sections = [
  { path: '/assist/hotkeys', labelKey: 'edit.hotkeys', icon: LuKeyboard },
  { path: '/assist/key-mouse', labelKey: 'nav.keyMouse', icon: LuGamepad2 },
  { path: '/assist/minimap', labelKey: 'nav.minimap', icon: LuMap },
  { path: '/assist/agents', labelKey: 'integration.agentSettingsTab', icon: LuBot },
  { path: '/assist/companion', labelKey: 'nav.companion', icon: LuMessageCircle },
] as const satisfies ReadonlyArray<{ path: string; labelKey: MessageKey; icon: typeof LuBot }>

export function AssistShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const t = useT()

  return (
    <div className={pageMainFlush}>
      <div className={panelShell} role="region" aria-label={t('nav.assist')}>
        <div className={`${panelBody} min-h-0 flex-1 flex-col md:flex-row`}>
          <SectionSideNav label={t('nav.assist')} mobile>
            {sections.map(({ path, labelKey, icon: Icon }) => {
              const active = pathname === path || pathname.startsWith(`${path}/`)
              const label = t(labelKey)
              return (
                <li key={path}>
                  <Tooltip content={label} placement="right">
                    <Link href={path} aria-label={label} aria-current={active ? 'page' : undefined} className={sectionSideNavItemClass(active)}>
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
