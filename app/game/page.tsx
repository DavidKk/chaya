import { Suspense } from 'react'

import { Dashboard } from '@/components/Dashboard'

/** 游戏库：多游戏列表与绑定。fallback 必须为 null，避免 ?game= 变更时 Suspense 整页骨架导致重挂 WebRTC。 */
export default function GameLibraryPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  )
}
