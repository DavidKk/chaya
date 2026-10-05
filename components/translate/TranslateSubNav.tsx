'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { LuDatabase, LuSlidersHorizontal } from 'react-icons/lu'
import { RiTranslateAi2 } from 'react-icons/ri'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead } from '@/components/layoutClasses'
import { PanelHeadEndHost } from '@/components/PanelHeadEnd'
import { PanelHeadTitle } from '@/components/PanelHeadTitle'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Button, Tooltip } from '@/components/sk'
import { DEFAULT_TRANSLATE_TAB, TRANSLATE_TABS, translateTabHref, type TranslateTabId } from '@/components/translate/tabs'
import { useTranslateEnginesDrawer } from '@/components/translate/TranslateEnginesDrawerContext'

const TAB_ICON = {
  run: RiTranslateAi2,
  cache: LuDatabase,
} as const

type NavProps = {
  tab: TranslateTabId
  onSelect?: (tab: TranslateTabId) => void
}

/** 网页与局内共用的翻译区二级 Icon Rail。 */
export function TranslateSubNav({ tab, onSelect }: NavProps) {
  const t = useT()
  const activeTab = tab || DEFAULT_TRANSLATE_TAB

  return (
    <div data-translate-section-nav className="contents">
      <SectionSideNav label={t('translate.section')} mobile={Boolean(onSelect)}>
        {TRANSLATE_TABS.map((item) => {
          const active = item.id === activeTab
          const Icon = TAB_ICON[item.id]
          const label = t(item.labelKey)
          const content = <SectionSideNavItemContent active={active} icon={<Icon size={17} />} />
          return (
            <li key={item.id}>
              <Tooltip content={label} placement="right">
                {onSelect ? (
                  <button
                    type="button"
                    aria-label={label}
                    aria-current={active ? 'page' : undefined}
                    className={`${sectionSideNavItemClass(active)} cursor-pointer`}
                    onClick={() => onSelect(item.id)}
                  >
                    {content}
                  </button>
                ) : (
                  <Link href={translateTabHref(item.id)} aria-label={label} aria-current={active ? 'page' : undefined} className={sectionSideNavItemClass(active)}>
                    {content}
                  </Link>
                )}
              </Tooltip>
            </li>
          )
        })}
      </SectionSideNav>
    </div>
  )
}

/** 内容工具栏：保留小屏引擎入口和内容页注入的筛选操作。 */
export function TranslateContentToolbar({ tab }: { tab: TranslateTabId }) {
  const t = useT()
  const { open, setOpen } = useTranslateEnginesDrawer()
  const showEnginesTrigger = (tab || DEFAULT_TRANSLATE_TAB) === 'run'

  useEffect(() => {
    if (!showEnginesTrigger) setOpen(false)
  }, [showEnginesTrigger, setOpen])

  return (
    <div className={panelHead}>
      <PanelHeadTitle
        title={t(showEnginesTrigger ? 'translate.regionRun' : 'translate.regionCache')}
        description={t(showEnginesTrigger ? 'translate.regionRunDesc' : 'translate.regionCacheDesc')}
      />
      {showEnginesTrigger ? (
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t('translate.platforms')}
          tooltip={t('translate.platforms')}
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <LuSlidersHorizontal size={16} aria-hidden />
        </Button>
      ) : null}
      <PanelHeadEndHost />
    </div>
  )
}
