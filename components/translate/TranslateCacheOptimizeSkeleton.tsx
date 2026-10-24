'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCard } from '@/components/layoutClasses'
import { PanelHeadStart } from '@/components/PanelHeadEnd'
import { Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'

function SectionHeadingSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      <Skeleton className="h-[0.8125rem] w-24" />
      <Skeleton className="h-[0.7rem] w-[58%]" />
    </div>
  )
}

/** 翻译库详情骨架：编辑卡、结构边界卡和优化拆分卡。 */
export function TranslateCacheOptimizeSkeleton() {
  const t = useT()
  const back = <Skeleton className="size-8 rounded-[0.2rem]" />
  return (
    <SkeletonRegion label={t('translate.loadCacheDetail')} className="flex min-h-0 flex-1 flex-col">
      <PanelHeadStart>{back}</PanelHeadStart>

      <div className="min-h-0 flex-1 overflow-hidden p-4" aria-hidden>
        <div className="flex w-full flex-col gap-4">
          <section className={formCard}>
            <SectionHeadingSkeleton />
            <div className="!px-0 !py-0">
              <div className="grid grid-cols-2 items-stretch">
                <div className="flex min-w-0 flex-col gap-2 border-r border-line bg-paper px-4 py-4">
                  <Skeleton className="h-[0.68rem] w-24" />
                  <Skeleton className="h-[10rem] w-full rounded-[0.25rem] border border-line" />
                </div>
                <div className="flex min-w-0 flex-col gap-2 bg-panel px-4 py-4">
                  <Skeleton className="h-[0.68rem] w-24" />
                  <Skeleton className="h-[10rem] w-full rounded-[0.25rem] border border-line" />
                </div>
              </div>
            </div>
          </section>

          <section className={formCard}>
            <SectionHeadingSkeleton />
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-[0.8125rem] w-20" />
                  <Skeleton className="h-8 w-full rounded-[0.25rem]" />
                  <div className="flex flex-col gap-1.5 pt-1">
                    <Skeleton className="h-3 w-[82%]" />
                    <Skeleton className="h-3 w-[64%]" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={formCard}>
            <div className="flex items-start gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Skeleton className="h-[0.8125rem] w-20" />
                <Skeleton className="h-[0.7rem] w-[56%]" />
              </div>
              <Skeleton className="size-8 shrink-0 rounded-[0.2rem]" />
            </div>
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-stretch gap-2">
                  <Skeleton className="h-[5.5rem] w-full rounded-[0.25rem] border border-line" />
                  <Skeleton className="h-[5.5rem] w-full rounded-[0.25rem] border border-line" />
                  <Skeleton className="h-6 w-6 self-start rounded-[0.2rem]" />
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-8 w-20 rounded-[0.2rem]" />
            </div>
          </section>
        </div>
      </div>
    </SkeletonRegion>
  )
}
