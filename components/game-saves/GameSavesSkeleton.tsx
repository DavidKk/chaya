'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { Skeleton, SkeletonRegion } from '@/components/sk'

const LIST_ROWS = 3

function ListRows() {
  return Array.from({ length: LIST_ROWS }, (_, row) => (
    <div key={row} className="flex items-center gap-3 px-4 py-2.5">
      <Skeleton className="aspect-[4/3] w-20" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-[0.55rem] w-48" />
      </div>
      <Skeleton className="h-8 w-14" />
    </div>
  ))
}

/** 已连接、存档列表尚未读回时替换列表区域 */
export function ListSkeleton() {
  const t = useT()
  return (
    <SkeletonRegion label={t('saves.page.loadingSaves')}>
      <ListRows />
    </SkeletonRegion>
  )
}

function CardSkeleton({ fields }: { fields: 'auto' | 'quick' }) {
  return (
    <div className="w-full overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
      </div>
      <div className="divide-y divide-[var(--line-soft)] border-b border-line px-4">
        {Array.from({ length: fields === 'auto' ? 3 : 2 }, (_, row) => (
          <div key={row} className="flex min-h-[2.35rem] items-center gap-3 py-2">
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Skeleton className="h-3.5 w-14" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className={fields === 'auto' && row < 2 ? 'h-8 w-[7.25rem] shrink-0' : 'h-5 w-9 shrink-0 rounded-full'} />
          </div>
        ))}
      </div>
      <ListRows />
    </div>
  )
}

/** 首次读取通用设置期间替换两张卡片，避免先显示默认值再跳变 */
export function GameSavesSkeleton() {
  const t = useT()
  return (
    <SkeletonRegion label={t('saves.page.loadingSettings')} className="flex flex-col gap-4">
      <CardSkeleton fields="auto" />
      <CardSkeleton fields="quick" />
    </SkeletonRegion>
  )
}
