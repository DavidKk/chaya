'use client'

import type { ReactNode } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { legalBar, pageMainFlush, panelBody, panelShell } from '@/components/layoutClasses'
import { LegalNotice } from '@/components/legal/LegalNotice'
import { isTranslateCacheDetailPath, type TranslateTabId } from '@/components/translate/tabs'
import { TranslateContentToolbar, TranslateSubNav } from '@/components/translate/TranslateSubNav'
import { cn } from '@/lib/utils'

type Props = {
  tab: TranslateTabId
  children: ReactNode
  pathname?: string
  'aria-label'?: string
  bodyClassName?: string
}

/** 翻译区外壳：二级 tabs；由 layout 挂载以在切 tab 时保持不重挂；筛选走 `PanelHeadEnd` */
export function TranslateShell({ tab, children, pathname = '', 'aria-label': ariaLabel, bodyClassName }: Props) {
  const t = useT()
  const cacheDetail = tab === 'cache' && isTranslateCacheDetailPath(pathname)
  const defaultAria = tab === 'cache' ? t(cacheDetail ? 'translate.regionCacheDetail' : 'translate.regionCache') : t('translate.regionRun')
  return (
    <div className={pageMainFlush}>
      <div className={panelShell} role="region" aria-label={ariaLabel ?? defaultAria}>
        <div className={`${panelBody} flex-col md:flex-row`}>
          <TranslateSubNav tab={tab} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TranslateContentToolbar tab={tab} />
            <div className={cn('flex min-h-0 flex-1 flex-col bg-paper-2', bodyClassName)}>{children}</div>
            <LegalNotice kind="translate" className={legalBar} />
          </div>
        </div>
      </div>
    </div>
  )
}
