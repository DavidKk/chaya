'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { PanelHeadEndProvider } from '@/components/PanelHeadEnd'
import { parseTranslateTab } from '@/components/translate/tabs'
import { TranslateEnginesDrawerProvider } from '@/components/translate/TranslateEnginesDrawerContext'
import { TranslateShell } from '@/components/translate/TranslateShell'
import { TranslationRuntimeProvider } from '@/components/translate/TranslationRuntimeContext'

/** layout 内持久壳：切 /translate/[tab] 时二级导航不重挂 */
export function TranslateLayoutShell({ children }: { children: ReactNode }) {
  const { translationRequest } = useGameLinkContext()
  const pathname = usePathname() || ''
  const seg = pathname.split('/').filter(Boolean).pop()
  const tab = parseTranslateTab(seg === 'translate' ? undefined : seg)
  return (
    <TranslationRuntimeProvider request={translationRequest}>
      <PanelHeadEndProvider>
        <TranslateEnginesDrawerProvider>
          <TranslateShell tab={tab} aria-label={tab === 'cache' ? '本作翻译库' : '翻译'}>
            {children}
          </TranslateShell>
        </TranslateEnginesDrawerProvider>
      </PanelHeadEndProvider>
    </TranslationRuntimeProvider>
  )
}
