'use client'

import { useParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { CacheBrowser } from '@/components/CacheBrowser'
import { parseTranslateTab, type TranslateRunMode } from '@/components/translate/tabs'
import { TranslateCacheTableSkeleton } from '@/components/translate/TranslateCacheTableSkeleton'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { TranslateRunPane } from '@/components/TranslateRunPane'

/** 仅下方内容：外壳 / 二级 tabs 由 `app/translate/layout` 提供 */
export function TranslateTabView({ mode = 'seed' }: { mode?: TranslateRunMode }) {
  const [activeMode, setActiveMode] = useState(mode)
  const params = useParams<{ tab?: string }>()
  const tab = parseTranslateTab(params.tab)
  const cacheFallback = <TranslateCacheTableSkeleton />

  return (
    <Suspense fallback={tab === 'cache' ? cacheFallback : <TranslateRunSkeleton tab={activeMode} />}>
      {tab === 'cache' ? <CacheBrowser /> : <TranslateRunPane tab={activeMode} onTabChange={setActiveMode} />}
    </Suspense>
  )
}
