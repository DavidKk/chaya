'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { padXDense } from '@/components/layoutClasses'
import { Skeleton, SkeletonRegion } from '@/components/sk/Skeleton'
import { cn } from '@/lib/utils'

export type EventsSkeletonHead = 'common' | 'map' | 'troop'

/** 公共事件 / 地图 / 敌群：左列表（筛选头 + 行）+ 宽容器右侧详情 */
export function EventsPaneSkeleton({ label, head = 'common' }: { label?: string; head?: EventsSkeletonHead }) {
  const t = useT()
  return (
    <SkeletonRegion label={label ?? t('events.loading')} className="@container flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 flex-1" aria-hidden>
        <div className="flex min-h-0 w-full flex-col @4xl:w-[17rem] @4xl:shrink-0 @4xl:border-r @4xl:border-line">
          {head === 'map' ? (
            <div className="shrink-0 border-b border-line px-3 py-2">
              <Skeleton className="h-8 w-full rounded-[0.15rem]" />
            </div>
          ) : head === 'common' ? (
            <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2">
              <Skeleton className="h-7 w-full rounded-[0.2rem]" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            </div>
          ) : null}
          <div className="flex flex-col">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className={cn('flex items-center gap-2 border-b border-line py-2', padXDense)}>
                <Skeleton className="h-[0.8125rem]" style={{ width: `${44 + (i % 4) * 11}%` }} />
                {i % 3 === 1 ? <Skeleton className="ml-auto h-[0.65rem] w-10" /> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="hidden min-h-0 min-w-0 flex-1 flex-col @4xl:flex">
          <div className="flex h-[3.25rem] shrink-0 items-center gap-3 border-b border-line px-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-8 w-20 shrink-0 rounded-[0.2rem]" />
          </div>
          <div className="flex flex-col gap-2 px-4 pt-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[0.8125rem]" style={{ width: `${40 + ((i * 7) % 5) * 10}%` }} />
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

const mapTableCols = { gridTemplateColumns: 'minmax(8rem, 1fr) 4.75rem 4.5rem 6rem' }

/** 地图详情：事件表（名称 / 坐标 / 类型 / 状态） */
export function MapEventsTableSkeleton({ label, rows = 8 }: { label?: string; rows?: number }) {
  const t = useT()
  return (
    <SkeletonRegion label={label ?? t('events.loading')} className="min-h-0 overflow-hidden">
      <div className="text-[0.8125rem]" style={{ minWidth: '24rem' }} aria-hidden>
        <div className="grid h-8 items-center gap-0 border-b border-line bg-paper-2 px-3" style={mapTableCols}>
          {[10, 8, 8, 8].map((w, i) => (
            <Skeleton key={i} className="h-[0.55rem]" style={{ width: `${w * 0.25}rem` }} />
          ))}
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="grid h-[2.35rem] items-center border-t border-line px-3 first:border-t-0" style={mapTableCols}>
            <Skeleton className="h-[0.8125rem]" style={{ width: `${46 + (i % 4) * 12}%` }} />
            <Skeleton className="h-[0.7rem] w-10" />
            <Skeleton className="h-5 w-12 rounded-full" />
            <Skeleton className="h-[0.7rem] w-14" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}
