'use client'

import { Bot } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { type ReactNode, useState } from 'react'

import { AppTopBar } from '@/components/AppTopBar'
import { DownloadsRuntime } from '@/components/downloads/DownloadsRuntime'
import { GameAgentAppPanel } from '@/components/game-agent/GameAgentAppPanel'
import { pageShell } from '@/components/layoutClasses'
import { Button } from '@/components/sk'
import { LEGAL_HREFS } from '@/lib/legal'

/** 全局壳：顶栏固定在 layout，路由切换只换下方内容，避免整页重挂 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [agentOpen, setAgentOpen] = useState(false)
  /** Edge 官方首页、条款页与 `/sh/*` 脚本页不挂控制台顶栏 */
  const marketing = pathname === '/' || LEGAL_HREFS.has(pathname) || pathname.startsWith('/sh/')

  return (
    <div className={pageShell}>
      <DownloadsRuntime />
      {marketing ? null : (
        <AppTopBar
          end={
            <Button
              variant="ghost"
              size="icon"
              className="aria-expanded:border-[rgb(230_238_248/0.18)] aria-expanded:bg-[rgb(230_238_248/0.06)] aria-expanded:text-ink"
              aria-label="Chaya 助手"
              tooltip="Chaya 助手"
              aria-expanded={agentOpen}
              onClick={() => setAgentOpen((open) => !open)}
            >
              <Bot size={15} aria-hidden />
            </Button>
          }
        />
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
        {marketing ? null : (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-30 flex justify-end">
            <div className="pointer-events-auto flex h-full">
              <GameAgentAppPanel open={agentOpen} onClose={() => setAgentOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
