'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { editCell, editHeadCell } from '@/components/layoutClasses'
import { Skeleton, SkeletonRegion } from '@/components/sk'
import { cn } from '@/lib/utils'

/**
 * Dense PC layout: meta columns fixed; src/zh share leftover width (1fr) so the row fills
 * the viewport with no dead space after ops. Floor mins keep small screens horizontally scrollable.
 */
export const TRANSLATE_CACHE_COLUMN_WIDTHS = {
  pair: '5rem',
  src: 'minmax(10rem,1fr)',
  zh: 'minmax(10rem,1fr)',
  engine: '5.5rem',
  hits: '3.75rem',
  updated: '6.5rem',
  ops: '5.5rem',
} as const

/** Shared with list + skeleton so header/rows stay aligned. */
export function translateCacheGridTemplate(): string {
  const w = TRANSLATE_CACHE_COLUMN_WIDTHS
  return `${w.src} ${w.zh} ${w.pair} ${w.engine} ${w.hits} ${w.updated} ${w.ops}`
}

/** Below this width the grid scrolls horizontally instead of crushing text columns. */
export const TRANSLATE_CACHE_GRID_MIN_WIDTH = '52rem'

const CACHE_SKELETON_COLS = ['src', 'zh', 'pair', 'engine', 'hits', 'updated', 'ops'] as const

/** 本作翻译库加载表；Web、局内和 Suspense 共用当前七列拓扑。 */
export function TranslateCacheTableSkeleton({ label }: { label?: string }) {
  const t = useT()
  const gridStyle = { gridTemplateColumns: translateCacheGridTemplate() }
  return (
    <SkeletonRegion label={label ?? t('translate.loadCache')} className="min-h-0 flex-1 overflow-hidden">
      <div className="w-full text-[0.8125rem]" style={{ minWidth: TRANSLATE_CACHE_GRID_MIN_WIDTH }} role="presentation" aria-hidden>
        <div className="sticky top-0 z-[3] grid w-full items-center border-b border-line bg-paper-2" style={gridStyle}>
          {CACHE_SKELETON_COLS.map((key) => (
            <div key={key} className={editHeadCell}>
              <Skeleton className="h-[0.55rem] w-[3.25rem] max-w-full" />
            </div>
          ))}
        </div>
        {Array.from({ length: 8 }, (_, row) => (
          <div key={row} className={cn('grid w-full items-start border-t border-line', row === 0 && 'border-t-0')} style={gridStyle}>
            {CACHE_SKELETON_COLS.map((key, colIndex) => (
              <div key={key} className={editCell}>
                <Skeleton className="h-[0.7rem] max-w-full" style={{ width: `${52 + ((row + colIndex) % 5) * 9}%` }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}
