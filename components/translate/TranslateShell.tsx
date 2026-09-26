'use client'

import type { ReactNode } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { pageMainFlush, panelBody, panelShell } from '@/components/layoutClasses'
import type { TranslateTabId } from '@/components/translate/tabs'
import { TranslateSubNav } from '@/components/translate/TranslateSubNav'
import { cn } from '@/lib/utils'

type Props = {
  tab: TranslateTabId
  children: ReactNode
  'aria-label'?: string
  bodyClassName?: string
}

/** 翻译区外壳：二级 tabs；由 layout 挂载以在切 tab 时保持不重挂；筛选走 `PanelHeadEnd` */
export function TranslateShell({ tab, children, 'aria-label': ariaLabel, bodyClassName }: Props) {
  const t = useT()
  return (
    <div className={pageMainFlush}>
      <div className={panelShell} role="region" aria-label={ariaLabel ?? (tab === 'cache' ? t('translate.regionCache') : t('translate.regionRun'))}>
        <TranslateSubNav tab={tab} />
        <div className={cn(panelBody, 'min-h-0 flex-1', bodyClassName)}>{children}</div>
      </div>
    </div>
  )
}
