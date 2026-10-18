'use client'

import { useParams, useRouter } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'

import { CacheBrowser } from '@/components/CacheBrowser'
import { CacheTestView } from '@/components/translate/CacheTestView'
import { parseTranslateTab, translateRunHref, type TranslateRunMode } from '@/components/translate/tabs'
import { TranslateCacheTableSkeleton } from '@/components/translate/TranslateCacheTableSkeleton'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { TranslateRunPane } from '@/components/TranslateRunPane'

/** 仅下方内容：外壳 / 二级 tabs 由 `app/translate/layout` 提供 */
export function TranslateTabView({ mode = 'seed' }: { mode?: TranslateRunMode }) {
  const router = useRouter()
  const [activeMode, setActiveMode] = useState<TranslateRunMode>(mode)
  const params = useParams<{ tab?: string }>()
  const tab = parseTranslateTab(params?.tab)
  const cacheFallback = <TranslateCacheTableSkeleton />

  useEffect(() => {
    setActiveMode(mode)
  }, [mode])

  const handleModeChange = useCallback(
    (newMode: TranslateRunMode) => {
      setActiveMode(newMode)
      router.push(translateRunHref(newMode))
    },
    [router]
  )

  return (
    <Suspense fallback={tab === 'cache' ? cacheFallback : <TranslateRunSkeleton tab={activeMode} />}>
      {tab === 'test' ? <CacheTestView /> : tab === 'cache' ? <CacheBrowser /> : <TranslateRunPane tab={activeMode} onTabChange={handleModeChange} />}
    </Suspense>
  )
}
