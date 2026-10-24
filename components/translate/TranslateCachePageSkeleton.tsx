'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { panelFoot } from '@/components/layoutClasses'
import { PanelHeadEnd } from '@/components/PanelHeadEnd'
import { Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'
import { TranslateCacheTableSkeleton } from '@/components/translate/TranslateCacheTableSkeleton'

/** 本作翻译库页骨架：页头筛选、八列表格和分页页脚。 */
export function TranslateCachePageSkeleton() {
  const t = useT()
  const filters = (
    <div className="flex flex-nowrap items-center gap-2" aria-hidden>
      <Skeleton className="h-8 w-52 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-28 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-28 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-28 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-28 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-28 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-28 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="size-8 shrink-0 rounded-[0.2rem]" />
    </div>
  )
  return (
    <SkeletonRegion label={t('translate.loadCache')} className="flex min-h-0 flex-1 flex-col">
      <PanelHeadEnd>{filters}</PanelHeadEnd>

      <div className="flex min-h-0 flex-1 flex-col">
        <TranslateCacheTableSkeleton />
      </div>

      <div className={panelFoot} aria-hidden>
        <Skeleton className="h-3.5 w-40" />
        <div className="inline-flex items-center gap-1.5">
          <Skeleton className="h-7 w-[4.75rem] rounded-[0.2rem]" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="size-8 rounded-[0.2rem]" />
          <Skeleton className="size-8 rounded-[0.2rem]" />
          <Skeleton className="size-8 rounded-[0.2rem]" />
          <Skeleton className="size-8 rounded-[0.2rem]" />
        </div>
      </div>
    </SkeletonRegion>
  )
}
