import type { ReactNode } from 'react'

import { TranslateGate } from '@/components/translate/TranslateGate'
import { TranslateLayoutShell } from '@/components/translate/TranslateLayoutShell'

/**
 * 二级导航放在 layout：切换 `/translate/run` ↔ `/translate/cache` 时壳不重挂，
 * 只有下方 page 内容替换。未选 / 未连接游戏时壳照常展示；翻译动作由 `TranslateGate` 给空态，共享翻译库直接打开。
 *
 * 勿在 layout 用 Suspense 包住壳：嵌套动态段（如 `/cache/detail/[id]`）会长时间停在 fallback，
 * `useSearchParams` 由各 tab 页自己的 Suspense 承接即可。
 */
export default function TranslateLayout({ children }: { children: ReactNode }) {
  return (
    <TranslateLayoutShell>
      <TranslateGate>{children}</TranslateGate>
    </TranslateLayoutShell>
  )
}
