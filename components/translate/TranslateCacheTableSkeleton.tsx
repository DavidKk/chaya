'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { TableSkeleton } from '@/components/sk'

export const TRANSLATE_CACHE_COLUMN_WIDTHS = {
  src: '34%',
  zh: '34%',
  engine: '7rem',
  hits: '4.5rem',
  updated: '10rem',
  ops: '7.5rem',
} as const

const CACHE_SKELETON_COLUMNS = [
  { key: 'src', width: TRANSLATE_CACHE_COLUMN_WIDTHS.src },
  { key: 'zh', width: TRANSLATE_CACHE_COLUMN_WIDTHS.zh },
  { key: 'engine', width: TRANSLATE_CACHE_COLUMN_WIDTHS.engine },
  { key: 'hits', width: TRANSLATE_CACHE_COLUMN_WIDTHS.hits },
  { key: 'updated', width: TRANSLATE_CACHE_COLUMN_WIDTHS.updated },
  { key: 'ops', width: TRANSLATE_CACHE_COLUMN_WIDTHS.ops },
]

/** 本作翻译库加载表；Web、局内和 Suspense 共用当前六列拓扑。 */
export function TranslateCacheTableSkeleton({ label }: { label?: string }) {
  const t = useT()
  return <TableSkeleton label={label ?? t('translate.loadCache')} tableClassName="table-fixed min-w-[56rem]" columns={CACHE_SKELETON_COLUMNS} />
}
