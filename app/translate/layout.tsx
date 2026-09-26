import type { ReactNode } from 'react'
import { Suspense } from 'react'

import { RequireBoundGame } from '@/components/RequireBoundGame'
import { TranslateBoundLoading } from '@/components/translate/TranslateBoundLoading'
import { TranslateLayoutShell } from '@/components/translate/TranslateLayoutShell'

/**
 * 二级导航放在 layout：切换 `/translate/run` ↔ `/translate/cache` 时壳不重挂，
 * 只有下方 page 内容替换。
 */
export default function TranslateLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<TranslateBoundLoading />}>
      <RequireBoundGame loadingFallback={<TranslateBoundLoading />}>
        <TranslateLayoutShell>{children}</TranslateLayoutShell>
      </RequireBoundGame>
    </Suspense>
  )
}
