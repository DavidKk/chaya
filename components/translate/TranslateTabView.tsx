'use client'

import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import { Suspense } from 'react'

import type { TranslateRunMode, TranslateTabId } from '@/components/translate/tabs'
import { isTranslateEngineDetailPath } from '@/components/translate/tabs'
import { TranslateCachePageSkeleton } from '@/components/translate/TranslateCachePageSkeleton'
import { TranslateEnginesSkeleton } from '@/components/translate/TranslateEnginesSkeleton'
import { TranslateListSkeleton, TranslateRunSkeleton } from '@/components/translate/TranslateRunSkeleton'
import { TranslateTestSkeleton } from '@/components/translate/TranslateTestSkeleton'
import { TranslateRunPane } from '@/components/TranslateRunPane'

const CacheTestView = dynamic(() => import('@/components/translate/CacheTestView').then((m) => m.CacheTestView), {
  loading: () => <TranslateTestSkeleton />,
})
const CacheBrowser = dynamic(() => import('@/components/CacheBrowser').then((m) => m.CacheBrowser), {
  loading: () => <TranslateCachePageSkeleton />,
})
const TranslateEnginesPane = dynamic(() => import('@/components/translate/TranslateEnginesPane').then((m) => m.TranslateEnginesPane), {
  loading: () => <TranslateEnginesRouteSkeleton />,
})
const TranslateListContent = dynamic(() => import('@/components/translate/TranslateListContent').then((m) => m.TranslateListContent), {
  loading: () => <TranslateListSkeleton />,
})

function TranslateEnginesRouteSkeleton() {
  const pathname = usePathname() || ''
  return <TranslateEnginesSkeleton view={isTranslateEngineDetailPath(pathname) ? 'detail' : 'overview'} />
}

/** 仅下方内容：外壳 / 二级 tabs 由 `app/translate/layout` 提供 */
export function TranslateTabView({ tab, mode = 'seed' }: { tab: TranslateTabId; mode?: TranslateRunMode }) {
  const router = useRouter()
  const pathname = usePathname() || ''

  const activeRunMode: TranslateRunMode = tab === 'list' ? 'list' : tab === 'play' ? 'play' : mode
  const fallback =
    tab === 'cache' ? (
      <TranslateCachePageSkeleton />
    ) : tab === 'test' ? (
      <TranslateTestSkeleton />
    ) : tab === 'engines' ? (
      <TranslateEnginesSkeleton view={isTranslateEngineDetailPath(pathname) ? 'detail' : 'overview'} />
    ) : (
      <TranslateRunSkeleton tab={activeRunMode} />
    )

  return (
    <Suspense fallback={fallback}>
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
