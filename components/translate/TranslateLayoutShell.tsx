'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { PanelHeadEndProvider } from '@/components/PanelHeadEnd'
import { parseTranslateTab } from '@/components/translate/tabs'
import { TranslateEnginesDrawerProvider } from '@/components/translate/TranslateEnginesDrawerContext'
import { TranslateShell } from '@/components/translate/TranslateShell'
import { TranslationRuntimeProvider } from '@/components/translate/TranslationRuntimeContext'
import { diskTranslationRequest } from '@/lib/translate/runtime-api'

/**
 * layout 内持久壳：切 /translate/[tab] 时二级导航不重挂。
 * 游戏已连接走插件运行时；未连接（仅本机服务能进到这里）走服务端磁盘接口。
 */
export function TranslateLayoutShell({ children }: { children: ReactNode }) {
  const { translationRequest, connected } = useGameLinkContext()
  const pathname = usePathname() || ''
  const seg = pathname.split('/').filter(Boolean).pop()
  const tab = parseTranslateTab(seg === 'translate' ? undefined : seg)
  return (
    <TranslationRuntimeProvider request={connected ? translationRequest : diskTranslationRequest}>
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
