'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCard, settingsCardColumn, settingsCardWide } from '@/components/layoutClasses'
import { Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'
import { cn } from '@/lib/utils'

type EngineSkeletonView = 'overview' | 'detail'

function EngineRowSkeleton({ subtitle = false }: { subtitle?: boolean }) {
  return (
    <div className={cn('grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-1 rounded-[0.35rem] border border-line bg-panel pr-3 pl-0', subtitle ? 'h-12' : 'h-11')}>
      <Skeleton className="mx-auto h-3 w-1.5 rounded-[0.15rem]" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-[0.8125rem] w-24" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
        {subtitle ? <Skeleton className="h-[0.65rem] w-32" /> : null}
      </div>
      <div className="flex items-center gap-1">
        <Skeleton className="h-4 w-12 rounded-full" />
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
    </div>
  )
}

function EngineGroupSkeleton({ rows, subtitle, add }: { rows: number; subtitle?: boolean; add?: boolean }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex min-h-[3.25rem] shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Skeleton className="h-[0.72rem] w-16" />
          <Skeleton className="h-[0.7rem] w-44 max-w-[72%]" />
        </div>
        {add ? <Skeleton className="size-7 shrink-0 rounded-[0.2rem]" /> : null}
      </div>
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: rows }, (_, i) => (
          <EngineRowSkeleton key={i} subtitle={subtitle} />
        ))}
      </div>
    </section>
  )
}

function OverviewSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden p-4" aria-hidden>
      <div className={cn(settingsCardColumn, 'max-w-3xl')}>
        <EngineGroupSkeleton rows={1} subtitle add />
        <EngineGroupSkeleton rows={2} />
        <EngineGroupSkeleton rows={2} subtitle />
      </div>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden p-4" aria-hidden>
      <div className={settingsCardWide}>
        <section className={formCard}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Skeleton className="h-[0.8125rem] w-28" />
              <Skeleton className="h-[0.7rem] w-48 max-w-full" />
            </div>
            <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-[0.8125rem] w-20" />
              <Skeleton className="h-8 w-full rounded-[0.25rem]" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-[0.8125rem] w-16" />
              <Skeleton className="h-8 w-full rounded-[0.25rem]" />
            </div>
          </div>

          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
              <div className="flex flex-col gap-1">
                <Skeleton className="h-[0.8125rem] w-28" />
                <Skeleton className="h-[0.7rem] w-[64%]" />
              </div>
              <Skeleton className="h-8 w-28 rounded-[0.25rem]" />
            </div>
          ))}

          <div className="rounded-[0.35rem] border border-line bg-inset p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Skeleton className="h-[0.8125rem] w-20" />
                <Skeleton className="h-[0.7rem] w-32" />
              </div>
              <Skeleton className="h-4 w-14 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-8 w-full rounded-[0.25rem]" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-14 rounded-[0.2rem]" />
            <div className="ml-auto flex items-center gap-2">
              <Skeleton className="h-8 w-20 rounded-[0.2rem]" />
              <Skeleton className="h-8 w-16 rounded-[0.2rem]" />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

/** 翻译工具页骨架：总览三卡与详情单卡分别对齐真实页面。 */
export function TranslateEnginesSkeleton({ view = 'overview' }: { view?: EngineSkeletonView }) {
  const t = useT()
  return (
    <SkeletonRegion label={t(view === 'detail' ? 'translate.loadEngineDetail' : 'translate.loadEngines')} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper-2">
      {view === 'detail' ? <DetailSkeleton /> : <OverviewSkeleton />}
    </SkeletonRegion>
  )
}
