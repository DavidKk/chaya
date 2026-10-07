'use client'

import Link from 'next/link'
import { IoChatbubblesOutline, IoMapOutline } from 'react-icons/io5'
import { RiRobot2Line } from 'react-icons/ri'

import { useT } from '@/components/i18n/LocaleProvider'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'

export type SettingsSection = 'agents' | 'minimap' | 'companion'

export function SettingsSectionNav({ active = 'agents', onSelect }: { active?: SettingsSection; onSelect?: (section: SettingsSection) => void }) {
  const t = useT()
  const items = [
    { id: 'agents' as const, label: t('integration.agentSettingsTab'), icon: <RiRobot2Line size={17} /> },
    { id: 'minimap' as const, label: t('nav.minimap'), icon: <IoMapOutline size={17} /> },
    { id: 'companion' as const, label: t('nav.companion'), icon: <IoChatbubblesOutline size={17} /> },
  ]
  return (
    <div data-settings-section-nav className="contents">
      <SectionSideNav label={t('integration.agentSettingsSection')} mobile={!!onSelect}>
        {items.map((item) => (
          <li key={item.id}>
            <Tooltip content={item.label} placement="right">
              {onSelect ? (
                <button
                  type="button"
                  aria-label={item.label}
                  aria-current={active === item.id ? 'page' : undefined}
                  className={`${sectionSideNavItemClass(active === item.id)} cursor-pointer`}
                  onClick={() => onSelect(item.id)}
                >
                  <SectionSideNavItemContent active={active === item.id} icon={item.icon} />
                </button>
              ) : (
                <Link
                  href={`/assist/${item.id}`}
                  aria-label={item.label}
                  aria-current={active === item.id ? 'page' : undefined}
                  className={sectionSideNavItemClass(active === item.id)}
                >
                  <SectionSideNavItemContent active={active === item.id} icon={item.icon} />
                </Link>
              )}
            </Tooltip>
          </li>
        ))}
      </SectionSideNav>
    </div>
  )
}
