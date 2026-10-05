'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { AppNav, type AppNavPath } from '@/components/AppNav'
import { BrandLogo } from '@/components/BrandLogo'
import { DevTargetSwitch } from '@/components/DevTargetSwitch'
import { DownloadCenter } from '@/components/downloads/DownloadCenter'
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher'
import { brand, topBarFrame, topBarNav, topBarRow, topRight } from '@/components/layoutClasses'
import { BUILD_TARGET } from '@/lib/service-mode/target'
import { cn } from '@/lib/utils'

export function appNavPathFromPathname(pathname: string): AppNavPath {
  if (pathname.startsWith('/cheat') || pathname.startsWith('/edit')) return '/cheat'
  if (pathname.startsWith('/translate') || pathname.startsWith('/cache')) return '/translate'
  if (pathname.startsWith('/logs')) return '/logs'
  if (pathname.startsWith('/integration')) return '/integration'
  if (pathname.startsWith('/settings')) return '/settings'
  return '/game'
}

type Props = {
  /** 省略则按当前 pathname 高亮 */
  current?: AppNavPath
  end?: ReactNode
  className?: string
}

/**
 * 应用顶栏：品牌 + 主导航 + 右上角下载中心与语言切换。
 * 导航槽相对内容行向下多 1px，指示条盖住 frame 的 border-b；frame 无 overflow，避免裁切。
 */
export function AppTopBar({ current, end, className }: Props) {
  const pathname = usePathname()
  const resolved = current ?? appNavPathFromPathname(pathname)

  return (
    <header className={cn(topBarFrame, className)}>
      <div className={cn(topBarRow, 'items-stretch')}>
        <div className="flex shrink-0 items-center">
          <BrandLogo href="/" className={brand} />
        </div>
        <div className={topBarNav}>
          <AppNav current={resolved} />
        </div>
        <div className={cn(topRight, 'self-center')}>
          {BUILD_TARGET === 'dev' ? <DevTargetSwitch /> : null}
          <DownloadCenter />
          <LocaleSwitcher />
          {end}
        </div>
      </div>
    </header>
  )
}
