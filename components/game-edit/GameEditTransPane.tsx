'use client'

import { useMemo, useState } from 'react'
import { LuSlidersHorizontal } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelBody, panelHead } from '@/components/layoutClasses'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { PanelHeadEndHost, PanelHeadEndProvider } from '@/components/PanelHeadEnd'
import { Button, SegmentedNav } from '@/components/sk'
import { CacheBrowserOverlay } from '@/components/translate/CacheBrowserContent'
import { TRANSLATE_TABS, type TranslateTabId } from '@/components/translate/tabs'
import { TranslateEnginesDrawerProvider, useTranslateEnginesDrawer } from '@/components/translate/TranslateEnginesDrawerContext'
import { TranslateRunPane } from '@/components/TranslateRunPane'

type Props = {
  /** `overlay` 需自带通知宿主（Shadow 内有 token） */
  surface?: 'page' | 'overlay'
  /** 父级刷新时递增，强制重挂载以拉最新进度 */
  refreshKey?: number
  tab?: 'play' | 'seed'
  onTabChange?: (tab: 'play' | 'seed') => void
  section?: TranslateTabId
  onSectionChange?: (section: TranslateTabId) => void
}

function OverlaySubNav({ section, onSectionChange }: { section: TranslateTabId; onSectionChange: (section: TranslateTabId) => void }) {
  const t = useT()
  const { open, setOpen } = useTranslateEnginesDrawer()
  const items = useMemo(() => TRANSLATE_TABS.map((item) => ({ id: item.id, label: t(item.labelKey) })), [t])
  return (
    <div className={panelHead}>
      {section === 'run' ? (
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
      <SegmentedNav items={items} value={section} onChange={onSectionChange} aria-label={t('translate.section')} />
      <PanelHeadEndHost />
    </div>
  )
}

/** Web 与局内共用运行设置和翻译库内容；局内只换导航与查询状态。 */
export function GameEditTransPane({ surface = 'page', refreshKey = 0, tab, onTabChange, section = 'run', onSectionChange }: Props) {
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null)
  const [localSection, setLocalSection] = useState<TranslateTabId>('run')
  const activeSection = onSectionChange ? section : localSection
  const setSection = onSectionChange ?? setLocalSection
  const pane = <TranslateRunPane key={refreshKey} tab={tab} onTabChange={onTabChange} surface={surface} />

  if (surface === 'overlay') {
    return (
      <div ref={setPortalHost} className="relative flex min-h-0 flex-1 flex-col">
        <NotificationProvider portalContainer={portalHost}>
          <TranslateEnginesDrawerProvider>
            <PanelHeadEndProvider>
              <OverlaySubNav section={activeSection} onSectionChange={setSection} />
              <div className={panelBody}>{activeSection === 'run' ? pane : <CacheBrowserOverlay />}</div>
            </PanelHeadEndProvider>
          </TranslateEnginesDrawerProvider>
        </NotificationProvider>
      </div>
    )
  }

  return (
    <TranslateEnginesDrawerProvider>
      <div className="flex min-h-0 flex-1 flex-col">{pane}</div>
    </TranslateEnginesDrawerProvider>
  )
}
