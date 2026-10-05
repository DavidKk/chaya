'use client'

import { useState } from 'react'

import { panelBody } from '@/components/layoutClasses'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { PanelHeadEndProvider } from '@/components/PanelHeadEnd'
import { CacheBrowserOverlay } from '@/components/translate/CacheBrowserContent'
import type { TranslateTabId } from '@/components/translate/tabs'
import { TranslateEnginesDrawerProvider } from '@/components/translate/TranslateEnginesDrawerContext'
import { TranslateContentToolbar, TranslateSubNav } from '@/components/translate/TranslateSubNav'
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
              <div className={`${panelBody} flex-col md:flex-row`}>
                <TranslateSubNav tab={activeSection} onSelect={setSection} />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <TranslateContentToolbar tab={activeSection} />
                  <div className="flex min-h-0 flex-1 flex-col bg-paper-2">{activeSection === 'run' ? pane : <CacheBrowserOverlay />}</div>
                </div>
              </div>
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
