'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { AppTopBar } from '@/components/AppTopBar'
import { pageShell } from '@/components/layoutClasses'

/** 全局壳：顶栏固定在 layout，路由切换只换下方内容，避免整页重挂 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  /** Edge 官方首页与 `/sh/*` 脚本页不挂控制台顶栏 */
  const marketing = pathname === '/' || pathname.startsWith('/sh/')

  return (
    <div className={pageShell}>
      {marketing ? null : <AppTopBar />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
