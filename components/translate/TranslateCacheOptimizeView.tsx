'use client'

import { useRouter } from 'next/navigation'

import { useT } from '@/components/i18n/LocaleProvider'
import { EmptyState } from '@/components/sk'
import { CacheOptimizeContent, type CacheOptimizeTarget } from '@/components/translate/CacheOptimizeContent'
import { translateTabHref } from '@/components/translate/tabs'
import type { CacheLang } from '@/lib/translate/cache-lang'
import type { RecordStructure } from '@/lib/translate/structured-segments'
import { returnToNavigationSource } from '@/lib/ui/navigation-restoration'

type InitialRow = {
  id: number
  revision?: number
  structure?: RecordStructure
  src: string
  zh: string
  from?: string
  to?: string
}

/** Web subpage: `/translate/cache/detail/{rowid}` — edit + optimize. */
export function TranslateCacheOptimizeView({ id, initial }: { id: number; initial: InitialRow | null }) {
  const t = useT()
  const router = useRouter()

  function back() {
    returnToNavigationSource(router, translateTabHref('cache'))
  }

  if (!initial) {
    return <EmptyState title={t('translate.cacheOptimizeMissingTitle')} message={t('translate.cacheOptimizeMissingMsg')} hint={t('translate.cacheOptimizeMissingHint')} />
  }

  const target: CacheOptimizeTarget = {
    id: initial.id || id,
    revision: initial.revision,
    structure: initial.structure,
    src: initial.src,
    zh: initial.zh,
    from: initial.from as CacheLang | undefined,
    to: initial.to as CacheLang | undefined,
  }

  return <CacheOptimizeContent target={target} onBack={back} />
}
