'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { PanelHeadEndProvider } from '@/components/PanelHeadEnd'
import { translatePathTab } from '@/components/translate/tabs'
import { TranslateEnginesDrawerProvider } from '@/components/translate/TranslateEnginesDrawerContext'
import { TranslateShell } from '@/components/translate/TranslateShell'
import { TranslationRuntimeProvider } from '@/components/translate/TranslationRuntimeContext'
import { diskTranslationRequest } from '@/lib/translate/runtime-api'

/**
 * layout 内持久壳：切 /translate/[tab] 时二级导航不重挂。
 * 共享翻译库（cache）始终走本机 sqlite；run 在已连接时走插件运行时，否则走磁盘接口。
 */
export function TranslateLayoutShell({ children }: { children: ReactNode }) {
  const { translationRequest, connected } = useGameLinkContext()
  const pathname = usePathname() || ''
  const tab = translatePathTab(pathname)
  const request = tab !== 'run' || !connected ? diskTranslationRequest : translationRequest
  return (
    <TranslationRuntimeProvider request={request}>
      <PanelHeadEndProvider>
        <TranslateEnginesDrawerProvider>
          <TranslateShell tab={tab} pathname={pathname}>
            {children}
          </TranslateShell>
        </TranslateEnginesDrawerProvider>
      </PanelHeadEndProvider>
    </TranslationRuntimeProvider>
  )
}
