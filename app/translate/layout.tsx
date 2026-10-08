import type { ReactNode } from 'react'
import { Suspense } from 'react'

import { TranslateBoundLoading } from '@/components/translate/TranslateBoundLoading'
import { TranslateGate } from '@/components/translate/TranslateGate'
import { TranslateLayoutShell } from '@/components/translate/TranslateLayoutShell'

/**
 * 二级导航放在 layout：切换 `/translate/run` ↔ `/translate/cache` 时壳不重挂，
 * 只有下方 page 内容替换。未选 / 未连接游戏时壳照常展示，内容区由 `TranslateGate` 给空态。
 */
export default function TranslateLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<TranslateBoundLoading />}>
      <TranslateLayoutShell>
        <TranslateGate>{children}</TranslateGate>
      </TranslateLayoutShell>
    </Suspense>
  )
}
