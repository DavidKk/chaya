'use client'

import { useMemo } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'

import { TAB_ICONS } from './tab-icons'
import { type GameEditSurface, type TabId, tabsForSurface } from './tabs'

type Props = {
  tab: TabId
  setTab: (tab: TabId) => void
  surface: GameEditSurface
}

export function GameEditTabNav({ tab, setTab, surface }: Props) {
  const t = useT()
  const tabs = useMemo(() => tabsForSurface(surface), [surface])

  return (
    <div data-edit-categories className="contents">
      <SectionSideNav label={t('edit.categoryMenu')} mobile={surface === 'overlay'}>
        {tabs.map((item) => {
          const active = item.id === tab
          const Icon = TAB_ICONS[item.id]
          const label = t(item.labelKey)
          return (
            <li key={item.id}>
              <Tooltip content={label} placement="right">
                <button
                  type="button"
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  className={`${sectionSideNavItemClass(active)} cursor-pointer`}
                  onClick={() => setTab(item.id)}
                >
                  <SectionSideNavItemContent active={active} icon={<Icon size={17} />} />
                </button>
              </Tooltip>
            </li>
          )
        })}
      </SectionSideNav>
    </div>
  )
}
