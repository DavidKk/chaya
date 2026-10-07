'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'
import { cn } from '@/lib/utils'

import { DATA_COLS, ROW_HEIGHT } from './DataRowView'

/** 名称 / 当前值 / 目标值 / 操作，与 DataList 同列宽同行高 */
function DataRowsSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div aria-hidden>
      <div className={cn('grid h-8 items-center gap-3 border-b border-line bg-paper-2 px-3', DATA_COLS)}>
        <Skeleton className="h-[0.55rem] w-10" />
        <Skeleton className="h-[0.55rem] w-12" />
        <Skeleton className="h-[0.55rem] w-12" />
        <Skeleton className="ml-auto h-[0.55rem] w-8" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('grid items-center gap-3 border-b border-line px-3', DATA_COLS)} style={{ height: ROW_HEIGHT }}>
          <Skeleton className="h-[0.8125rem]" style={{ width: `${48 + (i % 4) * 12}%` }} />
          <Skeleton className="h-[0.75rem]" style={{ width: `${30 + (i % 3) * 15}%` }} />
          <Skeleton className="h-7 w-full max-w-[14rem] rounded-[0.2rem]" />
          <div className="flex justify-end gap-1">
            <Skeleton className="size-7 rounded-[0.2rem]" />
            <Skeleton className="size-7 rounded-[0.2rem]" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 存档数据：当前层级的数据行 */
export function DataListSkeleton({ label }: { label?: string }) {
  const t = useT()
  return (
    <SkeletonRegion label={label ?? t('edit.loadPanel')} className="min-h-0 flex-1 overflow-hidden">
      <DataRowsSkeleton />
    </SkeletonRegion>
  )
}

/** 存档数据整页：面包屑 / 工具条 + 数据行 */
export function SaveDataPaneSkeleton({ label }: { label?: string }) {
  const t = useT()
  return (
    <SkeletonRegion label={label ?? t('edit.loadPanel')} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2" aria-hidden>
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-20" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-[0.2rem]" />
          <Skeleton className="size-8 rounded-[0.2rem]" />
        </div>
      </div>
      <DataRowsSkeleton />
    </SkeletonRegion>
  )
}
