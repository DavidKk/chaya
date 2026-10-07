import type { ReactNode } from 'react'
import { Suspense } from 'react'

import { GameEditBoundLoading } from '@/components/game-edit/GameEditPaneSkeleton'
import { GameEditPage } from '@/components/GameEditPage'

/** 状态放在 layout，切换 `/cheat/[tab]` 时不丢会话预览；未连接游戏时只读展示。 */
export default function CheatLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<GameEditBoundLoading />}>
        <GameEditPage />
      </Suspense>
      {children}
    </>
  )
}
