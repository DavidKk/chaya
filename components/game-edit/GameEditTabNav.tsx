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
  /** Tabs with live activity (e.g. a running battle): a dot on the icon, the text joins the label */
  dots?: Partial<Record<TabId, string>>
}

export function GameEditTabNav({ tab, setTab, surface, dots }: Props) {
  const t = useT()
  const tabs = useMemo(() => tabsForSurface(surface), [surface])

  return (
    <div data-edit-categories className="contents">
      <SectionSideNav label={t('edit.categoryMenu')} mobile={surface === 'overlay'}>
        {tabs.map((item) => {
          const active = item.id === tab
          const Icon = TAB_ICONS[item.id]
          const dot = dots?.[item.id]
          const label = dot ? `${t(item.labelKey)} · ${dot}` : t(item.labelKey)
          return (
            <li key={item.id}>
              <Tooltip content={label} placement="right">
                <button
                  type="button"
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  className={`${sectionSideNavItemClass(active)} relative cursor-pointer`}
                  onClick={() => setTab(item.id)}
                >
                  <SectionSideNavItemContent active={active} icon={<Icon size={17} />} />
                  {dot ? <span className="pointer-events-none absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> : null}
                </button>
              </Tooltip>
            </li>
          )
        })}
      </SectionSideNav>
    </div>
  )
}
