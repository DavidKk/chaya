import { notFound } from 'next/navigation'

import { TRANSLATE_CACHE_DETAIL_MODE, TRANSLATE_RUN_MODES } from '@/components/translate/tabs'
import { TranslateTabView } from '@/components/translate/TranslateTabView'

export function generateStaticParams({ params }: { params: { tab: string } }) {
  if (params.tab === 'run') return TRANSLATE_RUN_MODES.map((mode) => ({ mode }))
  return []
}

export default async function TranslateNestedPage({ params }: { params: Promise<{ tab: string; mode: string }> }) {
  const { tab, mode } = await params
  if (tab === 'run' && (mode === 'seed' || mode === 'play')) {
    return <TranslateTabView mode={mode} />
  }
  // Detail requires `/translate/cache/detail/[id]`
  if (tab === 'cache' && mode === TRANSLATE_CACHE_DETAIL_MODE) notFound()
  notFound()
}
