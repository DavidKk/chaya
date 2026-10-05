'use client'

import Link from 'next/link'
import { RiRobot2Line } from 'react-icons/ri'

import { useT } from '@/components/i18n/LocaleProvider'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'

export function SettingsSectionNav({ href, onSelect }: { href?: string; onSelect?: () => void }) {
  const t = useT()
  const label = t('integration.agentSettingsTab')
  return (
    <div data-settings-section-nav className="contents">
      <SectionSideNav label={t('integration.agentSettingsSection')} mobile={!href}>
        <li>
          {href ? (
            <Tooltip content={label} placement="right">
              <Link href={href} aria-label={label} aria-current="page" className={sectionSideNavItemClass(true)}>
                <SectionSideNavItemContent active icon={<RiRobot2Line size={17} />} />
              </Link>
            </Tooltip>
          ) : (
            <Tooltip content={label} placement="right">
              <button type="button" aria-label={label} aria-current="page" className={`${sectionSideNavItemClass(true)} cursor-pointer`} onClick={onSelect}>
                <SectionSideNavItemContent active icon={<RiRobot2Line size={17} />} />
              </button>
            </Tooltip>
          )}
        </li>
      </SectionSideNav>
    </div>
  )
}
