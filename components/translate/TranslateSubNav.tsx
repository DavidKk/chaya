'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LuDatabase, LuGamepad2, LuList, LuScanText, LuSlidersHorizontal } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead } from '@/components/layoutClasses'
import { PanelHeadEndHost, PanelHeadStartHost } from '@/components/PanelHeadEnd'
import { PanelHeadTitle } from '@/components/PanelHeadTitle'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { ScrollArea, Tooltip } from '@/components/sk'
import { DEFAULT_TRANSLATE_TAB, isTranslateCacheDetailPath, TRANSLATE_TABS, translateTabHref, type TranslateTabId } from '@/components/translate/tabs'
import { cn } from '@/lib/utils'

const TAB_ICON: Record<Exclude<TranslateTabId, 'test'>, typeof LuScanText> = {
  seed: LuScanText,
  list: LuList,
  play: LuGamepad2,
  engines: LuSlidersHorizontal,
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
          const Icon = TAB_ICON[item.id as Exclude<TranslateTabId, 'test'>]
          const label = t(item.labelKey)
          const content = <SectionSideNavItemContent active={active} icon={<Icon size={17} />} />
          return (
            <li key={item.id}>
              <Tooltip content={label} placement="right">
                {onSelect ? (
                  <button
                    type="button"
                    data-nav-id={item.id}
                    aria-label={label}
                    aria-current={active ? 'page' : undefined}
                    className={`${sectionSideNavItemClass(active)} cursor-pointer`}
                    onClick={() => onSelect(item.id)}
                  >
                    {content}
                  </button>
                ) : (
                  <Link
                    href={translateTabHref(item.id)}
                    data-nav-id={item.id}
                    aria-label={label}
                    aria-current={active ? 'page' : undefined}
                    className={sectionSideNavItemClass(active)}
                  >
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
  const cacheDetail = tab === 'cache' && isTranslateCacheDetailPath(pathname)
  const cacheList = tab === 'cache' && !cacheDetail

  const titleKey =
    tab === 'test'
      ? 'translate.tabTest'
      : tab === 'seed'
        ? 'translate.seedTab'
        : tab === 'list'
          ? 'translate.listTab'
          : tab === 'play'
            ? 'translate.playTab'
            : tab === 'engines'
              ? 'translate.enginesTab'
              : cacheDetail
                ? 'translate.regionCacheDetail'
                : 'translate.tabCache'

  const descKey =
    tab === 'test'
      ? undefined
      : tab === 'seed'
        ? 'translate.seedTabDesc'
        : tab === 'list'
          ? 'translate.listTabDesc'
          : tab === 'play'
            ? 'translate.playTabDesc'
            : tab === 'engines'
              ? 'translate.enginesTabDesc'
              : cacheDetail
                ? 'translate.regionCacheDetailDesc'
                : 'translate.regionCacheDesc'

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
      <PanelHeadTitle title={t(titleKey as any)} description={descKey ? t(descKey as any) : undefined} />
      <PanelHeadEndHost className={cacheList ? 'max-w-[calc(100%_-_6rem)] !shrink' : undefined} />
    </div>
  )
}
