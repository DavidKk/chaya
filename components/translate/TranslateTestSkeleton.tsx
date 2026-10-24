'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCard } from '@/components/layoutClasses'
import { PanelHeadEnd, PanelHeadStart } from '@/components/PanelHeadEnd'
import { Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'
import { cn } from '@/lib/utils'

/** 缓存测试页骨架：返回/查询操作、双栏编辑卡和结构设置。 */
export function TranslateTestSkeleton() {
  const t = useT()
  const back = <Skeleton className="size-8 rounded-[0.2rem]" />
  const actions = (
    <div className="flex flex-nowrap items-center gap-2" aria-hidden>
      <Skeleton className="h-8 w-[4.5rem] shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-[4.5rem] shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-28 shrink-0 rounded-[0.2rem]" />
      <Skeleton className="h-8 w-24 shrink-0 rounded-[0.2rem]" />
    </div>
  )
  return (
    <SkeletonRegion label={t('translate.loadTest')} className="flex min-h-0 flex-1 flex-col">
      <PanelHeadStart fallback={back}>{back}</PanelHeadStart>
      <PanelHeadEnd fallback={actions}>{actions}</PanelHeadEnd>

      <div className="min-h-0 flex-1 overflow-hidden p-4" aria-hidden>
        <div className="flex min-w-0 flex-col gap-4">
          <section className={formCard}>
            <div className="flex flex-col gap-1 border-b border-line pb-4">
              <Skeleton className="h-[0.8125rem] w-20" />
              <Skeleton className="h-[0.7rem] w-[58%]" />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="flex min-w-0 flex-col gap-2">
                  <Skeleton className="h-[0.8125rem] w-14" />
                  <Skeleton className="h-[11.25rem] w-full rounded-[0.25rem] border border-line" />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Skeleton className="h-[0.8125rem] w-24" />
                <Skeleton className="h-[0.7rem] w-[62%]" />
              </div>
              <Skeleton className="h-8 w-28 shrink-0 rounded-[0.25rem]" />
            </div>
          </section>

          <section className={cn(formCard, 'items-center justify-center')}>
            <div className="flex flex-col items-center gap-2 py-4">
              <Skeleton className="h-[0.8125rem] w-32" />
              <Skeleton className="h-[0.7rem] w-56 max-w-full" />
            </div>
          </section>
        </div>
      </div>
    </SkeletonRegion>
  )
}
