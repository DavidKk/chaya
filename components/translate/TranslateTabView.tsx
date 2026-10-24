'use client'

import { useRouter } from 'next/navigation'
import { Suspense } from 'react'

import { CacheBrowser } from '@/components/CacheBrowser'
import { CacheTestView } from '@/components/translate/CacheTestView'
import type { TranslateRunMode, TranslateTabId } from '@/components/translate/tabs'
import { TranslateCacheTableSkeleton } from '@/components/translate/TranslateCacheTableSkeleton'
import { TranslateEnginesPane } from '@/components/translate/TranslateEnginesPane'
import { TranslateListContent } from '@/components/translate/TranslateListContent'
import { TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { TranslateRunPane } from '@/components/TranslateRunPane'

/** 仅下方内容：外壳 / 二级 tabs 由 `app/translate/layout` 提供 */
export function TranslateTabView({ tab, mode = 'seed' }: { tab: TranslateTabId; mode?: TranslateRunMode }) {
  const router = useRouter()
  const cacheFallback = <TranslateCacheTableSkeleton />

  const activeRunMode: TranslateRunMode = tab === 'list' ? 'list' : tab === 'play' ? 'play' : mode

  return (
    <Suspense fallback={tab === 'cache' ? cacheFallback : <TranslateRunSkeleton tab={activeRunMode} />}>
      {tab === 'test' ? (
        <CacheTestView />
      ) : tab === 'cache' ? (
        <CacheBrowser />
      ) : tab === 'engines' ? (
        <TranslateEnginesPane />
      ) : tab === 'list' ? (
        <TranslateListContent onExtract={() => router.push('/translate/seed')} />
      ) : tab === 'play' ? (
        <TranslateRunPane tab="play" />
      ) : (
        <TranslateRunPane tab="seed" />
      )}
    </Suspense>
  )
}
