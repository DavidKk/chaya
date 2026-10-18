'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { LuDatabase, LuSlidersHorizontal } from 'react-icons/lu'
import { RiTranslateAi2 } from 'react-icons/ri'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead } from '@/components/layoutClasses'
import { PanelHeadEndHost, PanelHeadStartHost } from '@/components/PanelHeadEnd'
import { PanelHeadTitle } from '@/components/PanelHeadTitle'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Button, ScrollArea, Tooltip } from '@/components/sk'
import { DEFAULT_TRANSLATE_TAB, isTranslateCacheDetailPath, TRANSLATE_TABS, translateTabHref, type TranslateTabId } from '@/components/translate/tabs'
import { useTranslateEnginesDrawer } from '@/components/translate/TranslateEnginesDrawerContext'
import { cn } from '@/lib/utils'

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
  const activeTab = tab === 'test' ? 'cache' : tab || DEFAULT_TRANSLATE_TAB

  return (
    <div data-translate-section-nav className="contents">
      <SectionSideNav label={t('translate.section')} mobile={Boolean(onSelect)}>
        {TRANSLATE_TABS.filter((item) => item.id !== 'test').map((item) => {
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
  const pathname = usePathname() || ''
  const { open, setOpen } = useTranslateEnginesDrawer()
  const showEnginesTrigger = (tab || DEFAULT_TRANSLATE_TAB) === 'run'
  const cacheDetail = !showEnginesTrigger && isTranslateCacheDetailPath(pathname)
  const cacheList = tab === 'cache' && !cacheDetail
  const titleKey = tab === 'test' ? 'translate.tabTest' : showEnginesTrigger ? 'translate.regionRun' : cacheDetail ? 'translate.regionCacheDetail' : 'translate.regionCache'
  const descKey = showEnginesTrigger ? 'translate.regionRunDesc' : cacheDetail ? 'translate.regionCacheDetailDesc' : 'translate.regionCacheDesc'

  useEffect(() => {
    if (!showEnginesTrigger) setOpen(false)
  }, [showEnginesTrigger, setOpen])

  if (tab === 'test')
    return (
      <div className={cn(panelHead, 'px-0')}>
        <ScrollArea
          indicator="horizontal"
          reserveGutter={false}
          className="h-full flex-1"
          scrollClassName="flex items-center"
          scrollProps={{ 'aria-label': t('translate.tabTest'), tabIndex: 0 }}
        >
          <div className="flex min-w-max flex-1 items-center gap-4 px-4">
            <PanelHeadStartHost />
            <PanelHeadTitle title={t(titleKey)} description={undefined} />
            <PanelHeadEndHost />
          </div>
        </ScrollArea>
      </div>
    )
  return (
    <div className={panelHead}>
      <PanelHeadStartHost className="empty:hidden" />
      <PanelHeadTitle title={t(titleKey)} description={t(descKey)} />
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
      <PanelHeadEndHost className={cacheList ? 'max-w-[calc(100%_-_6rem)] !shrink' : undefined} />
    </div>
  )
}
