import { notFound } from 'next/navigation'

import { TRANSLATE_CACHE_DETAIL_MODE } from '@/components/translate/tabs'
import { TranslateCacheOptimizeView } from '@/components/translate/TranslateCacheOptimizeView'
import { getSharedTranslateCacheById } from '@/services/disk-ops'

export default async function TranslateCacheDetailPage({ params }: { params: Promise<{ tab: string; mode: string; id: string }> }) {
  const { tab, mode, id: raw } = await params
  const id = Math.floor(Number(raw) || 0)
  if (tab !== 'cache' || mode !== TRANSLATE_CACHE_DETAIL_MODE || id <= 0) notFound()

  let initial: { id: number; src: string; zh: string; from?: string; to?: string } | null = null
  try {
    const item = getSharedTranslateCacheById(id)
    if (item) initial = { id: item.id, src: item.src, zh: item.zh, from: item.from, to: item.to }
  } catch {
    initial = null
  }

  return <TranslateCacheOptimizeView id={id} initial={initial} />
}
