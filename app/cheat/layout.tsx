import type { ReactNode } from 'react'
import { Suspense } from 'react'

import { GameEditBoundLoading } from '@/components/game-edit/GameEditPaneSkeleton'
import { GameEditPage } from '@/components/GameEditPage'
import { RequireBoundGame } from '@/components/RequireBoundGame'

/** 状态放在 layout，切换 `/cheat/[tab]` 时不丢会话预览；未绑定游戏时整页门闸。 */
export default function CheatLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<GameEditBoundLoading />}>
        <RequireBoundGame loadingFallback={<GameEditBoundLoading />}>
          <GameEditPage />
        </RequireBoundGame>
      </Suspense>
      {children}
    </>
  )
}
